/**
 * WP-07 kill-resume validation: start a 100k x 24-tick mock run, advance to
 * tick >= 3, then the operator kills the simulation worker (outside this
 * script), restarts it, and the run must complete exactly once — no
 * duplicated usage records, exactly one settlement.
 *
 * The script prints MARKER lines so the operator can time the kill:
 *   KILL_WINDOW_OPEN   -> stop the simulation worker now
 *   KILL_WINDOW_CLOSE  -> restart it now
 */
const API = process.env.CONTROL_API_ORIGIN ?? "http://localhost:4000";

interface Session { cookies: string; csrf: string }

async function call(session: Session | null, method: string, path: string, body?: unknown, workspaceId?: string) {
  const headers: Record<string, string> = {};
  if (session) {
    headers["cookie"] = session.cookies;
    if (method !== "GET") headers["x-csrf-token"] = session.csrf;
  }
  if (workspaceId) headers["x-workspace-id"] = workspaceId;
  let payload: BodyInit | undefined;
  if (body !== undefined) {
    headers["content-type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const response = await fetch(`${API}${path}`, { method, headers, body: payload });
  return {
    status: response.status,
    text: () => response.text(),
    json: () => response.json(),
    headers: response.headers,
  };
}

function jarFrom(setCookies: string[] | null, existing: Session): Session {
  let session = existing;
  for (const sc of setCookies ?? []) {
    const pair = sc.split(";")[0]!;
    const eq = pair.indexOf("=");
    const name = pair.slice(0, eq);
    const value = pair.slice(eq + 1);
    session = {
      cookies: session.cookies.split("; ").filter((c) => c && !c.startsWith(`${name}=`)).concat(`${name}=${value}`).join("; "),
      csrf: name === "cl_csrf" ? value : session.csrf,
    };
  }
  return session;
}

async function main() {
  const login = await call(null, "POST", "/v1/auth/dev/login", { email: `kr-${Date.now()}@example.com`, display_name: "KR" });
  let session: Session = jarFrom((login.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? null, { cookies: "", csrf: "" });
  const ws = await call(session, "POST", "/v1/workspaces", { name: "KillResume" });
  session = jarFrom((ws.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? null, session);
  const workspaceId = ((await ws.json()) as { workspace: { id: string } }).workspace.id;

  const proj = await call(session, "POST", "/v1/projects", { name: "Kill resume validation", decision_question: "Does checkpoint resume duplicate work?" }, workspaceId);
  const projectId = ((await proj.json()) as { project: { id: string } }).project.id;

  const content = Buffer.from("# Kill resume\n\nA bounded validation document. Segment A cares about cost.", "utf8");
  const { createHash } = await import("node:crypto");
  const sha = createHash("sha256").update(content).digest("hex");
  const init = await call(session, "POST", `/v1/projects/${projectId}/documents/init`, { filename: "kr.md", mime_type: "text/markdown", size_bytes: content.length, sha256: sha }, workspaceId);
  const doc = ((await init.json()) as { document: { id: string; parse_status: string } }).document;
  if (doc.parse_status !== "parsed") {
    await fetch(`${API}/v1/documents/${doc.id}/content`, {
      method: "PUT",
      headers: { cookie: session.cookies, "x-csrf-token": session.csrf, "x-workspace-id": workspaceId, "content-type": "application/octet-stream" },
      body: new Uint8Array(content),
    });
  }

  const run = await call(session, "POST", "/v1/simulations", {
    project_id: projectId,
    decision_question: "Does checkpoint resume duplicate work?",
    population: 10_000,
    active_budget: 512,
    ticks: 100,
    report_depth: "standard",
    max_credits: 300,
    provider: "mock",
    model_id: "mock-sim-1",
  }, workspaceId);
  if (run.status !== 201) throw new Error(`run create failed: ${run.status} ${await run.text()}`);
  const simId = ((await run.json()) as { simulation: { id: string; credits_reserved: number } }).simulation.id;
  console.log(`run ${simId} reserved; waiting to reach tick >= 3`);

  // Advance to a mid-run state.
  let tick = 0;
  const advanceDeadline = Date.now() + 240_000;
  while (Date.now() < advanceDeadline) {
    const check = await call(session, "GET", `/v1/simulations/${simId}`, undefined, workspaceId);
    const body = (await check.json()) as { simulation: { status: string }; shards: { tick: number }[] };
    tick = Math.max(...body.shards.map((s) => s.tick), 0);
    if (tick >= 3) break;
    if (["failed", "cancelled", "completed"].includes(body.simulation.status)) {
      throw new Error(`run ended prematurely (${body.simulation.status}) at tick ${tick}`);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  if (tick < 3) throw new Error(`run never reached tick 3 (tick=${tick})`);
  if (tick >= 100) throw new Error("run finished before the kill window opened");
  console.log(`MARKER KILL_WINDOW_OPEN tick=${tick} — kill the simulation worker now`);

  // Downtime window: the operator kills + restarts the worker during this sleep.
  await new Promise((r) => setTimeout(r, 45_000));
  console.log("MARKER KILL_WINDOW_CLOSE — worker should be restarting");

  // Wait for completion (lease reclaim can take up to 120s + run time).
  const doneDeadline = Date.now() + 420_000;
  let final: { status: string; credits_used: number } | null = null;
  let lastLoggedTick = -1;
  while (Date.now() < doneDeadline) {
    const check = await call(session, "GET", `/v1/simulations/${simId}`, undefined, workspaceId);
    const body = (await check.json()) as { simulation: { status: string; credits_used: number }; shards: { tick: number }[] };
    const nowTick = Math.max(...body.shards.map((s) => s.tick), 0);
    if (nowTick !== lastLoggedTick) {
      console.log(`  tick=${nowTick} status=${body.simulation.status}`);
      lastLoggedTick = nowTick;
    }
    if (["completed", "failed", "cancelled"].includes(body.simulation.status)) {
      final = body.simulation;
      break;
    }
    await new Promise((r) => setTimeout(r, 4000));
  }
  if (!final) throw new Error("run did not complete after worker restart");
  console.log(`final status=${final.status} credits_used=${final.credits_used}`);
  if (final.status !== "completed") throw new Error(`run did not complete cleanly: ${JSON.stringify(final)}`);
  if (final.credits_used <= 0) throw new Error("expected positive usage");

  // Exactly one settlement: one usage_debit + one release for this run.
  const ledger = await call(session, "GET", `/v1/billing/ledger?limit=100`, undefined, workspaceId);
  const ledgerBody = (await ledger.json()) as unknown as { items?: { entry_type: string; simulation_id: string | null; amount: number }[] };
  if (!ledgerBody.items) throw new Error(`ledger response unexpected: ${JSON.stringify(ledgerBody).slice(0, 300)}`);
  const entries = ledgerBody.items.filter((e) => e.simulation_id === simId);
  const debits = entries.filter((e) => e.entry_type === "usage_debit");
  const releases = entries.filter((e) => e.entry_type === "reservation_release");
  if (debits.length !== 1) throw new Error(`expected exactly 1 usage_debit, got ${debits.length}`);
  if (releases.length > 1) throw new Error(`expected at most 1 reservation_release, got ${releases.length}`);
  if (releases.length === 0 && debits[0]!.amount !== 300) throw new Error("release missing though the cap was not fully used");
  if (debits[0]!.amount !== final.credits_used) throw new Error("debit does not match credits_used");
  console.log(`settlement exactly-once ok (debit ${debits[0]!.amount}, release ${releases[0]!.amount})`);

  console.log("KILL-RESUME OK");
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

export {};
