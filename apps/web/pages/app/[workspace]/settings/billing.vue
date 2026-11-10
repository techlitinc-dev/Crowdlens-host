<script setup lang="ts">
import { ApiError } from "~/composables/useApi";
/** Billing (design.md §5.7): plan, packs, subscription status. Without
 *  Razorpay keys the API returns billing-not-configured and the UI says so
 *  honestly instead of pretending checkout works. */
interface Overview {
  plan: string;
  balance: { available: number; reserved: number };
  subscription: { id: string; plan_code: string; status: string; cancel_at_period_end: boolean } | null;
  razorpay_configured: boolean;
}
interface CatalogBody {
  plans: { code: string; name: string; price_minor: number; included_credits: number }[];
  credit_packs: { code: string; credits: number; price_minor: number }[];
}

const { api } = useApi();
const { workspaceId, ready } = useWorkspaceContext();
const overview = ref<Overview | null>(null);
const catalog = ref<CatalogBody | null>(null);
const error = ref("");
const notice = ref("");

async function load() {
  try {
    const [ov, cat] = await Promise.all([
      api<Overview>("GET", "/v1/billing/overview", { workspaceId: workspaceId.value }),
      api<CatalogBody>("GET", "/v1/billing/catalog", { workspaceId: workspaceId.value }),
    ]);
    overview.value = ov;
    catalog.value = cat;
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

function formatINR(minor: number): string {
  return minor === 0 ? "Free" : `₹${(minor / 100).toLocaleString("en-IN")}`;
}

async function buyPack(code: string) {
  error.value = "";
  notice.value = "";
  try {
    const result = await api<{ checkout: { order_id: string } }>("POST", "/v1/billing/credit-packs", {
      workspaceId: workspaceId.value,
      body: { pack_code: code },
    });
    notice.value = `Razorpay order ${result.checkout.order_id} created. Checkout opens when billing is configured in this environment.`;
  } catch (err) {
    if (err instanceof ApiError && err.code === "billing-not-configured") {
      notice.value = "Billing is not configured in this environment (no Razorpay keys). Pack purchase is disabled here.";
    } else {
      error.value = (err as Error).message;
    }
  }
}

async function subscribe(code: string) {
  error.value = "";
  notice.value = "";
  try {
    await api("POST", "/v1/billing/subscriptions", { workspaceId: workspaceId.value, body: { plan_code: code } });
    await load();
  } catch (err) {
    if (err instanceof ApiError && err.code === "billing-not-configured") {
      notice.value = "Billing is not configured in this environment (no Razorpay keys). Subscription purchase is disabled here.";
    } else {
      error.value = (err as Error).message;
    }
  }
}
</script>

<template>
  <AppShell>
    <h1 class="page-title">Billing</h1>
    <p v-if="error" class="panel-error" role="alert">{{ error }}</p>
    <p v-if="notice" class="panel-notice" role="status">{{ notice }}</p>

    <div v-if="overview" class="surface panel balance-panel">
      <div>
        <p class="mono-label">Current plan</p>
        <p class="balance-value">{{ overview.plan }}</p>
      </div>
      <div>
        <p class="mono-label">Available credits</p>
        <p class="balance-value">{{ overview.balance.available.toLocaleString() }}</p>
      </div>
      <div>
        <p class="mono-label">Subscription</p>
        <p v-if="overview.subscription" class="balance-value small">
          {{ overview.subscription.plan_code }} · {{ overview.subscription.status }}
          <span v-if="overview.subscription.cancel_at_period_end">· cancels at period end</span>
        </p>
        <p v-else class="balance-value small">none</p>
      </div>
    </div>

    <section v-if="catalog" class="billing-grid">
      <div class="surface panel">
        <h2 class="panel-heading">Plans</h2>
        <ul class="plan-list">
          <li v-for="plan in catalog.plans" :key="plan.code" class="plan-row">
            <div>
              <strong>{{ plan.name }}</strong>
              <p class="mono-label">{{ formatINR(plan.price_minor) }} · {{ plan.included_credits.toLocaleString() }} credits included</p>
            </div>
            <button v-if="plan.code !== 'explorer'" type="button" class="panel-button" @click="subscribe(plan.code)">
              Subscribe
            </button>
          </li>
        </ul>
      </div>
      <div class="surface panel">
        <h2 class="panel-heading">Credit packs</h2>
        <ul class="plan-list">
          <li v-for="pack in catalog.credit_packs" :key="pack.code" class="plan-row">
            <div>
              <strong>{{ pack.credits.toLocaleString() }} credits</strong>
              <p class="mono-label">{{ formatINR(pack.price_minor) }}</p>
            </div>
            <button type="button" class="panel-button" @click="buyPack(pack.code)">Buy</button>
          </li>
        </ul>
        <p class="panel-note">One-time top-ups; never expire on the launch plan.</p>
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
.balance-panel {
  display: flex;
  gap: var(--space-8);
  flex-wrap: wrap;
}
.balance-value {
  font-family: var(--font-display);
  font-size: 1.6rem;
  font-weight: 600;
  margin: var(--space-1) 0 0;
}
.balance-value.small {
  font-size: 1.1rem;
}
.billing-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-4);
}
@media (max-width: 900px) {
  .billing-grid {
    grid-template-columns: 1fr;
  }
}
.plan-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: var(--space-3);
}
.plan-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-4);
  border-bottom: 1px solid var(--color-border);
  padding-bottom: var(--space-3);
}
.panel-button {
  background: var(--color-bg-inset);
  border: 1px solid var(--color-border);
  color: var(--color-text);
  border-radius: var(--radius-control);
  padding: var(--space-2) var(--space-4);
  cursor: pointer;
}
.panel-note {
  color: var(--color-text-secondary);
  font-size: 0.92rem;
}
</style>
