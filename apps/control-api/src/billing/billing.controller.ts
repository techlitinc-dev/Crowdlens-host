import { Body, Controller, Get, Headers, Inject, Param, Post, Query } from "@nestjs/common";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { PG_APP_POOL, PG_POOL } from "../db/pg.module.js";
import { Tx } from "../db/tx.js";
import { AuditService } from "../audit/audit.service.js";
import { problems } from "../common/problem-details.js";
import { buildPage, cursorQuerySchema } from "../common/pagination.js";
import { CanRead, CanManageBilling, Req as TenantReq } from "../auth/rbac.js";
import type { TenantRequest } from "../auth/auth-context.js";
import { CREDIT_PACKS, PLANS, RATE_CARD, packByCode, planByCode } from "./catalog.js";
import { LedgerService } from "./ledger.service.js";
import { RazorpayClient } from "./razorpay.client.js";
import { CacheService, CACHE_TTLS } from "../cache/cache.service.js";
import { Public } from "../common/public.js";
import { AppConfig, CONFIG_TOKEN } from "../config/env.js";

const packSchema = z.object({ pack_code: z.enum(CREDIT_PACKS.map((p) => p.code) as [string, ...string[]]) });
const subscribeSchema = z.object({ plan_code: z.enum(["professional", "business"]) });

@Controller()
export class BillingController {
  constructor(
    @Inject(PG_APP_POOL) private readonly pool: pg.Pool,
    @Inject(PG_POOL) private readonly ownerPool: pg.Pool,
    @Inject(CONFIG_TOKEN) private readonly config: AppConfig,
    @Inject(LedgerService) private readonly ledger: LedgerService,
    @Inject(RazorpayClient) private readonly razorpay: RazorpayClient,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(Tx) private readonly tx: Tx,
    @Inject(CacheService) private readonly cache: CacheService,
  ) {}

  @Get("v1/billing/catalog")
  @CanRead()
  async catalog() {
    return {
      plans: PLANS.map((p) => ({
        code: p.code, name: p.name, price_minor: p.priceMinor, currency: p.currency,
        interval: p.interval, included_credits: p.includedCredits, agent_ceiling: p.agentCeiling,
        seats: p.seats, max_concurrent_runs: p.maxConcurrentRuns,
        max_active_projects: p.maxActiveProjects,
      })),
      credit_packs: CREDIT_PACKS,
      razorpay_configured: this.config.razorpayConfigured,
      razorpay_mode: this.config.RAZORPAY_MODE,
      rate_card_version: this.config.CREDIT_RATE_CARD_VERSION,
    };
  }

  /**
   * Public pricing/rate-card view for the landing-page estimator. Contains no
   * tenant data and no secrets; the rate-card version is pinned in the cache
   * key so a pricing rollout self-invalidates.
   */
  @Public()
  @Get("v1/public/rate-card")
  async publicRateCard() {
    return this.cache.through(
      "catalog",
      "rate-card",
      { operationVersion: this.config.CREDIT_RATE_CARD_VERSION },
      CACHE_TTLS.catalog,
      async () => ({
        rate_card_version: RATE_CARD.version,
        currency: "INR" as const,
        plans: PLANS.map((p) => ({
          code: p.code, name: p.name, price_minor: p.priceMinor, interval: p.interval,
          included_credits: p.includedCredits, agent_ceiling: p.agentCeiling,
          seats: p.seats, max_concurrent_runs: p.maxConcurrentRuns,
          max_active_projects: p.maxActiveProjects,
        })),
        credit_packs: CREDIT_PACKS,
        estimator: {
          population_tick_per_thousand: RATE_CARD.populationTickPerThousand,
          active_reasoning_call: RATE_CARD.activeReasoningCall,
          graph_chunk: RATE_CARD.graphChunk,
          report_section: RATE_CARD.reportSection,
          provider_multiplier: RATE_CARD.providerMultiplier,
          action_batch: 8,
          // Mirrors billing/catalog.ts estimateCredits so the public
          // estimator shows the same indicative band the API computes.
          low_factor: 0.8,
          high_factor: 1.4,
        },
        disclaimer:
          "Indicative pricing for planning only; the authoritative estimate is computed per run at estimate time.",
      }),
    );
  }

