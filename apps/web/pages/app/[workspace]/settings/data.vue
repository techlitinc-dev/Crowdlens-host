<script setup lang="ts">
/** Data settings (design.md §5.6): workspace retention facts, project
 *  deletion (tombstone + purge), audit-log transparency. */
interface AuditRow {
  id: string;
  actor: string;
  action: string;
  target_type: string;
  target_id: string;
  occurred_at: string;
}
interface ProjectRow {
  id: string;
  name: string;
}

const { api } = useApi();
const { workspaceId, ready } = useWorkspaceContext();
const projects = ref<ProjectRow[]>([]);
const audit = ref<AuditRow[]>([]);
const error = ref("");
const notice = ref("");

async function load() {
  try {
    const [list, auditResult] = await Promise.all([
      api<{ items: ProjectRow[] }>("GET", "/v1/projects?limit=100", { workspaceId: workspaceId.value }),
      api<{ items: AuditRow[] }>("GET", `/v1/workspaces/${workspaceId.value}/audit?limit=50`, { workspaceId: workspaceId.value }),
    ]);
    projects.value = list.items;
    audit.value = auditResult.items;
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

async function deleteProject(project: ProjectRow) {
  if (!window.confirm(`Delete “${project.name}”? Documents, graphs, shares, and reports are purged asynchronously.`)) {
    return;
  }
  error.value = "";
  try {
    await api("DELETE", `/v1/projects/${project.id}`, { workspaceId: workspaceId.value });
    notice.value = `Project “${project.name}” deleted; purge scheduled.`;
    await load();
  } catch (err) {
    error.value = (err as Error).message;
  }
}
</script>

<template>
  <AppShell>
    <h1 class="page-title">Data</h1>
    <p class="panel-note">
      Documents live in tenant-scoped object storage with hash-verified uploads. Deleting a
      project tombstones it and schedules an asynchronous purge of documents, graphs, and
      artifacts. Provider calls follow your workspace data policy (deny by default).
    </p>
    <p v-if="error" class="panel-error" role="alert">{{ error }}</p>
    <p v-if="notice" class="panel-notice" role="status">{{ notice }}</p>

    <section class="surface panel" aria-labelledby="retention-heading">
      <h2 id="retention-heading" class="panel-heading">Retention</h2>
      <ul class="fact-list">
        <li>Report versions are immutable and content-hash verified; deletion removes them with the project.</li>
        <li>Share links expire by default (72 h) and are revocable immediately — cached copies stop resolving.</li>
        <li>Checkpoints and parse artifacts are content-addressed and purged with the project.</li>
        <li>The ledger is append-only: billing history is never deleted, even after project purge.</li>
      </ul>
    </section>

    <section class="surface panel" aria-labelledby="danger-heading">
      <h2 id="danger-heading" class="panel-heading">Delete a project</h2>
      <ul v-if="projects.length" class="project-delete-list">
        <li v-for="project in projects" :key="project.id">
          <span>{{ project.name }}</span>
          <button type="button" class="delete-button" @click="deleteProject(project)">Delete</button>
        </li>
      </ul>
      <p v-else class="panel-note">No active projects.</p>
    </section>

    <section class="surface panel" aria-labelledby="audit-heading">
      <h2 id="audit-heading" class="panel-heading">Audit log</h2>
      <div class="table-scroll">
        <table class="table-plain">
          <thead>
            <tr><th scope="col">When</th><th scope="col">Actor</th><th scope="col">Action</th><th scope="col">Target</th></tr>
          </thead>
          <tbody>
            <tr v-for="row in audit" :key="row.id">
              <td class="mono-label">{{ new Date(row.occurred_at).toLocaleString() }}</td>
              <td>{{ row.actor.slice(0, 8) }}</td>
              <td>{{ row.action }}</td>
              <td>{{ row.target_type }}/{{ row.target_id.slice(0, 8) }}</td>
            </tr>
          </tbody>
        </table>
        <p v-if="!audit.length" class="panel-note">No audit events yet.</p>
      </div>
    </section>
  </AppShell>
</template>

<style scoped>
.page-title {
  font-size: clamp(1.8rem, 3vw, 2.4rem);
  font-weight: 600;
  margin: 0 0 var(--space-2);
}
.panel-note {
  color: var(--color-text-secondary);
}
.panel-error {
  color: var(--color-danger);
}
.panel-notice {
  color: var(--color-action);
}
.panel {
  padding: var(--space-4);
  margin-top: var(--space-4);
}
.panel-heading {
  font-size: 1.2rem;
  margin: 0 0 var(--space-3);
}
.fact-list {
  margin: 0;
  padding-inline-start: var(--space-4);
  display: grid;
  gap: var(--space-2);
  color: var(--color-text-secondary);
}
.project-delete-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: var(--space-2);
}
.project-delete-list li {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-3);
  border-bottom: 1px solid var(--color-border);
  padding-bottom: var(--space-2);
}
.delete-button {
  background: transparent;
  border: 1px solid var(--color-danger);
  color: var(--color-danger);
  border-radius: var(--radius-control);
  padding: var(--space-1) var(--space-3);
  cursor: pointer;
}
.table-scroll {
  overflow-x: auto;
}
</style>
