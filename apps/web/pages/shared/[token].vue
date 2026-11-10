<script setup lang="ts">
/**
 * Public share view: a revocable, expiring capability link to a report.
 * No-store by policy (the API enforces it); a revoked or expired share is a
 * plain 404 here, same as the API.
 */
const route = useRoute();
const token = route.params.token as string;

const { api } = useApi();
const report = ref<{ report: Record<string, unknown>; scope: string; expires_at: string | null } | null>(null);
const error = ref("");
const notFound = ref(false);

onMounted(async () => {
  try {
    report.value = await api("GET", `/v1/report-shares/${token}/view`);
  } catch (err) {
    if ((err as { status?: number }).status === 404) {
      notFound.value = true;
    } else {
      error.value = (err as Error).message;
    }
  }
});

const pick = <T,>(key: string): T | undefined => report.value?.report[key] as T | undefined;

const segments = computed(() => pick<{ name: string; share: number; stance: string }[]>("segments"));
const method = computed(() => pick<Record<string, unknown>>("method"));
const limitations = computed(() => pick<string[]>("limitations"));
</script>

<template>
  <div class="share-page">
    <main class="section-frame share-frame">
      <BrandMark :size="28" />
      <p v-if="error" class="panel-error" role="alert">{{ error }}</p>
      <template v-if="notFound">
        <h1>Link not available</h1>
        <p class="panel-note">
          This share link is revoked, expired, or never existed. Ask the workspace owner for a
          new link.
        </p>
      </template>
      <template v-else-if="report">
        <p class="mono-label share-meta">
          Shared report · scope {{ report.scope }}<span v-if="report.expires_at"> · expires
          {{ new Date(report.expires_at).toLocaleString() }}</span>
        </p>

        <section v-if="pick('summary')" class="surface panel">
          <h1 class="page-title">Summary</h1>
          <p v-if="pick('recommendation')" class="recommendation">{{ pick("recommendation") }}</p>
          <p>{{ pick("summary") }}</p>
        </section>

        <section v-if="pick('segments')" class="surface panel">
          <h2 class="panel-heading">Segments</h2>
          <table class="table-plain">
            <thead>
              <tr><th scope="col">Segment</th><th scope="col">Share</th><th scope="col">Stance</th></tr>
            </thead>
            <tbody>
              <tr v-for="segment in segments" :key="segment.name">
                <td>{{ segment.name }}</td>
                <td>{{ Math.round(segment.share * 100) }}%</td>
                <td>{{ segment.stance }}</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section class="surface panel">
          <h2 class="panel-heading">Method</h2>
          <dl class="method-grid">
            <template v-for="(value, key) in method ?? {}" :key="key">
              <dt class="mono-label">{{ key }}</dt>
              <dd>{{ value }}</dd>
            </template>
          </dl>
          <ul class="limitations">
            <li v-for="limitation in limitations ?? []" :key="limitation">{{ limitation }}</li>
          </ul>
          <p v-if="pick('disclaimer')" class="disclaimer">{{ pick("disclaimer") }}</p>
          <p class="provenance mono-label">synthetic agent output, not real-person testimony</p>
        </section>
      </template>
      <p v-else class="panel-note" role="status">Loading shared report…</p>
    </main>
  </div>
</template>

<style scoped>
.share-page {
  min-height: 100dvh;
}
.share-frame {
  max-width: 900px;
  padding-top: var(--space-16);
  display: grid;
  gap: var(--space-4);
}
.page-title {
  font-size: clamp(1.6rem, 3vw, 2.2rem);
  font-weight: 600;
  margin: 0 0 var(--space-3);
}
.panel {
  padding: var(--space-4);
}
.panel-heading {
  font-size: 1.2rem;
  margin: 0 0 var(--space-3);
}
.panel-error {
  color: var(--color-danger);
}
.panel-note {
  color: var(--color-text-secondary);
}
.share-meta {
  color: var(--color-text-secondary);
}
.recommendation {
  font-weight: 600;
  font-size: 1.06rem;
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
}
.provenance {
  color: var(--color-action);
  margin: var(--space-3) 0 0;
}
</style>
