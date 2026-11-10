<script setup lang="ts">
/**
 * Sign in. With dev identity active (no OIDC configured) this is a simple
 * email form backed by POST /v1/auth/dev/login; production swaps this page
 * for the OIDC redirect without changing the session contract.
 */
const { api } = useApi();
const email = ref("");
const displayName = ref("");
const error = ref("");
const busy = ref(false);

const redirect = computed(() => useRoute().query.redirect as string | undefined);

async function signIn() {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  try {
    await api("POST", "/v1/auth/dev/login", { body: { email: email.value.trim(), display_name: displayName.value.trim() || undefined } });
    // Pick the first workspace (explicit switch happens inside the app).
    await navigateTo(redirect.value ?? "/app");
  } catch (err) {
    error.value = (err as Error).message;
  } finally {
    busy.value = false;
  }
}

onMounted(async () => {
  try {
    const me = await api<{ user: unknown | null }>("GET", "/v1/auth/me");
    if (me.user) await navigateTo(redirect.value ?? "/app");
  } catch {
    // not signed in — stay
  }
});
</script>

<template>
  <div class="signin">
    <main class="signin-panel surface" aria-labelledby="signin-heading">
      <BrandMark :size="32" />
      <h1 id="signin-heading">Sign in to CrowdLens</h1>
      <p class="signin-note">
        Local development identity — no password. A workspace is created for you on first sign-in.
      </p>
      <form @submit.prevent="signIn">
        <label>
          Email
          <input v-model="email" type="email" required autocomplete="email" placeholder="you@example.com" />
        </label>
        <label>
          Display name (optional)
          <input v-model="displayName" type="text" autocomplete="name" placeholder="Ada" />
        </label>
        <button type="submit" class="signin-button" :disabled="busy || !email">
          {{ busy ? "Signing in…" : "Sign in" }}
        </button>
        <p v-if="error" class="signin-error" role="alert">{{ error }}</p>
      </form>
      <NuxtLink to="/" class="signin-back">← Back to the observatory</NuxtLink>
    </main>
  </div>
</template>

<style scoped>
.signin {
  min-height: 100dvh;
  display: grid;
  place-items: center;
  padding: var(--space-4);
}
.signin-panel {
  width: min(420px, 100%);
  padding: var(--space-8);
  display: grid;
  gap: var(--space-4);
}
h1 {
  font-size: 1.6rem;
  margin: 0;
}
.signin-note {
  color: var(--color-text-secondary);
  font-size: 0.95rem;
  margin: 0;
}
form {
  display: grid;
  gap: var(--space-4);
}
.signin-button {
  background: var(--color-action);
  color: var(--color-on-action);
  border: none;
  border-radius: var(--radius-control);
  font-weight: 600;
  padding: var(--space-3);
  cursor: pointer;
}
.signin-button:disabled {
  opacity: 0.5;
  cursor: default;
}
.signin-error {
  color: var(--color-danger);
  margin: 0;
  font-size: 0.92rem;
}
.signin-back {
  font-size: 0.92rem;
  color: var(--color-text-secondary);
}
</style>
