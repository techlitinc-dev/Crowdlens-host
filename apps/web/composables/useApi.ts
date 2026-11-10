/**
 * Typed API access for the web app.
 *
 * - Same-origin requests: the Nuxt dev server proxies /v1 → control-api, so
 *   cookies are first-party in dev and production (no CORS credentials pain).
 * - CSRF: mutations send x-csrf-token read from the cl_csrf cookie
 *   (double-submit, verified server-side).
 * - Tenant context: every workspace-scoped request sends x-workspace-id.
 * - Errors: problem-details bodies are thrown as ApiError with the server
 *   `code` so the UI can branch on insufficient-credits, billing-not-configured, etc.
 */

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly detail: string,
    public readonly requestId: string,
  ) {
    super(detail);
    this.name = "ApiError";
  }
}

export function readCookie(name: string): string {
  if (typeof document === "undefined") return "";
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]!) : "";
}

export function useApi() {
  async function api<T>(
    method: string,
    path: string,
    options: { body?: unknown; workspaceId?: string; raw?: boolean } = {},
  ): Promise<T> {
    const headers: Record<string, string> = {};
    if (options.workspaceId) headers["x-workspace-id"] = options.workspaceId;
    if (!["GET", "HEAD"].includes(method.toUpperCase())) {
      headers["x-csrf-token"] = readCookie("cl_csrf");
    }
    let body: BodyInit | undefined;
    if (options.raw && options.body instanceof Blob) {
      body = options.body;
    } else if (options.body !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(options.body);
    }

    // Same-origin: the Nuxt server (or deployment reverse proxy) forwards
    // /v1 to the control API, so session cookies stay first-party
    // (they are HttpOnly + SameSite=Lax).
    const response = await fetch(`${path}`, {
      method,
      headers,
      body,
      credentials: "include",
    });
    if (response.status === 204) return undefined as T;
    const text = await response.text();
    const parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    if (!response.ok) {
      const pd = parsed as { type?: string; title?: string; status?: number; detail?: string; code?: string; request_id?: string };
      throw new ApiError(
        response.status,
        pd.code ?? "",
        pd.detail ?? pd.title ?? `Request failed (${response.status})`,
        pd.request_id ?? response.headers.get("x-request-id") ?? "",
      );
    }
    return parsed as T;
  }

  return { api };
}

export interface SessionInfo {
  user: { id: string; email: string; display_name: string } | null;
  workspaces: { id: string; slug: string; name: string; role: string; plan_code: string }[];
  dev_identity: boolean;
}

export interface Page<T> {
  items: T[];
  next_cursor: string | null;
}
