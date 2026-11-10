<script setup lang="ts">
/**
 * Scenario builder (design.md §5.1–5.2): project detail with documents,
 * world graph status, and run creation with estimate → confirm → reserve.
 */
interface ProjectDetail {
  project: { id: string; name: string; decision_question: string; status: string; stage: string };
  documents: { id: string; filename: string; parse_status: string; sha256: string }[];
  graphs: { id: string; status: string; node_count: number; edge_count: number }[];
  simulations: { id: string; status: string; provider: string; model_id: string; ticks: number; credits_used: number; created_at: string }[];
}

interface ProviderCatalog {
  catalog_version: string;
  providers: { id: string; label: string; models: { id: string; label: string; structured_output: boolean }[] }[];
}

const { api } = useApi();
const { workspaceId, ready } = useWorkspaceContext();
const route = useRoute();
const projectId = route.params.projectId as string;

const detail = ref<ProjectDetail | null>(null);
const catalog = ref<ProviderCatalog | null>(null);
const error = ref("");
const notice = ref("");

// Documents
const fileInput = ref<HTMLInputElement | null>(null);
const uploading = ref(false);

// Graph
const graphBusy = ref(false);

// Run form
const question = ref("");
const population = ref(10_000);
const activeBudget = ref(256);
const ticks = ref(24);
const reportDepth = ref<"standard" | "detailed">("standard");
const provider = ref("mock");
const modelId = ref("mock-sim-1");
const maxCredits = ref(500);
const estimate = ref<{ credits_low: number; credits_high: number; hard_cap: number } | null>(null);
const estimating = ref(false);
const creating = ref(false);

async function load() {
  error.value = "";
  try {
    detail.value = await api<ProjectDetail>("GET", `/v1/projects/${projectId}`, { workspaceId: workspaceId.value });
    question.value = detail.value.project.decision_question;
  } catch (err) {
    error.value = (err as Error).message;
  }
}

async function loadCatalog() {
  try {
    catalog.value = await api<ProviderCatalog>("GET", "/v1/providers/catalog", { workspaceId: workspaceId.value });
  } catch {
    catalog.value = null;
  }
}

watch(ready, (isReady) => {
  if (isReady) {
    void load();
    void loadCatalog();
  }
});
onMounted(() => {
  if (ready.value) {
    void load();
    void loadCatalog();
  }
});

// ---------- documents ----------

async function uploadDocument() {
  const file = fileInput.value?.files?.[0];
  if (!file) return;
  uploading.value = true;
  error.value = "";
  notice.value = "";
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let sha = "";
    if (crypto.subtle) {
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      sha = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
    } else {
      // Fallback for non-secure contexts: server verifies content hash on PUT.
      sha = "0".repeat(64);
    }
    const init = await api<{ document: { id: string; parse_status: string }; upload: { path: string } | null }>(
      "POST",
      `/v1/projects/${projectId}/documents/init`,
      {
        workspaceId: workspaceId.value,
        body: { filename: file.name, mime_type: file.type || "text/plain", size_bytes: bytes.length, sha256: sha },
      },
    );
    if (init.document.parse_status !== "parsed" && init.upload) {
      await fetch(init.upload.path, {
        method: "PUT",
        headers: { "x-csrf-token": readCookie("cl_csrf"), "x-workspace-id": workspaceId.value, "content-type": "application/octet-stream" },
        body: bytes,
        credentials: "include",
      }).then(async (res) => {
        if (!res.ok) throw new Error(`Upload failed (${res.status})`);
      });
    }
    notice.value = init.document.parse_status === "parsed" ? "Document parsed instantly (content-addressed reuse)." : "Document uploaded; parsing queued.";
    await load();
  } catch (err) {
    error.value = (err as Error).message;
  } finally {
    uploading.value = false;
    if (fileInput.value) fileInput.value.value = "";
  }
}

// ---------- graph ----------

