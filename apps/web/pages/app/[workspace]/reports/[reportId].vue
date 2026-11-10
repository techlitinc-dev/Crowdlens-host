<script setup lang="ts">
/**
 * Report reader (design.md §5.4): immutable report versions, claim →
 * evidence expansion, share management (create/revoke), export, and the
 * provenance disclosure on every response.
 */
interface ReportGet {
  report: {
    id: string;
    simulation_id: string;
    version: number;
    content_hash: string;
    status: string;
    content: {
      summary?: string;
      recommendation?: string;
      segments?: { name: string; stance: string; share: number }[];
      claims?: { text: string; confidence: string; evidence?: { type: string; ref: string }[] }[];
      method?: Record<string, unknown>;
      limitations?: string[];
      disclaimer?: string;
      [key: string]: unknown;
    };
  };
  shares: { id: string; scope: string; expires_at: string | null; revoked_at: string | null; created_at: string }[];
}

const { api } = useApi();
const { workspaceId, ready } = useWorkspaceContext();
const route = useRoute();
const reportId = route.params.reportId as string;

const data = ref<ReportGet | null>(null);
const error = ref("");
const notice = ref("");
const expandedClaim = ref<number | null>(null);
const creatingShare = ref(false);
const shareScope = ref<"summary" | "full">("summary");
const exportMessage = ref("");

