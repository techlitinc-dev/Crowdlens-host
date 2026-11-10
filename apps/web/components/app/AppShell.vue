<script setup lang="ts">
/**
 * AppShell: workspace navigation, workspace switcher (explicit, ACC-02),
 * session state, and the sign-out control. Below 1024px the rails collapse
 * into a top bar (design.md §5, §8).
 */
const { session, refresh, signOut } = useSession();
const route = useRoute();

onMounted(() => {
  void refresh();
});

const workspaceId = computed(() => route.params.workspace as string);
const workspace = computed(() => session.value?.workspaces.find((w) => w.id === workspaceId.value) ?? null);

const nav = computed(() => [
  { label: "Projects", to: `/app/${workspaceId.value}/projects` },
  { label: "Usage", to: `/app/${workspaceId.value}/usage` },
  { label: "Members", to: `/app/${workspaceId.value}/settings/members` },
  { label: "Providers", to: `/app/${workspaceId.value}/settings/providers` },
  { label: "Billing", to: `/app/${workspaceId.value}/settings/billing` },
  { label: "Data", to: `/app/${workspaceId.value}/settings/data` },
]);

function switchWorkspace(event: Event) {
  const id = (event.target as HTMLSelectElement).value;
  if (id) navigateTo(`/app/${id}/projects`);
}
</script>

<template>
  <div class="app-shell">
    <header class="app-topbar">
      <NuxtLink to="/" class="app-brand" aria-label="CrowdLens home"><BrandMark :size="24" /></NuxtLink>
      <label class="workspace-switch mono-label">
        Workspace
        <select :value="workspaceId" @change="switchWorkspace">
          <option v-for="w in session?.workspaces ?? []" :key="w.id" :value="w.id">
            {{ w.name }} ({{ w.role }})
          </option>
        </select>
      </label>
      <div class="app-topbar-right">
        <span class="mono-label">{{ workspace?.plan_code ?? "" }}</span>
        <button type="button" class="signout" @click="signOut">Sign out</button>
      </div>
    </header>

    <div class="app-body">
      <nav class="app-rail" aria-label="Workspace">
        <NuxtLink
          v-for="item in nav"
          :key="item.to"
          :to="item.to"
          class="rail-link"
          :class="{ active: route.path.startsWith(item.to) }"
        >
          {{ item.label }}
        </NuxtLink>
      </nav>
      <main class="app-main">
        <slot />
      </main>
    </div>
  </div>
</template>

<style scoped>
.app-shell {
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
}
.app-topbar {
  display: flex;
  align-items: center;
  gap: var(--space-6);
  padding: var(--space-3) var(--space-6);
  border-bottom: 1px solid var(--color-border);
  background: var(--color-bg-raised);
  position: sticky;
  top: 0;
  z-index: 30;
}
.workspace-switch {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.app-topbar-right {
  margin-inline-start: auto;
  display: flex;
  align-items: center;
  gap: var(--space-4);
}
.signout {
  background: transparent;
  border: 1px solid var(--color-border);
  color: var(--color-text-secondary);
  border-radius: var(--radius-control);
  padding: var(--space-1) var(--space-3);
  cursor: pointer;
}
.app-body {
  flex: 1;
  display: grid;
  grid-template-columns: 220px 1fr;
}
.app-rail {
  border-inline-end: 1px solid var(--color-border);
  padding: var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.rail-link {
  color: var(--color-text-secondary);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-control);
  font-size: 0.95rem;
}
.rail-link:hover {
  color: var(--color-text);
  text-decoration: none;
}
.rail-link.active {
  color: var(--color-action);
  background: var(--color-bg-inset);
}
.app-main {
  padding: var(--space-6);
  min-width: 0;
}
@media (max-width: 1024px) {
  .app-body {
    grid-template-columns: 1fr;
  }
  .app-rail {
    flex-direction: row;
    overflow-x: auto;
    border-inline-end: none;
    border-bottom: 1px solid var(--color-border);
  }
}
</style>