async function buildGraph() {
  graphBusy.value = true;
  error.value = "";
  try {
    await api("POST", `/v1/projects/${projectId}/graph/build`, { workspaceId: workspaceId.value, body: {} });
    notice.value = "Graph build enqueued; the graph worker will populate entities and relationships.";
    pollGraph();
  } catch (err) {
    error.value = (err as Error).message;
  } finally {
    graphBusy.value = false;
  }
}

let graphPoll: ReturnType<typeof setInterval> | null = null;
function pollGraph() {
  if (graphPoll) clearInterval(graphPoll);
  graphPoll = setInterval(async () => {
    await load();
    const graph = detail.value?.graphs[0];
    if (graph && ["ready", "failed"].includes(graph.status)) {
      if (graphPoll) clearInterval(graphPoll);
      graphPoll = null;
    }
  }, 3000);
}
onBeforeUnmount(() => {
  if (graphPoll) clearInterval(graphPoll);
});

// ---------- runs ----------

async function getEstimate() {
  if (!question.value || question.value.length < 8) {
    error.value = "Decision question must be at least 8 characters for an estimate.";
    return;
  }
  estimating.value = true;
  error.value = "";
  try {
    estimate.value = await api<{ credits_low: number; credits_high: number; hard_cap: number }>(
      "POST",
      "/v1/simulations/estimate",
      {
        workspaceId: workspaceId.value,
        body: {
          decision_question: question.value,
          population: population.value,
          active_budget: activeBudget.value,
          ticks: ticks.value,
          report_depth: reportDepth.value,
          max_credits: maxCredits.value,
          provider: provider.value,
          model_id: modelId.value,
        },
      },
    );
  } catch (err) {
    error.value = (err as Error).message;
    estimate.value = null;
  } finally {
    estimating.value = false;
  }
}

async function createRun() {
  creating.value = true;
  error.value = "";
  try {
    const created = await api<{ simulation: { id: string } }>("POST", "/v1/simulations", {
      workspaceId: workspaceId.value,
      body: {
        project_id: projectId,
        decision_question: question.value,
        population: population.value,
        active_budget: activeBudget.value,
        ticks: ticks.value,
        report_depth: reportDepth.value,
        max_credits: estimate.value?.hard_cap ?? maxCredits.value,
        provider: provider.value,
        model_id: modelId.value,
      },
    });
    await navigateTo(`/app/${workspaceId.value}/simulations/${created.simulation.id}`);
  } catch (err) {
    error.value = (err as Error).message;
  } finally {
    creating.value = false;
  }
}

const providerModels = computed(() => {
  const found = catalog.value?.providers.find((p) => p.id === provider.value);
  return found?.models ?? [];
});

watch(provider, () => {
  const models = providerModels.value;
  modelId.value = models[0]?.id ?? "mock-sim-1";
});

const statusClass = (status: string) =>
  ({ ready: "ok", completed: "ok", building: "busy", running: "busy", queued: "busy", preparing: "busy", failed: "bad", cancelled: "bad" })[status] ?? "";
</script>

