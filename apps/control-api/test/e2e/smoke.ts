/**
 * End-to-end API smoke (local, no secrets): dev login → workspace → project →
 * document upload + parse → graph build → estimate → run → wait for worker →
 * report → share. Exits non-zero on failure. Used by pnpm smoke:e2e.
 */
const API = process.env.CONTROL_API_ORIGIN ?? "http://localhost:4000";

interface Session {
  cookies: string;
  csrf: string;
}

async function call(
  session: Session | null,
  method: string,
  path: string,
  body?: unknown,
  raw?: Buffer,
): Promise<{ status: number; json: () => Promise<Record<string, never>>; text: () => Promise<string>; headers: Headers }> {
  const headers: Record<string, string> = {};
  if (session) {
    headers["cookie"] = session.cookies;
    if (method !== "GET") headers["x-csrf-token"] = session.csrf;
  }
  let payload: BodyInit | undefined;
  if (raw) {
    headers["content-type"] = "application/octet-stream";
    payload = new Uint8Array(raw);
  } else if (body !== undefined) {
    headers["content-type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const response = await fetch(`${API}${path}`, { method, headers, body: payload });
  return {
    status: response.status,
    headers: response.headers,
    text: () => response.text(),
    json: async () => JSON.parse(await response.text()) as Record<string, never>,
  };
}

function jarFrom(setCookies: string[] | null, existing: Session): Session {
  if (!setCookies || setCookies.length === 0) return existing;
  let session = existing;
  for (const setCookie of setCookies) {
    const pair = setCookie.split(";")[0]!;
    const eq = pair.indexOf("=");
    const name = pair.slice(0, eq);
    const value = pair.slice(eq + 1);
    const cookies = session.cookies
      .split("; ")
      .filter((c) => c && !c.startsWith(`${name}=`))
      .concat(`${name}=${value}`)
      .join("; ");
    session = { cookies, csrf: name === "cl_csrf" ? value : session.csrf };
  }
  return session;
}

async function main(): Promise<void> {
  const email = `smoke-${Date.now()}@example.com`;
  const login = await call(null, "POST", "/v1/auth/dev/login", { email, display_name: "Smoke" });
  if (login.status !== 201) throw new Error(`login failed: ${login.status} ${await login.text()}`);
  let session: Session = jarFrom(
    (login.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? null,
    { cookies: "", csrf: "" },
  );

  const ws = await call(session, "POST", "/v1/workspaces", { name: "Smoke Workspace" });
  if (ws.status !== 201) throw new Error(`workspace failed: ${ws.status} ${await ws.text()}`);
  const workspace = (await ws.json())["workspace"] as unknown as { id: string };
  const H = { "x-workspace-id": workspace.id };

  const withWs = (s: Session): Session => ({ ...s, cookies: s.cookies }); // header handled below

  async function wsCall(method: string, path: string, body?: unknown, raw?: Buffer) {
    const headers: Record<string, string> = { cookie: session.cookies, ...H };
    if (method !== "GET") headers["x-csrf-token"] = session.csrf;
    let payload: BodyInit | undefined;
    if (raw) {
      headers["content-type"] = "application/octet-stream";
      payload = new Uint8Array(raw);
    } else if (body !== undefined) {
      headers["content-type"] = "application/json";
      payload = JSON.stringify(body);
    }
    const response = await fetch(`${API}${path}`, { method, headers, body: payload });
    return {
      status: response.status,
      headers: response.headers,
      text: () => response.text(),
      json: async () => JSON.parse(await response.text()) as Record<string, never>,
    };
  }
  void withWs;

  const proj = await wsCall("POST", "/v1/projects", {
    name: "Launch narrative test",
    decision_question: "Should we announce the pricing change in the launch post?",
  });
  if (proj.status !== 201) throw new Error(`project failed: ${proj.status} ${await proj.text()}`);
  const project = (await proj.json())["project"] as unknown as { id: string };

  const content = Buffer.from(
    "# Launch plan\n\nWe will announce the new pricing on Monday. Segment A cares about cost; Segment B cares about reliability. The rollout targets APAC first.",
    "utf8",
  );
  const { createHash } = await import("node:crypto");
  const sha = createHash("sha256").update(content).digest("hex");
  const init = await wsCall("POST", `/v1/projects/${project.id}/documents/init`, {
    filename: "launch.md",
    mime_type: "text/markdown",
    size_bytes: content.length,
    sha256: sha,
  });
  if (init.status !== 201) throw new Error(`doc init failed: ${init.status} ${await init.text()}`);
  const initBody = await init.json();
  const document = initBody["document"] as unknown as { id: string; parse_status: string };
  console.log(`document ${document.id} init parse_status=${document.parse_status}`);

  if (document.parse_status !== "parsed") {
    const up = await wsCall("PUT", `/v1/documents/${document.id}/content`, undefined, content);
    if (up.status !== 200 && up.status !== 201) {
      throw new Error(`doc upload failed: ${up.status} ${await up.text()}`);
    }
    console.log("document uploaded, parse enqueued");
  }

  // Wait for the parse worker before building the graph (cold workers can
  // need a couple of minutes to boot and connect on a fresh start).
  const parseDeadline = Date.now() + 120_000;
  for (;;) {
    const docState = await wsCall("GET", `/v1/documents/${document.id}`);
    const state = ((await docState.json())["document"] as unknown as { parse_status: string }).parse_status;
    if (state === "parsed") break;
    if (state === "failed") throw new Error("document parsing failed");
    if (Date.now() > parseDeadline) throw new Error("parsing timed out");
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  console.log("document parsed");

  const graph = await wsCall("POST", `/v1/projects/${project.id}/graph/build`, {});
  if (graph.status !== 201) throw new Error(`graph build failed: ${graph.status} ${await graph.text()}`);
  console.log(`graph ${(await graph.json())["graph_id"]} building`);

  // Wait for the graph worker to actually finish the build — a 201 here only
  // means the build was enqueued.
  const graphDeadline = Date.now() + 120_000;
  let graphFinal: { status: string; node_count: number; edge_count: number } | null = null;
  while (Date.now() < graphDeadline) {
    const g = await wsCall("GET", `/v1/projects/${project.id}/graph`);
    const gbody = (await g.json())["graph"] as unknown as
      | { status: string; node_count: number; edge_count: number }
      | null;
    if (gbody && ["ready", "failed"].includes(gbody.status)) {
      graphFinal = gbody;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  if (!graphFinal) throw new Error("graph did not finish within deadline (is graph-worker running?)");
  console.log(`graph status=${graphFinal.status} nodes=${graphFinal.node_count} edges=${graphFinal.edge_count}`);
  if (graphFinal.status !== "ready" || graphFinal.node_count === 0) {
    throw new Error(`graph build did not produce a usable graph: ${JSON.stringify(graphFinal)}`);
  }

  const est = await wsCall("POST", "/v1/simulations/estimate", {
    decision_question: "Should we announce the pricing change in the launch post?",
    population: 1000,
    active_budget: 64,
    ticks: 4,
    report_depth: "standard",
    max_credits: 200,
    provider: "mock",
  });
  if (est.status !== 201) throw new Error(`estimate failed: ${est.status} ${await est.text()}`);
  const estimate = await est.json();
  console.log(`estimate low=${estimate["credits_low"]} high=${estimate["credits_high"]} cap=${estimate["hard_cap"]}`);

  const run = await wsCall("POST", "/v1/simulations", {
    project_id: project.id,
    decision_question: "Should we announce the pricing change in the launch post?",
    population: 1000,
    active_budget: 64,
    ticks: 4,
    report_depth: "standard",
    max_credits: 200,
    provider: "mock",
    model_id: "mock-sim-1",
  });
  if (run.status !== 201) throw new Error(`simulation failed: ${run.status} ${await run.text()}`);
  const simulation = (await run.json())["simulation"] as unknown as { id: string; status: string; credits_reserved: number };
  console.log(`simulation ${simulation.id} status=${simulation.status} reserved=${simulation.credits_reserved}`);

  const deadline = Date.now() + 120_000;
  let final: { status: string; credits_used: number } | null = null;
  while (Date.now() < deadline) {
    const check = await wsCall("GET", `/v1/simulations/${simulation.id}`);
    const body = await check.json();
    const sim = body["simulation"] as unknown as { status: string; credits_used: number };
    const events = (body as Record<string, unknown>)["shards"] as unknown as unknown[];
    if (Math.random() < 0.2) console.log(`  … status=${sim.status} shards=${events.length}`);
    if (["completed", "failed", "cancelled"].includes(sim.status)) {
      final = sim;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  if (!final) throw new Error("simulation did not finish within deadline (are workers running?)");
  console.log(`final status=${final.status} credits_used=${final.credits_used}`);
  if (final.status !== "completed") {
    const check = await wsCall("GET", `/v1/simulations/${simulation.id}`);
    throw new Error(`run failed: ${await check.text()}`);
  }

  const overview = await wsCall("GET", "/v1/billing/overview");
  const billing = await overview.json();
  console.log(`balance=${JSON.stringify(billing["balance" as never])}`);

  // The report worker assembles the report asynchronously after completion.
  const reportDeadline = Date.now() + 120_000;
  let reportId = "";
  while (Date.now() < reportDeadline) {
    const detail = await wsCall("GET", `/v1/simulations/${simulation.id}`);
    const body = await detail.json();
    const report = body["report" as never] as unknown as { id: string } | null;
    if (report) {
      reportId = report.id;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  if (!reportId) throw new Error("report was not generated for the completed run");
  console.log(`report ${reportId} ready`);

  // Shares: create → public view → revoke → 404 (revocation beats cache).
  const share = await wsCall("POST", `/v1/reports/${reportId}/shares`, { scope: "summary", expires_in_hours: 24 });
  if (share.status !== 201) throw new Error(`share create failed: ${share.status} ${await share.text()}`);
  const shareBody = (await share.json()) as unknown as { token: string };
  const token = shareBody.token;
  const shareId = token.split(".")[0]!;
  const publicView = await fetch(`${API}/v1/report-shares/${token}/view`);
  if (publicView.status !== 200) throw new Error(`public share view failed: ${publicView.status}`);
  const viewed = (await publicView.json()) as { report: Record<string, unknown> };
  if (viewed.report["disclaimer"] === undefined) throw new Error("shared report lacks disclaimer");
  console.log("share view ok");
  const revoke = await wsCall("DELETE", `/v1/report-shares/${shareId}`);
  if (revoke.status !== 200) throw new Error(`share revoke failed: ${revoke.status}`);
  const afterRevoke = await fetch(`${API}/v1/report-shares/${token}/view`);
  if (afterRevoke.status !== 404) throw new Error(`revoked share still resolves: ${afterRevoke.status}`);
  console.log("share revoke ok (cached 200 not served)");

  // Interview: ask a synthetic agent, poll, require provenance disclosure.
  const ask = await wsCall("POST", `/v1/reports/${reportId}/interviews`, {
    agent_ref: "segment/advocates/agent/0",
    question: "Why did your segment react the way it did?",
  });
  if (ask.status !== 201) throw new Error(`interview create failed: ${ask.status} ${await ask.text()}`);
  const interviewId = ((await ask.json()) as unknown as { interview_id: string }).interview_id;
  const interviewDeadline = Date.now() + 90_000;
  let interviewFinal: { status: string; response: Record<string, unknown> | null } | null = null;
  // Interviews complete into status 'ready' (same vocabulary as reports).
  const INTERVIEW_DONE = ["ready", "completed", "failed"];
  while (Date.now() < interviewDeadline) {
    const check = await wsCall("GET", `/v1/interviews/${interviewId}`);
    const interview = ((await check.json()) as unknown as { interview: { status: string; response: Record<string, unknown> | null } }).interview;
    if (INTERVIEW_DONE.includes(interview.status)) {
      interviewFinal = interview;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  if (!interviewFinal || !["ready", "completed"].includes(interviewFinal.status)) {
    throw new Error(`interview did not complete: ${JSON.stringify(interviewFinal)}`);
  }
  if (interviewFinal.response?.["provenance_disclosure"] === undefined) {
    throw new Error("interview response lacks provenance disclosure");
  }
  console.log(`interview ok (disclosure: ${interviewFinal.response["provenance_disclosure"]})`);

  console.log("SMOKE OK");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

export {};
