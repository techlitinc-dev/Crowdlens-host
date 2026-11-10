import { Body, Controller, Get, Headers, Ip, Post, Res } from "@nestjs/common";
import { z } from "zod";
import type { Response } from "express";
import { IdentityService } from "./identity.service.js";
import { SessionService } from "./session.service.js";
import { RateLimiter } from "../common/rate-limit.js";
import { problems } from "../common/problem-details.js";
import { Public, WorkspaceContextOptional } from "../common/public.js";
import { Req, CanRead } from "./rbac.js";
import type { TenantRequest } from "./auth-context.js";
import { CSRF_COOKIE, SESSION_COOKIE, cookieHeader } from "./auth-context.js";
import { Inject } from "@nestjs/common";
import pg from "pg";
import { PG_APP_POOL } from "../db/pg.module.js";
import { AppConfig, CONFIG_TOKEN } from "../config/env.js";

const devLoginSchema = z.object({
  email: z.string().email().max(320),
  display_name: z.string().max(120).optional(),
});

interface WorkspaceMembershipRow {
  workspace_id: string;
  slug: string;
  name: string;
  role: string;
  authz_epoch: number;
  plan_code: string;
}

@Controller("v1/auth")
export class AuthController {
  private readonly loginLimiter = new RateLimiter(10, 60_000);

  constructor(
    @Inject(IdentityService) private readonly identity: IdentityService,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(PG_APP_POOL) private readonly pool: pg.Pool,
    @Inject(CONFIG_TOKEN) private readonly config: AppConfig,
  ) {}

  /**
   * Development identity provider: establishes a session for an email.
   * Only active when OIDC is not configured; never available in production
   * without explicit configuration (documented dev route).
   */
  @Public()
  @Post("dev/login")
  async devLogin(
    @Body() body: unknown,
    @Ip() ip: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!this.config.devIdentity) {
      throw problems.forbidden("Development identity provider is disabled");
    }
    this.loginLimiter.consume(`devlogin:${ip}`);
    const input = devLoginSchema.parse(body);
    const email = input.email.toLowerCase();
    const user = await this.identity.provision({
      issuer: "dev",
      subject: email,
      email,
      displayName: input.display_name ?? email.split("@")[0]!,
    });
    const session = await this.sessions.create(user.id);
    res.appendHeader("Set-Cookie", [
      cookieHeader(SESSION_COOKIE, session.token, session.maxAge),
      cookieHeader(CSRF_COOKIE, session.csrf, session.maxAge),
    ]);
    return { user: { id: user.id, email: user.email, display_name: user.display_name } };
  }

  @Post("logout")
  @WorkspaceContextOptional()
  async logout(
    @Req() req: TenantRequest,
    @Headers("cookie") cookieHeaderValue: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const cookies: Record<string, string> = {};
    for (const part of (cookieHeaderValue ?? "").split(";")) {
      const eq = part.indexOf("=");
      if (eq < 0) continue;
      const key = part.slice(0, eq).trim();
      const value = part.slice(eq + 1).trim();
      if (key) cookies[key] = decodeURIComponent(value);
    }
    if (cookies[SESSION_COOKIE]) await this.sessions.revoke(cookies[SESSION_COOKIE]!);
    res.appendHeader("Set-Cookie", [
      cookieHeader(SESSION_COOKIE, "", 0),
      cookieHeader(CSRF_COOKIE, "", 0),
    ]);
    return { ok: true };
  }

  /** Current user + their workspace memberships (explicit switch, ACC-02). */
  @Get("me")
  @WorkspaceContextOptional()
  async me(@Req() req: TenantRequest) {
    const { rows } = await this.pool.query<WorkspaceMembershipRow>(
      `SELECT m.workspace_id, w.slug, w.name, m.role, w.authz_epoch, w.plan_code
       FROM memberships m JOIN workspaces w ON w.id = m.workspace_id
       WHERE m.user_id = $1 AND w.status = 'active'
       ORDER BY m.created_at`,
      [req.auth.userId],
    );
    return {
      user: {
        id: req.auth.userId,
        email: req.auth.email,
        display_name: req.auth.displayName,
      },
      dev_identity: this.config.devIdentity,
      workspaces: rows.map((row) => ({
        id: row.workspace_id,
        slug: row.slug,
        name: row.name,
        role: row.role,
        plan_code: row.plan_code,
      })),
    };
  }

  /** Session liveness probe used by the web app. */
  @Get("session")
  @CanRead()
  @WorkspaceContextOptional()
  async session(@Req() req: TenantRequest) {
    return { active: true, user_id: req.auth.userId, workspace: req.workspaceId || null };
  }
}