<template>
  <AppShell>
    <div v-if="!ready || !detail" class="panel-note" role="status">Loading project…</div>
    <template v-else>
      <header class="project-header">
        <div>
          <h1 class="page-title">{{ detail.project.name }}</h1>
          <p class="project-question">{{ detail.project.decision_question || "No decision question yet." }}</p>
        </div>
      </header>

      <p v-if="notice" class="panel-notice" role="status">{{ notice }}</p>
      <p v-if="error" class="panel-error" role="alert">{{ error }}</p>

      <div class="builder-grid">
        <!-- Evidence (documents + graph) -->
        <section class="surface panel" aria-labelledby="docs-heading">
          <h2 id="docs-heading" class="panel-heading">Evidence</h2>

          <div class="upload-row">
            <input ref="fileInput" type="file" accept="application/pdf,text/markdown,text/plain" class="file-input" />
            <button type="button" class="panel-button" :disabled="uploading" @click="uploadDocument">
              {{ uploading ? "Uploading…" : "Upload document" }}
            </button>
          </div>

          <ul v-if="detail.documents.length" class="doc-list">
            <li v-for="doc in detail.documents" :key="doc.id" class="doc-row">
              <span>{{ doc.filename }}</span>
              <span class="chip" :class="statusClass(doc.parse_status)">{{ doc.parse_status }}</span>
            </li>
          </ul>
          <p v-else class="panel-note">No documents yet. Upload the announcement, brief, or plan.</p>

          <div class="graph-row">
            <div v-if="detail.graphs.length" class="graph-status">
              <span class="chip" :class="statusClass(detail.graphs[0]!.status)">{{ detail.graphs[0]!.status }}</span>
              <span class="mono-label">{{ detail.graphs[0]!.node_count }} nodes · {{ detail.graphs[0]!.edge_count }} edges</span>
            </div>
            <p v-else class="panel-note">No world graph yet.</p>
            <button type="button" class="panel-button" :disabled="graphBusy || !detail.documents.some((d) => d.parse_status === 'parsed')" @click="buildGraph">
              {{ graphBusy ? "Enqueuing…" : "Build graph" }}
            </button>
          </div>
        </section>

        <!-- Scenario builder -->
        <section class="surface panel" aria-labelledby="run-heading">
          <h2 id="run-heading" class="panel-heading">Scenario builder</h2>
          <div class="run-form">
            <label>
              Decision question
              <input v-model="question" type="text" minlength="8" maxlength="2000" />
            </label>
            <div class="form-pair">
              <label>
                Population
                <select v-model.number="population">
                  <option :value="1000">1,000</option>
                  <option :value="10000">10,000</option>
                  <option :value="100000">100,000</option>
                  <option :value="1000000">1,000,000</option>
                </select>
              </label>
              <label>
                Active budget
                <input v-model.number="activeBudget" type="number" min="16" max="100000" step="8" />
              </label>
            </div>
            <div class="form-pair">
              <label>
                Ticks
                <input v-model.number="ticks" type="number" min="1" max="200" />
              </label>
              <label>
                Report depth
                <select v-model="reportDepth">
                  <option value="standard">standard</option>
                  <option value="detailed">detailed</option>
                </select>
              </label>
            </div>
            <div class="form-pair">
              <label>
                Provider
                <select v-model="provider">
                  <option v-for="p in catalog?.providers ?? []" :key="p.id" :value="p.id">{{ p.label }}</option>
                </select>
              </label>
              <label>
                Model
                <select v-model="modelId">
                  <option v-for="m in providerModels" :key="m.id" :value="m.id">{{ m.label }}</option>
                </select>
              </label>
            </div>
            <label>
              Hard cap (credits)
              <input v-model.number="maxCredits" type="number" min="1" max="1000000" />
            </label>

            <div class="estimate-row">
              <button type="button" class="panel-button" :disabled="estimating" @click="getEstimate">
                {{ estimating ? "Estimating…" : "Get estimate" }}
              </button>
              <p v-if="estimate" class="estimate-result" aria-live="polite">
                {{ estimate.credits_low }}–{{ estimate.credits_high }} credits · cap {{ estimate.hard_cap }}
              </p>
            </div>
            <button
              type="button"
              class="run-button"
              :disabled="creating || !estimate"
              @click="createRun"
            >
              {{ creating ? "Creating run…" : "Run scenario" }}
            </button>
            <p v-if="!estimate" class="panel-note">Estimate first — the cap reserves credits and protects your wallet.</p>
          </div>
        </section>
      </div>

      <!-- Runs -->
      <section aria-labelledby="sims-heading" class="sims-section">
        <h2 id="sims-heading" class="panel-heading">Runs</h2>
        <ul v-if="detail.simulations.length" class="sim-list">
          <li v-for="sim in detail.simulations" :key="sim.id" class="surface sim-row">
            <NuxtLink :to="`/app/${workspaceId}/simulations/${sim.id}`" class="sim-link">
              <span class="mono-label">{{ sim.id.slice(0, 8) }}</span>
              <span class="chip" :class="statusClass(sim.status)">{{ sim.status }}</span>
              <span class="mono-label">{{ sim.provider }} / {{ sim.model_id }}</span>
              <span class="mono-label">{{ sim.ticks }} ticks</span>
              <span v-if="sim.credits_used" class="mono-label">{{ sim.credits_used }} credits</span>
            </NuxtLink>
          </li>
        </ul>
        <p v-else class="panel-note">No runs yet. Estimate and run a scenario above.</p>
      </section>
    </template>
  </AppShell>
