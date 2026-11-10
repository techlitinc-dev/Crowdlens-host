<script setup lang="ts">
/** Provider settings (design.md §5.6): workspace defaults, BYOK (write-only),
 *  validation. Applies to new runs only — existing runs stay pinned. */
interface DefaultsResponse {
  configs: {
    id: string;
    provider: string;
    model_allowlist: string[];
    data_policy: { data_collection: "allow" | "deny"; zdr: boolean };
    is_default: boolean;
    validated_at: string | null;
  }[];
  server_key_available: Record<string, boolean>;
}
interface Catalog {
  providers: { id: string; label: string; models: { id: string; label: string; structured_output: boolean }[] }[];
}

const { api } = useApi();
const { workspaceId, ready } = useWorkspaceContext();
const defaults = ref<DefaultsResponse | null>(null);
const catalog = ref<Catalog | null>(null);
const error = ref("");
const notice = ref("");
const busy = ref(false);

const form = ref({
  provider: "gemini" as "gemini" | "openrouter",
  models: [] as string[],
  data_collection: "deny" as "allow" | "deny",
  zdr: false,
  byokKey: "",
});

async function load() {
  try {
    const [d, c] = await Promise.all([
      api<DefaultsResponse>("GET", `/v1/workspaces/${workspaceId.value}/provider-defaults`, { workspaceId: workspaceId.value }),
      api<Catalog>("GET", "/v1/providers/catalog", { workspaceId: workspaceId.value }),
    ]);
    defaults.value = d;
    catalog.value = c;
    const current = d.configs.find((cfg) => cfg.provider === form.value.provider && cfg.is_default);
    if (current) {
      form.value.models = current.model_allowlist;
      form.value.data_collection = current.data_policy.data_collection;
      form.value.zdr = current.data_policy.zdr;
    } else {
      const models = catalogModels(form.value.provider);
      form.value.models = models[0] ? [models[0].id] : [];
    }
  } catch (err) {
    error.value = (err as Error).message;
  }
}

function catalogModels(provider: string) {
  return catalog.value?.providers.find((p) => p.id === provider)?.models ?? [];
}

watch(ready, (isReady) => {
  if (isReady) void load();
});
onMounted(() => {
  if (ready.value) void load();
});

watch(() => form.value.provider, () => {
  const models = catalogModels(form.value.provider);
  form.value.models = models[0] ? [models[0]!.id] : [];
});

async function saveDefaults() {
  busy.value = true;
  error.value = "";
  notice.value = "";
  try {
    await api("PUT", `/v1/workspaces/${workspaceId.value}/provider-defaults`, {
      workspaceId: workspaceId.value,
      body: {
        provider: form.value.provider,
        model_allowlist: form.value.models,
        data_policy: { data_collection: form.value.data_collection, zdr: form.value.zdr },
        ...(form.value.byokKey ? { byok_key: form.value.byokKey } : {}),
      },
    });
    notice.value = "Defaults saved. Applies to new runs only — existing runs stay pinned.";
    form.value.byokKey = "";
    await load();
  } catch (err) {
    error.value = (err as Error).message;
  } finally {
    busy.value = false;
  }
}

async function validateProvider() {
  busy.value = true;
  error.value = "";
  notice.value = "";
  try {
    const result = await api<{ ok: boolean; detail: string }>("POST", "/v1/provider-configs/validate", {
      workspaceId: workspaceId.value,
      body: { provider: form.value.provider, model_id: form.value.models[0] ?? "" },
    });
    notice.value = result.ok ? "Provider reachable." : `Validation failed: ${result.detail}`;
    await load();
  } catch (err) {
    error.value = (err as Error).message;
  } finally {
    busy.value = false;
  }
}

function toggleModel(modelId: string) {
  const set = new Set(form.value.models);
  if (set.has(modelId)) set.delete(modelId);
  else set.add(modelId);
  form.value.models = [...set];
}
</script>

