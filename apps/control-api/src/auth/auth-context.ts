import type { Role } from "@crowdlens/contracts";

export interface AuthContext {
  userId: string;
  email: string;
  displayName: string;
  sessionId: string;
  csrfToken: string;
}

export interface TenantRequest {
  auth: AuthContext;
  /** Verified workspace membership context. */
  workspaceId: string;
  workspaceRole: Role;
  authzEpoch: number;
  requestId: string;
}

export const SESSION_COOKIE = "cl_session";
export const CSRF_COOKIE = "cl_csrf";

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

export function cookieHeader(name: string, value: string, maxAgeSeconds: number): string {
  const secure = process.env.APP_ENV === "production" ? "; Secure" : "";
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
}