</template>

<style scoped>
.page-title {
  font-size: clamp(1.8rem, 3vw, 2.6rem);
  font-weight: 600;
  margin: 0 0 var(--space-2);
}
.project-question {
  color: var(--color-text-secondary);
  margin: 0;
}
.panel-notice {
  color: var(--color-action);
}
.panel-error {
  color: var(--color-danger);
}
.panel-note {
  color: var(--color-text-secondary);
  font-size: 0.92rem;
}
.builder-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-4);
  margin-top: var(--space-6);
}
@media (max-width: 1100px) {
  .builder-grid {
    grid-template-columns: 1fr;
  }
}
.panel {
  padding: var(--space-4);
}
.panel-heading {
  font-size: 1.2rem;
  margin: 0 0 var(--space-4);
}
.upload-row {
  display: flex;
  gap: var(--space-3);
  align-items: center;
  flex-wrap: wrap;
}
.file-input {
  flex: 1;
  min-width: 200px;
}
.panel-button {
  background: var(--color-bg-inset);
  border: 1px solid var(--color-border);
  color: var(--color-text);
  border-radius: var(--radius-control);
  padding: var(--space-2) var(--space-4);
  cursor: pointer;
}
.panel-button:hover:not(:disabled) {
  border-color: var(--color-action);
}
.panel-button:disabled {
  opacity: 0.5;
  cursor: default;
}
.doc-list {
  list-style: none;
  margin: var(--space-4) 0;
  padding: 0;
  display: grid;
  gap: var(--space-2);
}
.doc-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-3);
  border-bottom: 1px solid var(--color-border);
  padding-bottom: var(--space-2);
  font-size: 0.95rem;
}
.graph-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;
}
.graph-status {
  display: flex;
  align-items: center;
  gap: var(--space-3);
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
.chip.ok {
  border-color: var(--color-action);
  color: var(--color-action);
}
.chip.busy {
  border-color: var(--sage-400);
  color: var(--sage-400);
}
.chip.bad {
  border-color: var(--color-danger);
  color: var(--color-danger);
}
.run-form {
  display: grid;
  gap: var(--space-4);
}
.form-pair {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-4);
}
.estimate-row {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  flex-wrap: wrap;
}
.estimate-result {
  font-family: var(--font-display);
  font-weight: 600;
  margin: 0;
}
.run-button {
  background: var(--color-action);
  color: var(--color-on-action);
  border: none;
  border-radius: var(--radius-control);
  font-weight: 600;
  padding: var(--space-3);
  cursor: pointer;
}
.run-button:disabled {
  opacity: 0.5;
  cursor: default;
}
.sims-section {
  margin-top: var(--space-8);
}
.sim-list {
  list-style: none;
  margin: var(--space-4) 0 0;
  padding: 0;
  display: grid;
  gap: var(--space-2);
}
.sim-row {
  padding: var(--space-3);
}
.sim-link {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  flex-wrap: wrap;
  color: var(--color-text);
}
.sim-link:hover {
  text-decoration: none;
}
.sim-link:hover .mono-label:first-child {
  color: var(--color-action);
}
</style>
