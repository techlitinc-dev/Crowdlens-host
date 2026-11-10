/**
 * Session + workspace state for the authenticated app.
 *
 * Session comes from GET /v1/auth/me (HttpOnly cookie, server-validated).
 * The active workspace is chosen explicitly by the user (ACC-02) and kept in
 * the route; every workspace-scoped call re-verifies membership server-side,
 * so revocation is immediate without any client cache invalidation.
 */
import type { SessionInfo } from "./useApi";

export function useSession() {
  const { api } = useApi();
  const session = useState<SessionInfo | null>("session", () => null);
  const loaded = useState<boolean>("session-loaded", () => false);

  async function refresh(): Promise<SessionInfo | null> {
    try {
      const me = await api<SessionInfo>("GET", "/v1/auth/me");
      session.value = me;
      loaded.value = true;
      return me;
    } catch {
      session.value = null;
      loaded.value = true;
      return null;
    }
  }

  async function signOut() {
    try {
      await api("POST", "/v1/auth/logout");
    } finally {
      session.value = null;
      await navigateTo("/");
    }
  }

  async function requireSession(): Promise<SessionInfo> {
    if (loaded.value && session.value) return session.value;
    const me = await refresh();
    if (!me) {
      await navigateTo({ path: "/sign-in", query: { redirect: useRoute().fullPath } });
      throw new Error("unauthenticated");
    }
    return me;
  }

  return { session, loaded, refresh, signOut, requireSession };
}
