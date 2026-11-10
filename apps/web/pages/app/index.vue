<script setup lang="ts">
/** /app landing: pick the first workspace (explicit switch happens in-app). */
const { requireSession } = useSession();

onMounted(async () => {
  const me = await requireSession();
  const first = me.workspaces[0];
  if (first) {
    await navigateTo(`/app/${first.id}/projects`);
  } else {
    // Session exists but no workspace (shouldn't happen — creation is
    // automatic); offer workspace creation via the API.
    const { api } = useApi();
    const created = await api<{ workspace: { id: string } }>("POST", "/v1/workspaces", { body: { name: "My Workspace" } });
    await navigateTo(`/app/${created.workspace.id}/projects`);
  }
});
</script>

<template>
  <div class="app-loading" role="status">
    <p>Loading your workspace…</p>
  </div>
</template>

<style scoped>
.app-loading {
  min-height: 100dvh;
  display: grid;
  place-items: center;
  color: var(--color-text-secondary);
}
</style>
