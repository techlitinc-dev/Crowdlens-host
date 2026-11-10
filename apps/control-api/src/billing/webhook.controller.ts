import {
  Controller,
  Headers,
  HttpCode,
  Inject,
  Logger,
  Post,
  Req,
} from "@nestjs/common";
import { createHmac, timingSafeEqual } from "node:crypto";
import pg from "pg";
import { PG_APP_POOL, PG_POOL } from "../db/pg.module.js";
import { AppConfig, CONFIG_TOKEN } from "../config/env.js";
import { AuditService } from "../audit/audit.service.js";
import { CsrfExempt, Public } from "../common/public.js";
import { LedgerService } from "./ledger.service.js";
import { CacheService } from "../cache/cache.service.js";

const RAW_BODY_LIMIT = 256 * 1024;

/**
 * Razorpay webhook route (instructions.md §9.3, architecture.md §11.1):
 *  - raw body before JSON parsing; size limited
 *  - HMAC-SHA256 over the RAW body, constant-time comparison
 *  - durable inbox insert BEFORE returning 2xx
 *  - asynchronous, idempotent, out-of-order-tolerant processing
 */
@Controller("v1/webhooks")
export class RazorpayWebhookController {
  private readonly logger = new Logger("razorpay-webhook");

  constructor(
    @Inject(PG_APP_POOL) private readonly appPool: pg.Pool,
    @Inject(PG_POOL) private readonly ownerPool: pg.Pool,
    @Inject(CONFIG_TOKEN) private readonly config: AppConfig,
    @Inject(LedgerService) private readonly ledger: LedgerService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(CacheService) private readonly cache: CacheService,
  ) {}

  @Public()
  @CsrfExempt()
  @Post("razorpay")
  @HttpCode(200)
  async receive(
    @Req() req: { rawBody?: Buffer; body?: unknown; headers?: Record<string, string | string[] | undefined> },
    @Headers("x-razorpay-signature") signature: string | undefined,
  ) {
    const raw: Buffer | undefined = req.rawBody;
    if (!raw || raw.length === 0) {
      return { received: false, reason: "missing raw body" };
    }
    if (raw.length > RAW_BODY_LIMIT) {
      return { received: false, reason: "payload too large" };
    }
    const secret = this.config.RAZORPAY_WEBHOOK_SECRET_REFERENCE;
    if (!secret) {
      this.logger.warn("webhook received but no secret configured; persisting unsigned for review");
    }
    const signatureValid = secret
      ? verifyRazorpaySignature(raw, signature, secret)
      : false;

    let parsed: { event?: string; payload?: { payment?: { entity?: { id?: string; order_id?: string } }; order?: { entity?: { id?: string } }; subscription?: { entity?: { id?: string } } } } = {};
    try {
      parsed = JSON.parse(raw.toString("utf8")) as typeof parsed;
    } catch {
      return { received: false, reason: "invalid json" };
    }
    const eventType = parsed.event ?? "unknown";
    const entityId =
      parsed.payload?.payment?.entity?.id ??
      parsed.payload?.order?.entity?.id ??
      parsed.payload?.subscription?.entity?.id ??
      "";
    // Deduplication key: provider event id when present, else deterministic hash.
    const eventId = (req.headers?.["x-razorpay-event-id"] as string | undefined) ?? "";
    const eventKey = eventId || deterministicEventKey(raw);

    const { rows } = await this.ownerPool.query<{ id: number }>(
      `INSERT INTO webhook_events (provider, event_key, entity_id, event_type, payload, signature_valid)
       VALUES ('razorpay', $1, $2, $3, $4, $5)
       ON CONFLICT (provider, event_key) DO NOTHING
       RETURNING id`,
      [eventKey, entityId, eventType, raw.toString("utf8"), signatureValid],
    );
    if (!rows[0]) {
      return { received: true, duplicate: true };
    }
    if (!signatureValid) {
      this.logger.warn(`invalid signature for event ${eventType} (${eventKey})`);
      return { received: true, signature_valid: false };
    }

    // Process asynchronously after the durable inbox write.
    setImmediate(() => {
      this.processEvent(rows[0]!.id).catch((error) => {
        this.logger.error(`webhook processing failed: ${(error as Error).message}`);
      });
    });
    return { received: true, signature_valid: true };
  }

  private async processEvent(eventRowId: number): Promise<void> {
    const { rows } = await this.ownerPool.query<{
      id: number;
      event_type: string;
      entity_id: string;
      payload: string | Record<string, unknown>;
    }>(`SELECT id, event_type, entity_id, payload FROM webhook_events WHERE id = $1`, [eventRowId]);
    const event = rows[0];
    if (!event) return;
    try {
      // The inbox column is jsonb: the driver may return it already parsed.
      const payload = (
        typeof event.payload === "string" ? JSON.parse(event.payload) : event.payload
      ) as {
        payload?: {
          payment?: { entity?: { id: string; order_id: string; amount: number; currency: string; status: string } };
          subscription?: { entity?: { id: string; plan_id: string; status: string } };
        };
      };
      const payment = payload.payload?.payment?.entity;
      const subscription = payload.payload?.subscription?.entity;

      if (payment && (event.event_type === "payment.captured" || event.event_type === "order.paid")) {
        await this.processPaidOrder(payment);
      } else if (subscription && ["subscription.activated", "subscription.charged", "subscription.completed"].includes(event.event_type)) {
        await this.processSubscriptionCharged(subscription);
      } else if (subscription && event.event_type === "subscription.cancelled") {
        await this.processSubscriptionCancelled(subscription);
      } else if (payment && event.event_type === "payment.failed") {
        await this.ownerPool.query(
          `UPDATE purchases SET status = 'failed', updated_at = now() WHERE razorpay_order_id = $1 AND status = 'pending'`,
          [payment.order_id],
        );
      }
      await this.ownerPool.query(
        `UPDATE webhook_events SET processed_at = now(), processing_error = NULL WHERE id = $1`,
        [event.id],
      );
    } catch (error) {
      await this.ownerPool.query(
        `UPDATE webhook_events SET processing_error = $2 WHERE id = $1`,
        [event.id, (error as Error).message.slice(0, 1000)],
      );
      throw error;
    }
  }

