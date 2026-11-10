import type { Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";
import supertest from "supertest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import { AppModule } from "../../src/app.module.js";
import { migrate } from "../../src/db/migrate.js";

export const TEST_PG_PORT = 55433;
const WEBHOOK_SECRET = "whsec-integration-fixture";

export interface TestContext {
  server: Server;
  ownerPool: pg.Pool;
  dataDir: string;
  storageDir: string;
  stop: () => Promise<void>;
}

/** Boot a fresh embedded Postgres + the full Nest application for testing. */
export async function bootTestApp(): Promise<TestContext> {
  const dataDir = await mkdtemp(path.join(tmpdir(), "crowdlens-pg-"));
  const storageDir = await mkdtemp(path.join(tmpdir(), "crowdlens-obj-"));

  const { default: EmbeddedPostgres } = (await import("embedded-postgres")) as {
    default: new (opts: {
      databaseDir: string;
      user: string;
      password: string;
      port: number;
      persistent: boolean;
    }) => { initialise(): Promise<void>; start(): Promise<void>; stop(): Promise<void> };
  };
  const embedded = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "postgres",
    password: "postgres",
    port: TEST_PG_PORT,
    persistent: false,
  });
  await embedded.initialise();
  await embedded.start();

  // Database + migrations as the owner, before the app connects.
  const admin = new pg.Client({
    host: "localhost",
    port: TEST_PG_PORT,
    user: "postgres",
    password: "postgres",
    database: "postgres",
  });
  await admin.connect();
  await admin.query(`CREATE DATABASE crowdlens`);
  await admin.end();
  const owner = new pg.Client({
    host: "localhost",
    port: TEST_PG_PORT,
    user: "postgres",
    password: "postgres",
    database: "crowdlens",
  });
  await owner.connect();
  await migrate(owner);
  await owner.end();

  process.env.DATABASE_URL = `postgres://postgres:postgres@localhost:${TEST_PG_PORT}/crowdlens`;
  process.env.CROWDLENS_APP_PASSWORD = "crowdlens_app_dev";
  process.env.EMBEDDED_PG_DATA_DIR = "";
  process.env.STORAGE_FS_DIR = storageDir;
  process.env.RAZORPAY_WEBHOOK_SECRET_REFERENCE = WEBHOOK_SECRET;
  process.env.SESSION_SECRET_REFERENCE = "integration-test-secret-0123456789";

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  // createNestApplication(serverOrOptions, options): with no server instance
  // the FIRST argument is the options object (rawBody is required for the
  // Razorpay webhook HMAC path).
  const app = moduleRef.createNestApplication<NestExpressApplication>({
    rawBody: true,
    bodyParser: true,
  });
  await app.init();
  const server = app.getHttpServer() as Server;
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  const ownerPool = new pg.Pool({
    connectionString: `postgres://postgres:postgres@localhost:${TEST_PG_PORT}/crowdlens`,
  });

  return {
    server,
    ownerPool,
    dataDir,
    storageDir,
    stop: async () => {
      await app.close();
      await ownerPool.end();
      await embedded.stop();
      await rm(dataDir, { recursive: true, force: true });
      await rm(storageDir, { recursive: true, force: true });
    },
  };
}

export interface Session {
  cookies: string;
  csrf: string;
  userId: string;
  workspaceId: string;
  email: string;
}

/** Dev-login and workspace creation, mirroring the browser flow. */
export async function loginWithWorkspace(
  server: Server,
  email: string,
  workspaceName = "Integration Workspace",
): Promise<Session> {
  const login = await supertest(server).post("/v1/auth/dev/login").send({ email, display_name: "IT User" });
  if (login.status !== 201) {
    throw new Error(`dev login failed: ${login.status} ${login.text}`);
  }
  const session = absorbCookies(
    { cookies: "", csrf: "", userId: "", workspaceId: "", email },
    login.headers["set-cookie"],
  );
  const ws = await supertest(server)
    .post("/v1/workspaces")
    .set("cookie", session.cookies)
    .set("x-csrf-token", session.csrf)
    .send({ name: workspaceName });
  if (ws.status !== 201) {
    throw new Error(`workspace create failed: ${ws.status} ${ws.text}`);
  }
  absorbCookies(session, ws.headers["set-cookie"]);
  session.workspaceId = (ws.body as { workspace: { id: string } }).workspace.id;
  session.userId = (login.body as { user: { id: string } }).user?.id ?? "";
  return session;
}

function absorbCookies(session: Session, setCookie: unknown): Session {
  if (!setCookie) return session;
  const list = Array.isArray(setCookie) ? (setCookie as string[]) : [setCookie as string];
  for (const header of list) {
    const pair = header.split(";")[0]!;
    const eq = pair.indexOf("=");
    const name = pair.slice(0, eq);
    const value = pair.slice(eq + 1);
    const cookies = session.cookies
      .split("; ")
      .filter((c) => c && !c.startsWith(`${name}=`))
      .concat(`${name}=${value}`)
      .join("; ");
    session.cookies = cookies;
    if (name === "cl_csrf") session.csrf = value;
  }
  return session;
}

/** Authenticated workspace-scoped request with CSRF + cookie rotation. */
export async function call(
  server: Server,
  session: Session,
  method: "get" | "post" | "put" | "patch" | "delete",
  path: string,
  body?: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<supertest.Response> {
  const builder = supertest(server)[method](path);
  builder.set("cookie", session.cookies);
  builder.set("x-csrf-token", session.csrf);
  if (session.workspaceId) builder.set("x-workspace-id", session.workspaceId);
  for (const [key, value] of Object.entries(extraHeaders)) builder.set(key, value);
  if (body !== undefined) builder.send(body as Record<string, unknown>);
  const response = await builder;
  absorbCookies(session, response.headers["set-cookie"]);
  return response;
}

export { WEBHOOK_SECRET };
