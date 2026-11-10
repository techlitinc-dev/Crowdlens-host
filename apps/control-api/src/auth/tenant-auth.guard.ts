import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Role } from "@crowdlens/contracts";
import { SessionService } from "./session.service.js";
import { CSRF_COOKIE, SESSION_COOKIE, parseCookies, type TenantRequest } from "./auth-context.js";
import { IS_PUBLIC_KEY, CSRF_EXEMPT_KEY, WORKSPACE_OPTIONAL_KEY } from "../common/public.js";
import { problems } from "../common/problem-details.js";
import { PG_APP_POOL } from "../db/pg.module.js";
import { Inject } from "@nestjs/common";
import pg from "pg";

export const WORKSPACE_HEADER = "x-workspace-id";

/**
 * Resolves the verified tenant context for every request:
 *  1. Session cookie → validated session (revocation-aware, immediate).
 *  2. x-workspace-id header → fresh membership check (revocation takes effect
 *     immediately because nothing is cached across requests).
 *  3. CSRF double-submit check on mutations.
 */
@Injectable()
export class TenantAuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(PG_APP_POOL) private readonly pool: pg.Pool,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const handler = context.getHandler();
    const cls = context.getClass();
    const isPublic =
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [handler, cls]) ?? false;
    const csrfExempt =
      this.reflector.getAllAndOverride<boolean>(CSRF_EXEMPT_KEY, [handler, cls]) ?? false;
    const workspaceOptional =
      this.reflector.getAllAndOverride<boolean>(WORKSPACE_OPTIONAL_KEY, [handler, cls]) ?? false;

    const req = context.switchToHttp().getRequest();
    const res = context.switchToHttp().getResponse();
    const requestId = (req.headers["x-request-id"] as string | undefined) ?? crypto.randomUUID();
    req.requestId = requestId;
    res.setHeader("x-request-id", requestId);

    if (isPublic) {
      req.tenant = { requestId } as TenantRequest;
      return true;
    }

    const cookies = parseCookies(req.headers.cookie as string | undefined);
    const token = cookies[SESSION_COOKIE];
    if (!token) throw problems.unauthenticated();

    const validated = await this.sessions.validate(token);
    if (!validated) throw problems.unauthenticated("Session expired or revoked");
    const { session, rotatedToken } = validated;

    const tenant: TenantRequest = {
      requestId,
      auth: {
        userId: session.user_id,
        email: session.email,
        displayName: session.display_name,
        sessionId: session.id,
        csrfToken: session.csrf_token,
      },
      workspaceId: "",
      workspaceRole: "viewer",
      authzEpoch: 0,
    };

    // Mutating requests require the CSRF double-submit header.
    const method = req.method as string;
    if (!csrfExempt && !["GET", "HEAD", "OPTIONS"].includes(method)) {
      const presented = req.headers["x-csrf-token"] as string | undefined;
      if (!this.sessions.verifyCsrf(session, presented)) {
        throw problems.forbidden("Missing or invalid CSRF token");
      }
    }

    // Workspace membership: header names the tenant context; membership is
    // always re-verified from the database, so revocation is immediate (ACC-04).
    const workspaceId = req.headers[WORKSPACE_HEADER] as string | undefined;
    if (workspaceId) {
      // Membership resolution goes through get_membership(), a SECURITY
      // DEFINER function: it must work WITHOUT tenant context because it is
      // what establishes that context (RLS policies are not an authz source).
      const { rows } = await this.pool.query<{ role: Role; authz_epoch: number }>(
        `SELECT role, authz_epoch FROM get_membership($1::uuid, $2::uuid)
         WHERE workspace_status = 'active'`,
        [workspaceId, session.user_id],
      );
      const membership = rows[0];
      if (!membership) throw problems.forbidden("No active membership for this workspace");
      tenant.workspaceId = workspaceId;
      tenant.workspaceRole = membership.role;
      tenant.authzEpoch = Number(membership.authz_epoch);
    } else if (!workspaceOptional) {
      // Fail closed with a clear client error instead of an opaque 500 from
      // uuid-typed queries run without tenant context.
      throw problems.forbidden(`Missing ${WORKSPACE_HEADER} workspace context header`);
    }

    if (rotatedToken) {
      const { cookieHeader } = await import("./auth-context.js");
      res.appendHeader("Set-Cookie", [
        cookieHeader(SESSION_COOKIE, rotatedToken, 14 * 24 * 3600),
        cookieHeader(CSRF_COOKIE, session.csrf_token, 14 * 24 * 3600),
      ]);
    }

    req.tenant = tenant;
    return true;
  }
}

/** Role guard metadata consumed in rbac.ts */
export const ROLE_KEY = "roles";
export const RoleMetadata = (roles: Role[]) => SetMetadata(ROLE_KEY, roles);
