<script setup lang="ts">
/** Usage and ledger (design.md §5.7): balance, reservations, ledger entries. */
interface LedgerRow {
  id: string;
  entry_type: string;
  amount: number;
  idempotency_key: string;
  actor: string;
  simulation_id: string | null;
  reason: string;
  occurred_at: string;
}
interface UsageRow {
  id: string;
  simulation_id: string;
  usage_type: string;
  provider: string;
  input_tokens: number;
  output_tokens: number;
  is_estimate: boolean;
  created_at: string;
}

const { api } = useApi();
const { workspaceId, ready } = useWorkspaceContext();
const overview = ref<{ balance: { granted: number; debited: number; reserved: number; available: number }; plan: string } | null>(null);
const ledger = ref<LedgerRow[]>([]);
const usage = ref<UsageRow[]>([]);
const error = ref("");

async function load() {
  try {
    const [ov, lg, us] = await Promise.all([
      api<typeof overview.value>("GET", "/v1/billing/overview", { workspaceId: workspaceId.value }),
      api<{ items: LedgerRow[] }>("GET", "/v1/billing/ledger?limit=50", { workspaceId: workspaceId.value }),
      api<{ items: UsageRow[] }>("GET", "/v1/billing/usage?limit=50", { workspaceId: workspaceId.value }),
    ]);
    overview.value = ov;
    ledger.value = lg.items;
    usage.value = us.items;
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

const signed = (amount: number) => (amount >= 0 ? `+${amount}` : String(amount));
const entryClass = (type: string) =>
  type.includes("release") || type.includes("grant") ? "credit" : "debit";
</script>

<template>
  <AppShell>
    <h1 class="page-title">Usage</h1>
    <p v-if="error" class="panel-error" role="alert">{{ error }}</p>

    <div v-if="overview" class="balance-grid">
      <div class="surface balance-card">
        <p class="mono-label">Available</p>
        <p class="balance-value">{{ overview.balance.available.toLocaleString() }}</p>
      </div>
      <div class="surface balance-card">
        <p class="mono-label">Granted</p>
        <p class="balance-value">{{ overview.balance.granted.toLocaleString() }}</p>
      </div>
      <div class="surface balance-card">
        <p class="mono-label">Debited</p>
        <p class="balance-value">{{ overview.balance.debited.toLocaleString() }}</p>
      </div>
      <div class="surface balance-card">
        <p class="mono-label">Reserved</p>
        <p class="balance-value">{{ overview.balance.reserved.toLocaleString() }}</p>
      </div>
    </div>

    <section aria-labelledby="ledger-heading" class="usage-section">
      <h2 id="ledger-heading" class="panel-heading">Ledger</h2>
      <div class="surface table-scroll">
        <table class="table-plain">
          <thead>
            <tr><th scope="col">When</th><th scope="col">Type</th><th scope="col">Amount</th><th scope="col">Actor</th><th scope="col">Reason</th></tr>
          </thead>
          <tbody>
            <tr v-for="entry in ledger" :key="entry.id">
              <td class="mono-label">{{ new Date(entry.occurred_at).toLocaleString() }}</td>
              <td>{{ entry.entry_type }}</td>
              <td :class="entryClass(entry.entry_type)">{{ signed(entry.amount) }}</td>
              <td>{{ entry.actor }}</td>
              <td>{{ entry.reason || "—" }}</td>
            </tr>
          </tbody>
        </table>
        <p v-if="!ledger.length" class="panel-note">No ledger entries yet.</p>
      </div>
    </section>

    <section aria-labelledby="usage-heading" class="usage-section">
      <h2 id="usage-heading" class="panel-heading">Usage records</h2>
      <div class="surface table-scroll">
        <table class="table-plain">
          <thead>
            <tr><th scope="col">When</th><th scope="col">Type</th><th scope="col">Provider</th><th scope="col">Tokens</th><th scope="col">Estimated?</th></tr>
          </thead>
          <tbody>
            <tr v-for="row in usage" :key="row.id">
              <td class="mono-label">{{ new Date(row.created_at).toLocaleString() }}</td>
              <td>{{ row.usage_type }}</td>
              <td>{{ row.provider }}</td>
              <td>{{ row.input_tokens }} in / {{ row.output_tokens }} out</td>
              <td>{{ row.is_estimate ? "yes" : "no" }}</td>
            </tr>
          </tbody>
        </table>
        <p v-if="!usage.length" class="panel-note">No usage recorded yet — run a scenario to see metering.</p>
      </div>
    </section>
  </AppShell>
</template>

<style scoped>
.page-title {
  font-size: clamp(1.8rem, 3vw, 2.4rem);
  font-weight: 600;
  margin: 0 0 var(--space-6);
}
.panel-error {
  color: var(--color-danger);
}
.panel-note {
  color: var(--color-text-secondary);
  padding: var(--space-3);
}
.balance-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--space-4);
  margin-bottom: var(--space-8);
}
@media (max-width: 900px) {
  .balance-grid {
    grid-template-columns: 1fr 1fr;
  }
}
.balance-card {
  padding: var(--space-4);
}
.balance-value {
  font-family: var(--font-display);
  font-size: 2rem;
  font-weight: 600;
  margin: var(--space-1) 0 0;
}
.usage-section {
  margin-bottom: var(--space-8);
}
.panel-heading {
  font-size: 1.2rem;
  margin: 0 0 var(--space-3);
}
.table-scroll {
  overflow-x: auto;
  padding: var(--space-2);
}
.credit {
  color: var(--color-action);
}
.debit {
  color: var(--color-danger);
}
</style>