<template>
  <AppShell>
    <h1 class="page-title">Providers</h1>
    <p class="panel-note">
      Workspace defaults apply to <strong>new runs only</strong>; each run pins provider, model, prompt
      bundle, and rate card in its manifest. Keys are write-only and never returned.
    </p>
    <p v-if="error" class="panel-error" role="alert">{{ error }}</p>
    <p v-if="notice" class="panel-notice" role="status">{{ notice }}</p>

    <div class="surface panel">
      <div class="provider-tabs" role="tablist" aria-label="Provider">
        <button
          type="button"
          class="tab"
          :class="{ active: form.provider === 'gemini' }"
          role="tab"
          :aria-selected="form.provider === 'gemini'"
          @click="form.provider = 'gemini'"
        >
          Gemini (AI Studio key)
          <span class="mono-label">{{ defaults?.server_key_available.gemini ? "server key set" : "no server key" }}</span>
        </button>
        <button
          type="button"
          class="tab"
          :class="{ active: form.provider === 'openrouter' }"
          role="tab"
          :aria-selected="form.provider === 'openrouter'"
          @click="form.provider = 'openrouter'"
        >
          OpenRouter
          <span class="mono-label">{{ defaults?.server_key_available.openrouter ? "server key set" : "no server key" }}</span>
        </button>
      </div>

      <fieldset class="models">
        <legend class="mono-label">Model allowlist (from the server catalog)</legend>
        <label v-for="model in catalogModels(form.provider)" :key="model.id" class="model-option">
          <input
            type="checkbox"
            :checked="form.models.includes(model.id)"
            :disabled="busy"
            @change="toggleModel(model.id)"
          />
          <span>{{ model.label }}</span>
          <span class="mono-label">{{ model.structured_output ? "structured output ✓" : "no structured output" }}</span>
        </label>
      </fieldset>

      <div class="policy-row">
        <label>
          Data policy
          <select v-model="form.data_collection">
            <option value="deny">data_collection: deny</option>
            <option value="allow">data_collection: allow</option>
          </select>
        </label>
        <label class="zdr">
          <input v-model="form.zdr" type="checkbox" />
          Zero-data-retention (ZDR) where supported
        </label>
      </div>

      <label>
        Bring your own key (optional, write-only)
        <input v-model="form.byokKey" type="password" maxlength="200" placeholder="Paste a key to replace the current one" autocomplete="off" />
      </label>

      <div class="actions">
        <button type="button" class="panel-button" :disabled="busy || !form.models.length" @click="saveDefaults">
          Save defaults
        </button>
        <button type="button" class="panel-button" :disabled="busy || !form.models.length" @click="validateProvider">
          Validate connection
        </button>
      </div>
    </div>

    <div v-if="defaults?.configs.length" class="surface panel">
      <h2 class="panel-heading">Configured defaults</h2>
      <ul class="config-list">
        <li v-for="config in defaults.configs" :key="config.id">
          <span class="mono-label">{{ config.provider }}</span>
          <span>{{ config.model_allowlist.join(", ") }}</span>
          <span class="mono-label">{{ config.data_policy.data_collection }} · zdr {{ config.data_policy.zdr }}</span>
          <span class="mono-label">{{ config.validated_at ? `validated ${new Date(config.validated_at).toLocaleString()}` : "not validated" }}</span>
        </li>
      </ul>
    </div>
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
.provider-tabs {
  display: flex;
  gap: var(--space-3);
  flex-wrap: wrap;
  margin-bottom: var(--space-4);
}
.tab {
  background: var(--color-bg-inset);
  border: 1px solid var(--color-border);
  color: var(--color-text-secondary);
  border-radius: var(--radius-control);
  padding: var(--space-2) var(--space-4);
  cursor: pointer;
  display: grid;
  gap: 2px;
  text-align: start;
}
.tab.active {
  border-color: var(--color-action);
  color: var(--color-action);
}
.models {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-control);
  margin: 0 0 var(--space-4);
  padding: var(--space-3);
}
.model-option {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-bottom: var(--space-2);
}
.policy-row {
  display: flex;
  gap: var(--space-6);
  align-items: flex-end;
  flex-wrap: wrap;
  margin-bottom: var(--space-4);
}
.zdr {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.actions {
  display: flex;
  gap: var(--space-3);
  margin-top: var(--space-4);
}
.panel-button {
  background: var(--color-bg-inset);
  border: 1px solid var(--color-border);
  color: var(--color-text);
  border-radius: var(--radius-control);
  padding: var(--space-2) var(--space-4);
  cursor: pointer;
}
.config-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: var(--space-2);
}
.config-list li {
  display: flex;
  gap: var(--space-4);
  flex-wrap: wrap;
  border-bottom: 1px solid var(--color-border);
  padding-bottom: var(--space-2);
  font-size: 0.95rem;
}
</style>