  @Get("v1/billing/overview")
  @CanRead()
  async overview(@TenantReq() req: TenantRequest) {
    // §12.3 entitlement projection: 30 s TTL keyed by the entitlement
    // generation (bumped by payment/subscription events) AND the wallet row
    // version (bumped by every ledger transaction). The database remains
    // authoritative for reservations — this projection is read-only. Both
    // freshness inputs are read without RLS dependencies: the version
    // integers are non-sensitive, and the workspace id came from verified
    // membership, so a wallet row hidden by RLS can never freeze the key at 0.
    const generation = await this.cache.generation(req.workspaceId, "entitlement");
    const { rows: walletRows } = await this.ownerPool.query<{ version: number }>(
      `SELECT version FROM wallets WHERE workspace_id = $1`,
      [req.workspaceId],
    );
    const walletVersion = walletRows[0]?.version ?? 0;
    return this.cache.through(
      "entitlement",
      "overview",
      {
        workspaceId: req.workspaceId,
        parameters: { wallet_version: walletVersion },
        generations: { entitlement: generation },
      },
      CACHE_TTLS.entitlement,
      async () =>
        this.tx.run({ workspaceId: req.workspaceId }, async (client) => {
          const balance = await this.ledger.balanceFromLedger(client, req.workspaceId);
          const { rows: subRows } = await client.query(
            `SELECT id, plan_code, status, current_period_start, current_period_end, cancel_at_period_end
             FROM subscriptions WHERE workspace_id = $1 ORDER BY created_at DESC LIMIT 1`,
            [req.workspaceId],
          );
          const { rows: ws } = await client.query<{ plan_code: string; billing_version: string }>(
            `SELECT plan_code, billing_version FROM workspaces WHERE id = $1`,
            [req.workspaceId],
          );
          const { rows: reserved } = await client.query<{ count: number; total: number }>(
            `SELECT COUNT(*)::int AS count, COALESCE(SUM(amount), 0)::int AS total
             FROM credit_reservations WHERE workspace_id = $1 AND status = 'active'`,
            [req.workspaceId],
          );
          return {
            plan: ws[0]?.plan_code ?? "explorer",
            billing_version: ws[0]?.billing_version ?? "",
            balance,
            active_reservations: reserved[0],
            subscription: subRows[0] ?? null,
            razorpay_configured: this.config.razorpayConfigured,
          };
        }),
    );
  }

  @Get("v1/billing/ledger")
  @CanRead()
  async ledgerEntries(@TenantReq() req: TenantRequest, @Query() query: Record<string, string>) {
    const { cursor, limit } = cursorQuerySchema.parse(query);
    const result = await this.tx.run({ workspaceId: req.workspaceId }, async (client) => {
      const cursorClause = cursor ? `AND (occurred_at, id) < ($2, $3)` : "";
      const params: unknown[] = cursor
        ? [req.workspaceId, cursor.split("|")[0], cursor.split("|")[1]]
        : [req.workspaceId];
      const { rows } = await client.query(
        `SELECT id, entry_type, amount, idempotency_key, rate_card_version, actor, event_ref, simulation_id, reason, occurred_at
         FROM credit_ledger_entries
         WHERE workspace_id = $1 ${cursorClause}
         ORDER BY occurred_at DESC, id DESC
         LIMIT ${limit + 1}`,
        params as string[],
      );
      return buildPage(rows as Record<string, unknown>[], limit, "occurred_at", "id");
    });
    return result;
  }

  @Get("v1/billing/usage")
  @CanRead()
  async usage(@TenantReq() req: TenantRequest, @Query() query: Record<string, string>) {
    const { cursor, limit } = cursorQuerySchema.parse(query);
    return this.tx.run({ workspaceId: req.workspaceId }, async (client) => {
      const cursorClause = cursor ? `AND (created_at, id) < ($2, $3)` : "";
      const params: unknown[] = cursor
        ? [req.workspaceId, cursor.split("|")[0], cursor.split("|")[1]]
        : [req.workspaceId];
      const { rows } = await client.query(
        `SELECT id, simulation_id, usage_type, provider, model_id, input_tokens, output_tokens,
                cached_input_tokens, cost_micro_usd, is_estimate, created_at
         FROM usage_records
         WHERE workspace_id = $1 ${cursorClause}
         ORDER BY created_at DESC, id DESC
         LIMIT ${limit + 1}`,
        params as string[],
      );
      return buildPage(rows as Record<string, unknown>[], limit, "created_at", "id");
    });
  }

