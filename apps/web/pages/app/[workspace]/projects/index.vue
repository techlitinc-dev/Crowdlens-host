<script setup lang="ts">
/**
 * Workspace home (design.md §5.1): project list with stage/status, create
 * flow, and credit balance overview.
 */
interface ProjectRow {
  id: string;
  name: string;
  decision_question: string;
  status: string;
  stage: string;
  updated_at: string;
}

const { api } = useApi();
const { workspaceId, ready } = useWorkspaceContext();
const projects = ref<ProjectRow[] | null>(null);
const overview = ref<{ balance: { available: number; reserved: number } } | null>(null);
const error = ref("");
const creating = ref(false);
const newName = ref("");
const newQuestion = ref("");

async function load() {
  error.value = "";
  try {
    const [list, ov] = await Promise.all([
      api<{ items: ProjectRow[] }>("GET", "/v1/projects", { workspaceId: workspaceId.value }),
      api<{ balance: { available: number; reserved: number } }>("GET", "/v1/billing/overview", { workspaceId: workspaceId.value }),
    ]);
    projects.value = list.items;
    overview.value = ov;
  } catch (err) {
    error.value = (err as Error).message;
  }
}

watch(ready, (isReady) => {
  if (isReady) void load();
});
onMounted(() => {
  if (ready.value) void load();
});

async function createProject() {
  if (!newName.value.trim()) return;
  creating.value = true;
  error.value = "";
  try {
    const created = await api<{ project: ProjectRow }>("POST", "/v1/projects", {
      workspaceId: workspaceId.value,
      body: {
        name: newName.value.trim(),
        decision_question: newQuestion.value.trim() || undefined,
      },
    });
    await navigateTo(`/app/${workspaceId.value}/projects/${created.project.id}`);
  } catch (err) {
    error.value = (err as Error).message;
  } finally {
    creating.value = false;
  }
}

const stageLabel = (stage: string) =>
  ({ evidence: "Evidence", world: "World graph", crowd: "Population", run: "Running", report: "Report" })[stage] ?? stage;
</script>

<template>
  <AppShell>
    <div v-if="!ready" class="panel-note" role="status">Loading…</div>
    <template v-else>
      <div class="home-header">
        <h1 class="page-title">Projects</h1>
        <div v-if="overview" class="balance-chip surface" aria-label="Credit balance">
          <span class="mono-label">Available</span>
          <strong>{{ overview.balance.available.toLocaleString() }}</strong>
          <span class="mono-label">reserved {{ overview.balance.reserved.toLocaleString() }}</span>
        </div>
      </div>

      <form class="create surface" @submit.prevent="createProject">
        <div class="create-fields">
          <label>
            New project name
            <input v-model="newName" type="text" required minlength="2" maxlength="160" placeholder="Q3 pricing announcement" />
          </label>
          <label>
            Decision question (optional)
            <input v-model="newQuestion" type="text" minlength="8" maxlength="2000" placeholder="Should we announce the pricing change in the launch post?" />
          </label>
        </div>
        <button type="submit" class="create-button" :disabled="creating || !newName.trim()">
          {{ creating ? "Creating…" : "Create project" }}
        </button>
      </form>

      <p v-if="error" class="panel-error" role="alert">{{ error }}</p>

      <div v-if="projects === null" class="panel-note" role="status">Loading projects…</div>
      <p v-else-if="projects.length === 0" class="panel-note">
        No projects yet. Create one above, upload a source document, and build the world graph.
      </p>
      <ul v-else class="project-list">
        <li v-for="project in projects" :key="project.id" class="project-row surface">
          <NuxtLink :to="`/app/${workspaceId}/projects/${project.id}`" class="project-link">
            <strong>{{ project.name }}</strong>
            <span class="project-question">{{ project.decision_question || "—" }}</span>
          </NuxtLink>
          <div class="project-meta">
            <span class="chip">{{ stageLabel(project.stage) }}</span>
            <span class="chip">{{ project.status }}</span>
            <span class="mono-label">{{ new Date(project.updated_at).toLocaleDateString() }}</span>
          </div>
        </li>
      </ul>
    </template>
  </AppShell>
</template>

<style scoped>
.home-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  flex-wrap: wrap;
  margin-bottom: var(--space-6);
}
.page-title {
  font-size: clamp(1.8rem, 3vw, 2.6rem);
  font-weight: 600;
  margin: 0;
}
.balance-chip {
  display: flex;
  align-items: baseline;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-4);
}
.balance-chip strong {
  font-family: var(--font-display);
  font-size: 1.4rem;
}
.create {
  display: flex;
  align-items: flex-end;
  gap: var(--space-4);
  flex-wrap: wrap;
  padding: var(--space-4);
  margin-bottom: var(--space-6);
}
.create-fields {
  display: flex;
  gap: var(--space-4);
  flex: 1;
  flex-wrap: wrap;
}
.create-fields label {
  flex: 1;
  min-width: 240px;
}
.create-button {
  background: var(--color-action);
  color: var(--color-on-action);
  border: none;
  border-radius: var(--radius-control);
  font-weight: 600;
  padding: var(--space-2) var(--space-5);
  cursor: pointer;
}
.create-button:disabled {
  opacity: 0.5;
}
.panel-note {
  color: var(--color-text-secondary);
  padding: var(--space-6) 0;
}
.panel-error {
  color: var(--color-danger);
}
.project-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: var(--space-3);
}
.project-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-4);
  flex-wrap: wrap;
}
.project-link {
  color: var(--color-text);
  display: grid;
  gap: var(--space-1);
}
.project-link:hover {
  text-decoration: none;
}
.project-link:hover strong {
  color: var(--color-action);
}
.project-question {
  color: var(--color-text-secondary);
  font-size: 0.92rem;
}
.project-meta {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.chip {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-control);
  padding: 0 var(--space-2);
  font-family: var(--font-mono);
  font-size: 0.72rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-text-secondary);
}
</style>