  /** Exactly-once top-up grant keyed to the paid order. */
  private async processPaidOrder(payment: { id: string; order_id: string; amount: number; currency: string }): Promise<void> {
    const client = await this.ownerPool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query<{
        workspace_id: string;
        pack_code: string;
        credits: number;
        amount_minor: number;
        currency: string;
        status: string;
      }>(
        `SELECT workspace_id, pack_code, credits, amount_minor, currency, status
         FROM purchases WHERE razorpay_order_id = $1 FOR UPDATE`,
        [payment.order_id],
      );
      const purchase = rows[0];
      if (!purchase) {
        this.logger.warn(`paid order ${payment.order_id} has no matching purchase`);
        await client.query("COMMIT");
        return;
      }
      if (purchase.status === "paid") {
        await client.query("COMMIT");
        return; // duplicate/out-of-order delivery
      }
      // Server-side validation of amount/currency against the server catalog.
      if (purchase.amount_minor !== payment.amount || purchase.currency !== payment.currency) {
        throw new Error(`amount/currency mismatch for order ${payment.order_id}`);
      }
      await client.query(
        `UPDATE purchases SET status = 'paid', razorpay_payment_id = $2, updated_at = now()
         WHERE workspace_id = $1 AND razorpay_order_id = $3`,
        [purchase.workspace_id, payment.id, payment.order_id],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    await this.ledger.grant({
      workspaceId: (await this.purchaseWorkspace(payment.order_id))!,
      type: "topup_grant",
      amount: (await this.purchaseCredits(payment.order_id))!,
      rateCardVersion: this.config.CREDIT_RATE_CARD_VERSION,
      actor: "razorpay",
      eventRef: `order:${payment.order_id}`,
      reason: `credit pack purchase ${payment.order_id}`,
    });
    await this.bumpEntitlement((await this.purchaseWorkspace(payment.order_id))!);
  }

  /** Plan grant keyed to the unique subscription billing event. */
  private async processSubscriptionCharged(subscription: { id: string; plan_id: string }): Promise<void> {
    const { rows } = await this.ownerPool.query<{ workspace_id: string; plan_code: string }>(
      `SELECT workspace_id, plan_code FROM subscriptions WHERE razorpay_subscription_id = $1`,
      [subscription.id],
    );
    const sub = rows[0];
    if (!sub) {
      this.logger.warn(`subscription ${subscription.id} not found locally`);
      return;
    }
    const { rows: planRows } = await this.ownerPool.query<{ included_credits: number }>(
      `SELECT included_credits FROM plans WHERE code = $1`,
      [sub.plan_code],
    );
    const credits = planRows[0]?.included_credits ?? 0;
    if (credits > 0) {
      await this.ledger.grant({
        workspaceId: sub.workspace_id,
        type: "plan_grant",
        amount: credits,
        rateCardVersion: this.config.CREDIT_RATE_CARD_VERSION,
        actor: "razorpay",
        eventRef: `sub:${subscription.id}`,
        reason: `plan ${sub.plan_code} recurring grant`,
      });
    }
    await this.ownerPool.query(
      `UPDATE subscriptions SET status = 'active', updated_at = now() WHERE razorpay_subscription_id = $1`,
      [subscription.id],
    );
    await this.bumpEntitlement(sub.workspace_id);
  }

  private async processSubscriptionCancelled(subscription: { id: string }): Promise<void> {
    await this.ownerPool.query(
      `UPDATE subscriptions SET status = 'cancelled', cancel_at_period_end = true, updated_at = now()
       WHERE razorpay_subscription_id = $1`,
      [subscription.id],
    );
    const { rows } = await this.ownerPool.query<{ workspace_id: string }>(
      `SELECT workspace_id FROM subscriptions WHERE razorpay_subscription_id = $1`,
      [subscription.id],
    );
    if (rows[0]) await this.bumpEntitlement(rows[0].workspace_id);
  }

  private async purchaseWorkspace(orderId: string): Promise<string | null> {
    const { rows } = await this.ownerPool.query<{ workspace_id: string }>(
      `SELECT workspace_id FROM purchases WHERE razorpay_order_id = $1`,
      [orderId],
    );
    return rows[0]?.workspace_id ?? null;
  }

  private async purchaseCredits(orderId: string): Promise<number | null> {
    const { rows } = await this.ownerPool.query<{ credits: number }>(
      `SELECT credits FROM purchases WHERE razorpay_order_id = $1`,
      [orderId],
    );
    return rows[0]?.credits ?? null;
  }

  /** Entitlement/cache generation bump so projections refresh immediately. */
  private async bumpEntitlement(workspaceId: string): Promise<void> {
    const client = await this.ownerPool.connect();
    try {
      await client.query("BEGIN");
      await this.cache.bumpGeneration(client, workspaceId, "entitlement");
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}

/** HMAC-SHA256 over the raw body with constant-time comparison. */
export function verifyRazorpaySignature(rawBody: Buffer, signature: string | undefined, secret: string): boolean {
  if (!signature) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function deterministicEventKey(rawBody: Buffer): string {
  return createHmac("sha256", "crowdlens-webhook-dedupe").update(rawBody).digest("hex");
}
