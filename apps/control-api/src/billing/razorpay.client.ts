import { Inject, Injectable, Logger } from "@nestjs/common";
import { AppConfig, CONFIG_TOKEN } from "../config/env.js";
import { problems } from "../common/problem-details.js";

/**
 * Thin typed client over the Razorpay REST API (subscriptions, orders,
 * payments, customers). Credentials never leave the server; the browser only
 * ever receives server-issued order/subscription ids and the public key id.
 */
@Injectable()
export class RazorpayClient {
  private readonly logger = new Logger("razorpay");
  private readonly base = "https://api.razorpay.com/v1";

  constructor(@Inject(CONFIG_TOKEN) private readonly config: AppConfig) {}

  private authHeader(): string {
    return `Basic ${Buffer.from(
      `${this.config.RAZORPAY_KEY_ID}:${this.config.RAZORPAY_KEY_SECRET_REFERENCE}`,
    ).toString("base64")}`;
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    if (!this.config.razorpayConfigured) throw problems.billingNotConfigured();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(`${this.base}${path}`, {
        method,
        headers: { Authorization: this.authHeader(), "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await response.text();
      if (!response.ok) {
        this.logger.warn(`razorpay ${method} ${path} -> ${response.status}`);
        throw new Error(`Razorpay API ${response.status}: ${text.slice(0, 300)}`);
      }
      return JSON.parse(text) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  createCustomer(input: { email: string; name: string; notes?: Record<string, string> }) {
    return this.call<{ id: string }>("POST", "/customers", {
      email: input.email,
      name: input.name,
      notes: input.notes ?? {},
    });
  }

  createOrder(input: { amountMinor: number; currency: string; receipt: string; notes?: Record<string, string> }) {
    return this.call<{ id: string; amount: number; currency: string; status: string }>(
      "POST",
      "/orders",
      { amount: input.amountMinor, currency: input.currency, receipt: input.receipt, notes: input.notes ?? {} },
    );
  }

  fetchOrder(orderId: string) {
    return this.call<{ id: string; amount: number; currency: string; status: string }>(
      "GET",
      `/orders/${orderId}`,
    );
  }

  fetchPayment(paymentId: string) {
    return this.call<{ id: string; order_id: string; amount: number; currency: string; status: string }>(
      "GET",
      `/payments/${paymentId}`,
    );
  }

  createSubscription(input: {
    planId: string;
    customerId: string;
    totalCount: number;
    notes?: Record<string, string>;
  }) {
    return this.call<{ id: string; status: string; short_url?: string }>(
      "POST",
      "/subscriptions",
      {
        plan_id: input.planId,
        customer_id: input.customerId,
        total_count: input.totalCount,
        notes: input.notes ?? {},
      },
    );
  }

  fetchSubscription(subscriptionId: string) {
    return this.call<{
      id: string;
      status: string;
      plan_id: string;
      current_start?: number;
      current_end?: number;
    }>("GET", `/subscriptions/${subscriptionId}`);
  }

  createPlan(input: { period: "monthly"; interval: number; amountMinor: number; currency: string; name: string }) {
    return this.call<{ id: string }>("POST", "/plans", {
      period: input.period,
      interval: input.interval,
      item: { name: input.name, amount: input.amountMinor, currency: input.currency },
    });
  }
}