async function load() {
  try {
    data.value = await api<ReportGet>("GET", `/v1/reports/${reportId}`, { workspaceId: workspaceId.value });
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

async function createShare() {
  creatingShare.value = true;
  error.value = "";
  notice.value = "";
  try {
    const created = await api<{ token: string }>("POST", `/v1/reports/${reportId}/shares`, {
      workspaceId: workspaceId.value,
      body: { scope: shareScope.value, expires_in_hours: 72 },
    });
    notice.value = `Share created — send this link: ${window.location.origin}/shared/${created.token}`;
    await load();
  } catch (err) {
    error.value = (err as Error).message;
  } finally {
    creatingShare.value = false;
  }
}

async function revokeShare(shareId: string) {
  error.value = "";
  try {
    await api("DELETE", `/v1/report-shares/${shareId}`, { workspaceId: workspaceId.value });
    await load();
  } catch (err) {
    error.value = (err as Error).message;
  }
}

async function exportReport(format: "json" | "csv") {
  exportMessage.value = "";
  try {
    const result = await api<{ filename: string; data: unknown }>("GET", `/v1/reports/${reportId}/export?format=${format}`, {
      workspaceId: workspaceId.value,
    });
    const blob = new Blob([typeof result.data === "string" ? result.data : JSON.stringify(result.data, null, 2)], {
      type: format === "csv" ? "text/csv" : "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = result.filename;
    anchor.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    exportMessage.value = (err as Error).message;
  }
}

const content = computed(() => data.value?.report.content ?? null);
</script>

<template>
  <AppShell>
    <div v-if="!ready || !data" class="panel-note" role="status">Loading report…</div>
    <template v-else>
      <header class="report-header">
        <div>
          <p class="mono-label">
            Report v{{ data.report.version }} · {{ data.report.content_hash.slice(0, 12) }} · immutable
          </p>
          <h1 class="page-title">Run report</h1>
        </div>
        <div class="report-actions">
          <button type="button" class="panel-button" @click="exportReport('json')">Export JSON</button>
          <button type="button" class="panel-button" @click="exportReport('csv')">Export CSV</button>
          <NuxtLink :to="`/app/${workspaceId}/reports/${reportId}/interview`" class="panel-button interview-link">
            Interview an agent
          </NuxtLink>
        </div>
      </header>
      <p v-if="exportMessage" class="panel-error" role="alert">{{ exportMessage }}</p>
      <p v-if="error" class="panel-error" role="alert">{{ error }}</p>
      <p v-if="notice" class="panel-notice" role="status">{{ notice }}</p>

      <section v-if="content" class="surface panel">
        <h2 class="panel-heading">Executive summary</h2>
        <p v-if="content.recommendation" class="recommendation">{{ content.recommendation }}</p>
        <p v-if="content.summary">{{ content.summary }}</p>
        <p v-if="!content.summary && !content.recommendation" class="panel-note">
          This report format stores sections under custom keys; the raw payload remains hash-verified.
        </p>
      </section>

      <section v-if="content?.segments?.length" class="surface panel" aria-labelledby="segments-heading">
        <h2 id="segments-heading" class="panel-heading">Segments</h2>
        <table class="table-plain">
          <thead>
            <tr><th scope="col">Segment</th><th scope="col">Share</th><th scope="col">Stance</th></tr>
          </thead>
          <tbody>
            <tr v-for="segment in content.segments" :key="segment.name">
              <td>{{ segment.name }}</td>
              <td>{{ Math.round(segment.share * 100) }}%</td>
              <td>{{ segment.stance }}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section v-if="content?.claims?.length" class="surface panel" aria-labelledby="claims-heading">
        <h2 id="claims-heading" class="panel-heading">Claims</h2>
        <ul class="claim-list">
          <li v-for="(claim, index) in content.claims" :key="index" class="claim-item">
            <button type="button" class="claim-toggle" :aria-expanded="expandedClaim === index" @click="expandedClaim = expandedClaim === index ? null : index">
              <span>{{ claim.text }}</span>
              <span class="mono-label">{{ claim.confidence }}</span>
            </button>
            <ul v-if="expandedClaim === index" class="evidence-list">
              <li v-for="(ev, evIndex) in claim.evidence ?? []" :key="evIndex">
                <span class="mono-label">{{ ev.type }}</span> {{ ev.ref }}
              </li>
            </ul>
          </li>
        </ul>
      </section>

      <section class="surface panel" aria-labelledby="method-heading">
        <h2 id="method-heading" class="panel-heading">Method</h2>
        <dl v-if="content?.method" class="method-grid">
          <template v-for="(value, key) in content.method" :key="key">
            <dt class="mono-label">{{ key }}</dt>
            <dd>{{ value }}</dd>
          </template>
        </dl>
        <ul v-if="content?.limitations" class="limitations">
          <li v-for="limitation in content.limitations" :key="limitation">{{ limitation }}</li>
        </ul>
        <p v-if="content?.disclaimer" class="disclaimer">{{ content.disclaimer }}</p>
      </section>

      <section class="surface panel" aria-labelledby="shares-heading">
        <h2 id="shares-heading" class="panel-heading">Shares</h2>
        <div class="share-create">
          <label>
            Scope
            <select v-model="shareScope">
              <option value="summary">summary</option>
              <option value="full">full</option>
            </select>
          </label>
          <button type="button" class="panel-button" :disabled="creatingShare" @click="createShare">
            {{ creatingShare ? "Creating…" : "Create share link (72h)" }}
          </button>
        </div>
        <ul v-if="data.shares.length" class="share-list">
          <li v-for="share in data.shares" :key="share.id" class="share-row">
            <span class="mono-label">{{ share.id.slice(0, 8) }} · {{ share.scope }}</span>
            <span class="mono-label">
              {{ share.revoked_at ? "revoked" : `expires ${new Date(share.expires_at!).toLocaleString()}` }}
            </span>
            <button v-if="!share.revoked_at" type="button" class="panel-button" @click="revokeShare(share.id)">
              Revoke
            </button>
          </li>
        </ul>
        <p v-else class="panel-note">No shares. Links are revocable and expire automatically.</p>
      </section>
    </template>
  </AppShell>
</template>

<style scoped>
.page-title {
  font-size: clamp(1.8rem, 3vw, 2.4rem);
  font-weight: 600;
  margin: var(--space-1) 0;
}
.report-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--space-4);
  flex-wrap: wrap;
  margin-bottom: var(--space-6);
}
.report-actions {
  display: flex;
  gap: var(--space-2);
  flex-wrap: wrap;
}
.panel {
  padding: var(--space-4);
  margin-bottom: var(--space-4);
}
.panel-heading {
  font-size: 1.2rem;
  margin: 0 0 var(--space-4);
}
.panel-button {
  background: var(--color-bg-inset);
  border: 1px solid var(--color-border);
  color: var(--color-text);
  border-radius: var(--radius-control);
  padding: var(--space-2) var(--space-4);
  cursor: pointer;
  display: inline-block;
}
.panel-button:hover:not(:disabled) {
  border-color: var(--color-action);
  text-decoration: none;
}
.interview-link {
  border-color: var(--color-action);
  color: var(--color-action);
}
.panel-error {
  color: var(--color-danger);
}
.panel-notice {
  color: var(--color-action);
  word-break: break-all;
}
.panel-note {
  color: var(--color-text-secondary);
  font-size: 0.92rem;
}
.recommendation {
  font-weight: 600;
  font-size: 1.08rem;
}
.claim-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: var(--space-2);
}
.claim-item {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-control);
  overflow: hidden;
}
.claim-toggle {
  width: 100%;
  display: flex;
  justify-content: space-between;
  gap: var(--space-4);
  background: transparent;
  border: none;
  color: var(--color-text);
  padding: var(--space-3);
  text-align: start;
  cursor: pointer;
}
.claim-toggle:hover span:first-child {
  color: var(--color-action);
}
.evidence-list {
  margin: 0;
  padding: 0 var(--space-4) var(--space-3) var(--space-8);
  display: grid;
  gap: var(--space-1);
  font-size: 0.92rem;
}
.method-grid {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: var(--space-2) var(--space-4);
  margin: 0 0 var(--space-4);
}
.method-grid dd {
  margin: 0;
  font-size: 0.95rem;
}
.limitations {
  margin: 0 0 var(--space-3);
  padding-inline-start: var(--space-4);
  color: var(--color-text-secondary);
  font-size: 0.95rem;
  display: grid;
  gap: var(--space-2);
}
.disclaimer {
  border-inline-start: 3px solid var(--color-danger);
  padding-inline-start: var(--space-3);
  color: var(--color-text-secondary);
  font-size: 0.95rem;
  margin: 0;
}
.share-create {
  display: flex;
  gap: var(--space-3);
  align-items: flex-end;
  flex-wrap: wrap;
  margin-bottom: var(--space-4);
}
.share-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: var(--space-2);
}
.share-row {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  flex-wrap: wrap;
  border-bottom: 1px solid var(--color-border);
  padding-bottom: var(--space-2);
}
</style>
