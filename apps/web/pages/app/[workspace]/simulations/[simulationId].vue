<script setup lang="ts">
/**
 * Live run observatory (design.md §5.3): shard status, tick progress, event
 * feed (SSE via fetch with graceful polling fallback per architecture
 * §10.3), cancel, clone, and links to the report.
 */
interface SimulationGet {
  simulation: {
    id: string;
    status: string;
    config: { ticks: number; population: number; decision_question: string; report_depth: string };
    manifest: Record<string, unknown>;
    credits_reserved: number | null;
    credits_used: number;
    error: string | null;
    lineage_parent: string | null;
    created_at: string;
  };
  shards: { shard_index: number; status: string; tick: number; heartbeat_at: string }[];
  reservation: { amount: number; status: string } | null;
  report: { id: string } | null;
}

const { api } = useApi();
const { workspaceId, ready } = useWorkspaceContext();
const route = useRoute();
const simulationId = route.params.simulationId as string;

const data = ref<SimulationGet | null>(null);
const error = ref("");
const feed = ref<{ id: number; type: string; at: string }[]>([]);
const feedMode = ref<"sse" | "polling" | "rest">("rest");
const cancelling = ref(false);
const cloning = ref(false);
let pollTimer: ReturnType<typeof setInterval> | null = null;
let abort: AbortController | null = null;

const TERMINAL = ["completed", "failed", "cancelled"];

async function load() {
  try {
    data.value = await api<SimulationGet>("GET", `/v1/simulations/${simulationId}`, { workspaceId: workspaceId.value });
    if (data.value && TERMINAL.includes(data.value.simulation.status)) {
      stopStreams();
    }
  } catch (err) {
    error.value = (err as Error).message;
  }
}

function stopStreams() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  abort?.abort();
  abort = null;
}

/** SSE with fetch: headers travel with the request (EventSource can't). */
async function streamEvents() {
  abort = new AbortController();
  try {
    const response = await fetch(`/v1/simulations/${simulationId}/events`, {
      headers: {
        "accept": "text/event-stream",
        "x-workspace-id": workspaceId.value,
      },
      credentials: "include",
      signal: abort.signal,
    });
    if (!response.ok || !response.body) throw new Error("SSE unavailable");
    feedMode.value = "sse";
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        for (const line of frame.split("\n")) {
          if (line.startsWith("data:")) {
            try {
              const event = JSON.parse(line.slice(5)) as { id?: number; type?: string };
              if (event.type) {
                feed.value.unshift({ id: event.id ?? feed.value.length, type: event.type, at: new Date().toISOString() });
                if (feed.value.length > 60) feed.value.pop();
              }
            } catch {
              // ignore malformed frame
            }
          }
        }
      }
    }
  } catch {
    // SSE failed (or was aborted at terminal state) — ensure polling covers us.
    if (feedMode.value === "sse") feedMode.value = "polling";
  }
}

watch(ready, (isReady) => {
  if (isReady) {
    void load();
    streamEvents();
    pollTimer = setInterval(() => {
      void load();
      if (feedMode.value === "polling") {
        feed.value.unshift({ id: Date.now(), type: "status_polled", at: new Date().toISOString() });
        if (feed.value.length > 60) feed.value.pop();
      }
    }, 3000);
  }
});

onBeforeUnmount(stopStreams);

async function cancelRun() {
  cancelling.value = true;
  error.value = "";
  try {
    await api("POST", `/v1/simulations/${simulationId}/cancel`, { workspaceId: workspaceId.value });
    await load();
  } catch (err) {
    error.value = (err as Error).message;
  } finally {
    cancelling.value = false;
  }
}

async function cloneRun() {
  cloning.value = true;
  error.value = "";
  try {
    const cloned = await api<{ simulation: { id: string } }>("POST", `/v1/simulations/${simulationId}/clone`, {
      workspaceId: workspaceId.value,
      body: {},
    });
    await navigateTo(`/app/${workspaceId.value}/simulations/${cloned.simulation.id}`);
  } catch (err) {
    error.value = (err as Error).message;
  } finally {
    cloning.value = false;
  }
}

const progress = computed(() => {
  if (!data.value) return 0;
  const ticks = data.value.simulation.config.ticks || 1;
  const maxTick = Math.max(...data.value.shards.map((s) => s.tick), 0);
  return Math.min(100, Math.round((maxTick / ticks) * 100));
});

const statusClass = (status: string) =>
  ({ completed: "ok", running: "busy", finalizing: "busy", queued: "busy", preparing: "busy", failed: "bad", cancelled: "bad" })[status] ?? "";
</script>

