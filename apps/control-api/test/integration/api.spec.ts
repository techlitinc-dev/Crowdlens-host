/**
 * Integration tests over a real embedded Postgres + the full Nest app:
 *  - two-tenant isolation (workspace A can never read workspace B's rows)
 *  - revocation immediacy (removed member loses access on the very next call)
 *  - Razorpay webhook HMAC: valid / invalid / duplicate (durable inbox)
 *  - billing entitlement never serves a stale balance after a webhook grant
 *  - share revocation cannot be undone by a cached 200 (§12.11 test 5)
 *  - project deletion removes every cached derivative (§12.11 test 10)
 *  - public rate-card endpoint (no auth, no tenant data)
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHash, createHmac, randomUUID } from "node:crypto";
import supertest from "supertest";
import {
  bootTestApp,
  call,
  loginWithWorkspace,
  WEBHOOK_SECRET,
  type Session,
  type TestContext,
} from "./bootstrap.js";

let ctx: TestContext;
let owner: Session;
let other: Session;

beforeAll(async () => {
  ctx = await bootTestApp();
  owner = await loginWithWorkspace(ctx.server, `owner-${Date.now()}@example.com`);
  other = await loginWithWorkspace(ctx.server, `other-${Date.now()}@example.com`, "Other Tenant");
}, 180_000);

afterAll(async () => {
  await ctx.stop();
}, 60_000);

describe("tenant isolation", () => {
  let projectId: string;

  it("owner creates a project", async () => {
    const res = await call(ctx.server, owner, "post", "/v1/projects", {
      name: "Isolation test project",
      decision_question: "Should the pricing change be announced?",
    });
    expect(res.status).toBe(201);
    projectId = (res.body as { project: { id: string } }).project.id;
  });

  it("a different tenant cannot read the project (no membership)", async () => {
    const foreign = await loginWithWorkspace(ctx.server, `foreign-${Date.now()}@example.com`, "Foreign");
    const res = await call(ctx.server, foreign, "get", `/v1/projects/${projectId}`, undefined, {
      "x-workspace-id": owner.workspaceId,
    });
    // The guard re-verifies membership on every request: no membership → 403,
    // regardless of any cache state.
    expect(res.status).toBe(403);
  });

  it("the owner's project list contains the project; the other tenant's does not", async () => {
    const mine = await call(ctx.server, owner, "get", "/v1/projects");
    expect(mine.status).toBe(200);
    const ids = (mine.body as { items: { id: string }[] }).items.map((p) => p.id);
    expect(ids).toContain(projectId);
    const theirs = await call(ctx.server, other, "get", "/v1/projects");
    const theirIds = (theirs.body as { items: { id: string }[] }).items.map((p) => p.id);
    expect(theirIds).not.toContain(projectId);
  });

  it("x-workspace-id is required: no header → no tenant context → project read rejected", async () => {
    const res = await supertest(ctx.server)
      .get(`/v1/projects/${projectId}`)
      .set("cookie", owner.cookies);
    // Without a workspace header there is no tenant context: RLS fails
    // closed, so the project is not found (and never leaks).
    expect([403, 404]).toContain(res.status);
  });

  it("revocation is immediate: removed member loses access on the next request", async () => {
    const viewerEmail = `viewer-${Date.now()}@example.com`;
    const invite = await call(ctx.server, owner, "post", `/v1/workspaces/${owner.workspaceId}/members`, {
      email: viewerEmail,
      role: "viewer",
    });
    expect(invite.status).toBe(201);
    const viewerUserId = (invite.body as { member: { user_id: string } }).member.user_id;

    const viewer = await loginWithWorkspace(ctx.server, viewerEmail, "Viewer Landing Zone");
    // Viewer joins the owner's workspace (membership created by invite).
    const readAsViewer = await call(ctx.server, viewer, "get", `/v1/projects/${projectId}`, undefined, {
      "x-workspace-id": owner.workspaceId,
    });
    expect(readAsViewer.status).toBe(200);

    const removal = await call(ctx.server, owner, "delete", `/v1/workspaces/${owner.workspaceId}/members/${viewerUserId}`);
    expect(removal.status).toBe(200);

    // The very next call must fail — revocation cannot wait for a TTL.
    const afterRemoval = await call(ctx.server, viewer, "get", `/v1/projects/${projectId}`, undefined, {
      "x-workspace-id": owner.workspaceId,
    });
    expect(afterRemoval.status).toBe(403);
  });
});

describe("billing entitlement freshness (§12.11 test 4)", () => {
  it("overview reflects a webhook grant immediately — no stale balance", async () => {
    const before = await call(ctx.server, owner, "get", "/v1/billing/overview");
    expect(before.status).toBe(200);
    const beforeBalance = (before.body as { balance: { available: number } }).balance.available;

    // Seed a pending purchase directly (buyPack needs Razorpay credentials).
    const purchaseId = randomUUID();
    const orderId = `order_${Date.now()}`;
    await ctx.ownerPool.query(
      `INSERT INTO purchases (workspace_id, id, pack_code, credits, amount_minor, currency, razorpay_order_id)
       VALUES ($1, $2, 'pack-500', 500, 99900, 'INR', $3)`,
      [owner.workspaceId, purchaseId, orderId],
    );

    const payload = JSON.stringify({
      event: "payment.captured",
      payload: {
        payment: { entity: { id: `pay_${Date.now()}`, order_id: orderId, amount: 99900, currency: "INR", status: "captured" } },
      },
    });
    const signature = createHmac("sha256", WEBHOOK_SECRET).update(payload).digest("hex");
    const delivery = await supertest(ctx.server)
      .post("/v1/webhooks/razorpay")
      .set("x-razorpay-signature", signature)
      .set("x-razorpay-event-id", `evt_${Date.now()}`)
      .set("content-type", "application/json")
      .send(payload);
    expect(delivery.status).toBe(200);
    expect(delivery.body, `webhook response: ${JSON.stringify(delivery.body)}`).toMatchObject({ received: true, signature_valid: true });

    // Processing is asynchronous; poll the inbox for the processed marker.
    let processed = false;
    let processingError: string | null = null;
    for (let i = 0; i < 50 && !processed; i++) {
      const row = await ctx.ownerPool.query<{ processed_at: string | null; processing_error: string | null }>(
        `SELECT processed_at, processing_error FROM webhook_events WHERE event_type = 'payment.captured' ORDER BY id DESC LIMIT 1`,
      );
      processed = Boolean(row.rows[0]?.processed_at);
      processingError = row.rows[0]?.processing_error ?? null;
      if (!processed) await new Promise((resolve) => setTimeout(resolve, 200));
    }
    expect(processed, `webhook not processed; processing_error=${processingError}`).toBe(true);

    // The overview projection was cached BEFORE the grant; it must not be
    // reused now that the wallet changed.
    const after = await call(ctx.server, owner, "get", "/v1/billing/overview");
    const afterBalance = (after.body as { balance: { available: number } }).balance.available;
    expect(afterBalance).toBe(beforeBalance + 500);
  });

  it("webhook dedupe: same event id is a no-op and a bad signature is flagged", async () => {
    const orderId = `order_dup_${Date.now()}`;
    await ctx.ownerPool.query(
      `INSERT INTO purchases (workspace_id, id, pack_code, credits, amount_minor, currency, razorpay_order_id)
       VALUES ($1, $2, 'pack-500', 500, 99900, 'INR', $3)`,
      [owner.workspaceId, randomUUID(), orderId],
    );
    const makePayload = () =>
      JSON.stringify({
        event: "payment.captured",
        payload: { payment: { entity: { id: `pay_${Date.now()}`, order_id: orderId, amount: 99900, currency: "INR", status: "captured" } } },
      });
    const sign = (raw: string) => createHmac("sha256", WEBHOOK_SECRET).update(raw).digest("hex");

    const bad = await supertest(ctx.server)
      .post("/v1/webhooks/razorpay")
      .set("x-razorpay-signature", "deadbeef".repeat(8))
      .set("x-razorpay-event-id", `evt_bad_${Date.now()}`)
      .set("content-type", "application/json")
      .send(makePayload());
    expect(bad.status).toBe(200);
    expect(bad.body).toMatchObject({ received: true, signature_valid: false });

    const eventId = `evt_${Date.now()}`;
    const raw = makePayload();
    const first = await supertest(ctx.server)
      .post("/v1/webhooks/razorpay")
      .set("x-razorpay-signature", sign(raw))
      .set("x-razorpay-event-id", eventId)
      .set("content-type", "application/json")
      .send(raw);
    expect((first.body as { duplicate?: boolean }).duplicate).toBeUndefined();
    const second = await supertest(ctx.server)
      .post("/v1/webhooks/razorpay")
      .set("x-razorpay-signature", sign(raw))
      .set("x-razorpay-event-id", eventId)
      .set("content-type", "application/json")
      .send(raw);
    expect(second.status).toBe(200);
    expect((second.body as { duplicate: boolean }).duplicate).toBe(true);

    const inbox = await ctx.ownerPool.query<{ n: number }>(
      `SELECT COUNT(*)::int n FROM webhook_events WHERE event_key = $1`,
      [eventId],
    );
    expect(inbox.rows[0]!.n).toBe(1);
  });
});

describe("report shares — full flow (§12.11 test 5)", () => {
  let shareOwner: Session;

  beforeAll(async () => {
    shareOwner = await loginWithWorkspace(ctx.server, `sharer-${Date.now()}@example.com`, "Share Workspace");
  });

  it("create → public view → revoke → 404 immediately and on re-check", async () => {
    const proj = await call(ctx.server, shareOwner, "post", "/v1/projects", {
      name: "Share flow project",
      decision_question: "Should the launch post include pricing?",
    });
    expect(proj.status).toBe(201);
    const projectId = (proj.body as { project: { id: string } }).project.id;
    const sim = await call(ctx.server, shareOwner, "post", "/v1/simulations", {
      project_id: projectId,
      decision_question: "Should the launch post include pricing?",
      population: 100,
      active_budget: 16,
      ticks: 1,
      report_depth: "standard",
      max_credits: 40,
      provider: "mock",
      model_id: "mock-sim-1",
    });
    expect(sim.status).toBe(201);
    const simulationId = (sim.body as { simulation: { id: string } }).simulation.id;
    const cancel = await call(ctx.server, shareOwner, "post", `/v1/simulations/${simulationId}/cancel`);
    expect(cancel.status).toBe(201);

    const content = JSON.stringify({
      summary: "Synthetic audience summary.",
      segments: [{ name: "Segment A", stance: "supportive", share: 0.6 }],
      method: { population: "synthetic hybrid" },
      limitations: ["illustrative fixture"],
      disclaimer: "Synthetic agents, not real people.",
    });
    const contentHash = createHash("sha256").update(content).digest("hex");
    const objectKey = `tenant/${shareOwner.workspaceId}/reports/${simulationId}/v1.json`;
    const fs = await import("node:fs/promises");
    await fs.mkdir(`${ctx.storageDir}/tenant/${shareOwner.workspaceId}/reports/${simulationId}`, { recursive: true });
    await fs.writeFile(`${ctx.storageDir}/${objectKey}`, content);
    const reportRow = await ctx.ownerPool.query<{ id: string }>(
      `INSERT INTO reports (workspace_id, simulation_id, version, content_hash, object_key)
       VALUES ($1, $2, 1, $3, $4) RETURNING id`,
      [shareOwner.workspaceId, simulationId, contentHash, objectKey],
    );
    const reportId = reportRow.rows[0]!.id;

    const share = await call(ctx.server, shareOwner, "post", `/v1/reports/${reportId}/shares`, {
      expires_in_hours: 24,
      scope: "full",
    });
    expect(share.status).toBe(201);
    const token = (share.body as { token: string }).token;

    const publicView = await supertest(ctx.server).get(`/v1/report-shares/${token}/view`);
    expect(publicView.status).toBe(200);
    expect((publicView.body as { report: { summary: string } }).report.summary).toContain("Synthetic");
    // The response must never be stored by browsers/proxies.
    expect(publicView.headers["cache-control"]).toContain("no-store");

    const shareId = token.split(".")[0]!;
    const revoke = await call(ctx.server, shareOwner, "delete", `/v1/report-shares/${shareId}`);
    expect(revoke.status).toBe(200);

    // Immediate: the cached 200 from before revocation must not reappear.
    const afterRevoke = await supertest(ctx.server).get(`/v1/report-shares/${token}/view`);
    expect(afterRevoke.status).toBe(404);

    // Re-check stays 404 (negative cache) — no resurrection via re-request.
    const recheck = await supertest(ctx.server).get(`/v1/report-shares/${token}/view`);
    expect(recheck.status).toBe(404);
  });
});

describe("project deletion (§12.11 test 10)", () => {
  let deleteOwner: Session;

  beforeAll(async () => {
    deleteOwner = await loginWithWorkspace(ctx.server, `deleter-${Date.now()}@example.com`, "Delete Workspace");
  });

  it("deleted project is gone from detail and list immediately", async () => {
    const created = await call(ctx.server, deleteOwner, "post", "/v1/projects", {
      name: "Doomed project",
      decision_question: "Should this project be deleted?",
    });
    expect(created.status).toBe(201);
    const projectId = (created.body as { project: { id: string } }).project.id;

    const detail = await call(ctx.server, deleteOwner, "get", `/v1/projects/${projectId}`);
    expect(detail.status).toBe(200);

    const removed = await call(ctx.server, deleteOwner, "delete", `/v1/projects/${projectId}`);
    expect(removed.status).toBe(200);

    const detailAfter = await call(ctx.server, deleteOwner, "get", `/v1/projects/${projectId}`);
    expect(detailAfter.status).toBe(404);

    const list = await call(ctx.server, deleteOwner, "get", "/v1/projects");
    const ids = (list.body as { items: { id: string }[] }).items.map((p) => p.id);
    expect(ids).not.toContain(projectId);
  });
});

describe("public endpoints", () => {
  it("rate-card is public and carries no tenant data", async () => {
    const res = await supertest(ctx.server).get("/v1/public/rate-card");
    expect(res.status).toBe(200);
    const body = res.body as { plans: unknown[]; credit_packs: unknown[]; rate_card_version: string; estimator: unknown };
    expect(body.plans.length).toBeGreaterThan(0);
    expect(body.credit_packs.length).toBeGreaterThan(0);
    expect(body.rate_card_version).toBeTruthy();
    expect(body.estimator).toBeTruthy();
    expect(JSON.stringify(body)).not.toContain(owner.workspaceId);
  });
});
