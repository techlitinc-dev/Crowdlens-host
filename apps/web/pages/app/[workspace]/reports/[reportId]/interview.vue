<script setup lang="ts">
/**
 * Agent interview (design.md §5.5): ask a synthetic agent about the report.
 * Responses always carry the provenance disclosure (synthetic output, not
 * real-person testimony) — the API enforces it; we surface it prominently.
 */
interface InterviewGet {
  interview: {
    id: string;
    status: string;
    agent_ref: string;
    question: string;
    response: Record<string, unknown> | null;
    error: string | null;
    created_at: string;
  };
}

const { api } = useApi();
const { workspaceId, ready } = useWorkspaceContext();
const route = useRoute();
const reportId = route.params.reportId as string;

const agentRef = ref("segment/cost-sensitive-smes/agent/0");
const question = ref("");
const current = ref<InterviewGet["interview"] | null>(null);
const history = ref<InterviewGet["interview"][]>([]);
const error = ref("");
const asking = ref(false);
let pollTimer: ReturnType<typeof setInterval> | null = null;

async function ask() {
  if (!question.value.trim() || asking.value) return;
  asking.value = true;
  error.value = "";
  try {
    const created = await api<{ interview_id: string }>("POST", `/v1/reports/${reportId}/interviews`, {
      workspaceId: workspaceId.value,
      body: { agent_ref: agentRef.value, question: question.value.trim() },
    });
    question.value = "";
    await pollUntilDone(created.interview_id);
  } catch (err) {
    error.value = (err as Error).message;
  } finally {
    asking.value = false;
  }
}

async function pollUntilDone(interviewId: string) {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    try {
      const result = await api<InterviewGet>("GET", `/v1/interviews/${interviewId}`, { workspaceId: workspaceId.value });
      if (result.interview.status === "completed") {
        if (pollTimer) clearInterval(pollTimer);
        pollTimer = null;
        current.value = result.interview;
        history.value.unshift(result.interview);
      } else if (result.interview.status === "failed") {
        if (pollTimer) clearInterval(pollTimer);
        pollTimer = null;
        error.value = result.interview.error ?? "Interview failed";
      }
    } catch (err) {
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = null;
      error.value = (err as Error).message;
    }
  }, 1500);
}

onBeforeUnmount(() => {
  if (pollTimer) clearInterval(pollTimer);
});

const responseText = (response: Record<string, unknown> | null): string => {
  if (!response) return "";
  return (response["answer"] as string) ?? (response["text"] as string) ?? JSON.stringify(response);
};
</script>

<template>
  <AppShell>
    <header class="interview-header">
      <p class="mono-label"><NuxtLink :to="`/app/${workspaceId}/reports/${reportId}`">← Back to report</NuxtLink></p>
      <h1 class="page-title">Interview a synthetic agent</h1>
      <p class="panel-note">
        Ask an agent from the synthetic population about the report. Every response discloses its
        provenance: synthetic agent output, not real-person testimony.
      </p>
    </header>

    <p v-if="error" class="panel-error" role="alert">{{ error }}</p>

    <form class="ask surface" @submit.prevent="ask">
      <div class="ask-fields">
        <label>
          Agent
          <select v-model="agentRef">
            <option value="segment/cost-sensitive-smes/agent/0">Cost-sensitive SME agent</option>
            <option value="segment/reliability-first-ops/agent/0">Reliability-first operator agent</option>
            <option value="segment/platform-builders/agent/0">Platform builder agent</option>
            <option value="segment/finance-reviewers/agent/0">Finance reviewer agent</option>
          </select>
        </label>
        <label>
          Question
          <input v-model="question" type="text" required minlength="4" maxlength="2000" placeholder="Why did your segment object to per-seat pricing?" />
        </label>
      </div>
      <button type="submit" class="ask-button" :disabled="asking || !question.trim()">
        {{ asking ? "Waiting for the agent…" : "Ask" }}
      </button>
    </form>

    <div v-if="asking && !current" class="panel-note" role="status">The report worker is generating a response…</div>

    <section v-if="history.length" aria-labelledby="history-heading">
      <h2 id="history-heading" class="panel-heading">Responses</h2>
      <article v-for="item in history" :key="item.id" class="surface response">
        <p class="mono-label">{{ item.agent_ref }}</p>
        <p class="question"><strong>Q:</strong> {{ item.question }}</p>
        <p class="answer"><strong>A:</strong> {{ responseText(item.response) }}</p>
        <p class="provenance mono-label">synthetic agent output, not real-person testimony</p>
      </article>
    </section>
  </AppShell>
</template>

<style scoped>
.page-title {
  font-size: clamp(1.6rem, 2.6vw, 2.2rem);
  font-weight: 600;
  margin: var(--space-2) 0;
}
.interview-header {
  margin-bottom: var(--space-6);
}
.panel-note {
  color: var(--color-text-secondary);
}
.panel-error {
  color: var(--color-danger);
}
.ask {
  padding: var(--space-4);
  display: grid;
  gap: var(--space-4);
  margin-bottom: var(--space-6);
}
.ask-fields {
  display: grid;
  grid-template-columns: minmax(220px, 320px) 1fr;
  gap: var(--space-4);
}
@media (max-width: 900px) {
  .ask-fields {
    grid-template-columns: 1fr;
  }
}
.ask-button {
  background: var(--color-action);
  color: var(--color-on-action);
  border: none;
  border-radius: var(--radius-control);
  font-weight: 600;
  padding: var(--space-3);
  cursor: pointer;
  justify-self: start;
}
.ask-button:disabled {
  opacity: 0.5;
}
.panel-heading {
  font-size: 1.2rem;
  margin: 0 0 var(--space-3);
}
.response {
  padding: var(--space-4);
  margin-bottom: var(--space-3);
}
.question,
.answer {
  margin: var(--space-2) 0;
}
.provenance {
  color: var(--color-action);
  margin: var(--space-3) 0 0;
}
</style>