<template>
  <AppShell>
    <div v-if="!ready || !data" class="panel-note" role="status">Loading run…</div>
    <template v-else>
      <header class="run-header">
        <div>
          <p class="mono-label">Run {{ data.simulation.id.slice(0, 8) }} · {{ data.simulation.created_at }}</p>
          <h1 class="page-title">{{ data.simulation.config.decision_question }}</h1>
          <p class="mono-label">
            population {{ data.simulation.config.population.toLocaleString() }} ·
            {{ data.simulation.config.ticks }} ticks · {{ data.simulation.config.report_depth }} report ·
            {{ (data.simulation.manifest["provider"] as string) ?? "?" }} /
            {{ (data.simulation.manifest["model_id"] as string) ?? "?" }}
          </p>
        </div>
        <div class="run-actions">
          <span class="chip" :class="statusClass(data.simulation.status)">{{ data.simulation.status }}</span>
          <button v-if="!TERMINAL.includes(data.simulation.status)" type="button" class="panel-button" :disabled="cancelling" @click="cancelRun">
            {{ cancelling ? "Cancelling…" : "Cancel run" }}
          </button>
          <button type="button" class="panel-button" :disabled="cloning" @click="cloneRun">
            {{ cloning ? "Cloning…" : "Clone to new run" }}
          </button>
          <NuxtLink v-if="data.report" :to="`/app/${workspaceId}/reports/${data.report.id}`" class="panel-button report-link">
            Open report
          </NuxtLink>
        </div>
      </header>

      <p v-if="error" class="panel-error" role="alert">{{ error }}</p>
      <p v-if="data.simulation.error" class="panel-error" role="alert">{{ data.simulation.error }}</p>

      <div class="meter-grid">
        <section class="surface panel" aria-labelledby="progress-heading">
          <h2 id="progress-heading" class="panel-heading">Progress</h2>
          <p class="progress-value">{{ progress }}%</p>
          <div class="progress-track" role="progressbar" :aria-valuenow="progress" aria-valuemin="0" aria-valuemax="100">
            <div class="progress-fill" :style="{ width: progress + '%' }" />
          </div>
          <p class="panel-note">
            reserved {{ data.simulation.credits_reserved ?? data.reservation?.amount ?? 0 }} ·
            used {{ data.simulation.credits_used }}
            <span v-if="data.reservation">· reservation {{ data.reservation.status }}</span>
          </p>
          <p class="mono-label">live via {{ feedMode === "sse" ? "server-sent events" : "polling" }}</p>
        </section>

        <section class="surface panel" aria-labelledby="shards-heading">
          <h2 id="shards-heading" class="panel-heading">Shards</h2>
          <ul v-if="data.shards.length" class="shard-list">
            <li v-for="shard in data.shards" :key="shard.shard_index" class="shard-row">
              <span class="mono-label">shard {{ shard.shard_index }}</span>
              <span class="chip" :class="statusClass(shard.status)">{{ shard.status }}</span>
              <span class="mono-label">tick {{ shard.tick }}</span>
              <span class="mono-label">heartbeat {{ new Date(shard.heartbeat_at).toLocaleTimeString() }}</span>
            </li>
          </ul>
          <p v-else class="panel-note">Shards appear once the run reaches the simulation stage.</p>
        </section>
      </div>

      <section class="surface panel feed-panel" aria-labelledby="feed-heading">
        <h2 id="feed-heading" class="panel-heading">Event feed</h2>
        <p class="panel-note">Coarse durable events only — detailed reasoning lives in checkpoints and the final report.</p>
        <ol v-if="feed.length" class="feed-list">
          <li v-for="item in feed" :key="item.id">
            <span class="mono-label">{{ new Date(item.at).toLocaleTimeString() }}</span>
            <span>{{ item.type }}</span>
          </li>
        </ol>
        <p v-else class="panel-note">Waiting for events…</p>
      </section>
    </template>
  </AppShell>
</template>

<style scoped>
.page-title {
  font-size: clamp(1.5rem, 2.6vw, 2.2rem);
  font-weight: 600;
  margin: var(--space-2) 0;
}
.run-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--space-4);
  flex-wrap: wrap;
  margin-bottom: var(--space-6);
}
.run-actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
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
.panel-button:disabled {
  opacity: 0.5;
}
.report-link {
  border-color: var(--color-action);
  color: var(--color-action);
}
.panel-error {
  color: var(--color-danger);
}
.panel-note {
  color: var(--color-text-secondary);
  font-size: 0.92rem;
}
.panel {
  padding: var(--space-4);
}
.panel-heading {
  font-size: 1.2rem;
  margin: 0 0 var(--space-4);
}
.meter-grid {
  display: grid;
  grid-template-columns: 1fr 1.4fr;
  gap: var(--space-4);
}
@media (max-width: 1100px) {
  .meter-grid {
    grid-template-columns: 1fr;
  }
}
.progress-value {
  font-family: var(--font-display);
  font-size: 3rem;
  font-weight: 600;
  margin: 0 0 var(--space-2);
}
.progress-track {
  height: 10px;
  border-radius: 5px;
  background: var(--color-bg-inset);
  overflow: hidden;
  margin-bottom: var(--space-3);
}
.progress-fill {
  height: 100%;
  background: var(--color-action);
  transition: width 300ms ease-out;
}
.chip {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-control);
  padding: var(--space-1) var(--space-2);
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
.shard-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: var(--space-2);
}
.shard-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;
  border-bottom: 1px solid var(--color-border);
  padding-bottom: var(--space-2);
}
.feed-panel {
  margin-top: var(--space-4);
}
.feed-list {
  list-style: none;
  margin: var(--space-3) 0 0;
  padding: 0;
  display: grid;
  gap: var(--space-1);
  max-height: 260px;
  overflow-y: auto;
  font-size: 0.92rem;
}
.feed-list li {
  display: flex;
  gap: var(--space-3);
}
</style>
