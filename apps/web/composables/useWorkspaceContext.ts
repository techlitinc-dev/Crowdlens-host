/**
 * Route-level workspace context: requires a live session and verifies the
 * route's workspace is one of the user's memberships (the API re-verifies
 * server-side on every call as well).
 */
export function useWorkspaceContext() {
  const route = useRoute();
  const { requireSession, session } = useSession();
  const workspaceId = computed(() => route.params.workspace as string);
  const ready = ref(false);
  const forbidden = ref(false);

  onMounted(async () => {
    const me = await requireSession();
    const member = me.workspaces.some((w) => w.id === workspaceId.value);
    if (!member) {
      const first = me.workspaces[0];
      if (first) {
        await navigateTo(`/app/${first.id}/projects`);
        return;
      }
      forbidden.value = true;
    }
    ready.value = true;
  });

  return { workspaceId, ready, forbidden, session };
}