  /** One-time credit pack: internal purchase + Razorpay order (server amount). */
  @Post("v1/billing/credit-packs")
  @CanManageBilling()
  async buyPack(@TenantReq() req: TenantRequest, @Body() body: unknown, @Headers("idempotency-key") idemKey?: string) {
    const input = packSchema.parse(body);
    const pack = packByCode(input.pack_code)!;
    if (!this.config.razorpayConfigured) throw problems.billingNotConfigured();

    const purchaseId = randomUUID();
    const order = await this.razorpay.createOrder({
      amountMinor: pack.priceMinor,
      currency: pack.currency,
      receipt: purchaseId,
      notes: { workspace: req.workspaceId, pack: pack.code },
    });
    await this.ownerPool.query(
      `INSERT INTO purchases (workspace_id, id, pack_code, credits, amount_minor, currency, razorpay_order_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (razorpay_order_id) DO NOTHING`,
      [req.workspaceId, purchaseId, pack.code, pack.credits, pack.priceMinor, pack.currency, order.id],
    );
    await this.audit.recordStandalone({
      workspaceId: req.workspaceId,
      actor: req.auth.userId,
      action: "billing.credit_pack.purchased",
      targetType: "purchase",
      targetId: purchaseId,
      requestId: req.requestId,
      metadata: { pack: pack.code, amount_minor: pack.priceMinor },
    });
    return {
      purchase_id: purchaseId,
      checkout: {
        provider: "razorpay",
        order_id: order.id,
        amount: pack.priceMinor,
        currency: pack.currency,
        key_id: this.config.RAZORPAY_KEY_ID,
        name: "CrowdLens credits",
        prefill: { email: req.auth.email },
      },
    };
  }

  /** Recurring plan: Razorpay customer + subscription + hosted checkout values. */
  @Post("v1/billing/subscriptions")
  @CanManageBilling()
  async subscribe(@TenantReq() req: TenantRequest, @Body() body: unknown) {
    const input = subscribeSchema.parse(body);
    const plan = planByCode(input.plan_code)!;
    if (!this.config.razorpayConfigured) throw problems.billingNotConfigured();
    const planIdField = this.config.RAZORPAY_MODE === "live" ? "razorpay_plan_id_live" : "razorpay_plan_id_test";
    const { rows: planRows } = await this.ownerPool.query<{ value: string }>(
      `SELECT ${planIdField} AS value FROM plans WHERE code = $1`,
      [plan.code],
    );
    const razorpayPlanId = planRows[0]?.value;
    if (!razorpayPlanId) {
      throw problems.billingNotConfigured();
    }
    const customer = await this.razorpay.createCustomer({
      email: req.auth.email,
      name: req.auth.displayName || req.auth.email,
      notes: { workspace: req.workspaceId },
    });
    const subscription = await this.razorpay.createSubscription({
      planId: razorpayPlanId,
      customerId: customer.id,
      totalCount: 120,
      notes: { workspace: req.workspaceId, plan: plan.code },
    });
    const subscriptionId = randomUUID();
    await this.ownerPool.query(
      `INSERT INTO subscriptions (workspace_id, id, plan_code, razorpay_customer_id, razorpay_subscription_id, status)
       VALUES ($1, $2, $3, $4, $5, 'pending')`,
      [req.workspaceId, subscriptionId, plan.code, customer.id, subscription.id],
    );
    await this.audit.recordStandalone({
      workspaceId: req.workspaceId,
      actor: req.auth.userId,
      action: "billing.subscription.created",
      targetType: "subscription",
      targetId: subscriptionId,
      requestId: req.requestId,
      metadata: { plan: plan.code },
    });
    return {
      subscription_id: subscriptionId,
      checkout: {
        provider: "razorpay",
        subscription_id: subscription.id,
        key_id: this.config.RAZORPAY_KEY_ID,
        name: `CrowdLens ${plan.name}`,
      },
    };
  }

  /** Cancellation at the paid-cycle boundary (launch policy, specs.md §9.2). */
  @Post("v1/billing/subscriptions/:id/cancel")
  @CanManageBilling()
  async cancel(@TenantReq() req: TenantRequest, @Param("id") id: string) {
    if (!this.config.razorpayConfigured) throw problems.billingNotConfigured();
    const { rows } = await this.ownerPool.query<{ razorpay_subscription_id: string }>(
      `SELECT razorpay_subscription_id FROM subscriptions WHERE workspace_id = $1 AND id = $2`,
      [req.workspaceId, id],
    );
    if (!rows[0]) throw problems.notFound("subscription");
    await this.ownerPool.query(
      `UPDATE subscriptions SET cancel_at_period_end = true, updated_at = now() WHERE id = $1`,
      [id],
    );
    await this.audit.recordStandalone({
      workspaceId: req.workspaceId,
      actor: req.auth.userId,
      action: "billing.subscription.cancel_requested",
      targetType: "subscription",
      targetId: id,
    });
    return { cancel_at_period_end: true };
  }
}
