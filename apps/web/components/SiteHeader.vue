<script setup lang="ts">
/**
 * Public-site header: transparent over the hero, opaque charcoal surface
 * after scrolling past the top 24px (design.md §3.1). Mobile drawer is
 * keyboard-operable with Escape, backdrop, and focus return.
 */
const scrolled = ref(false);
const drawerOpen = ref(false);
let lastFocused: HTMLElement | null = null;

const navItems = [
  { label: "Product", href: "/#product" },
  { label: "Method", href: "/#method" },
  { label: "Use cases", href: "/#use-cases" },
  { label: "Pricing", href: "/#pricing" },
  { label: "Sample report", href: "/sample-report" },
];

onMounted(() => {
  const onScroll = () => {
    scrolled.value = window.scrollY > 24;
  };
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });
  onBeforeUnmount(() => window.removeEventListener("scroll", onScroll));
});

function openDrawer() {
  lastFocused = document.activeElement as HTMLElement;
  drawerOpen.value = true;
  nextTick(() => {
    (document.querySelector("[data-drawer-close]") as HTMLElement | null)?.focus();
  });
}

function closeDrawer() {
  drawerOpen.value = false;
  nextTick(() => lastFocused?.focus());
}

function onDrawerKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") closeDrawer();
}
</script>

<template>
  <header class="site-header" :class="{ 'is-scrolled': scrolled }">
    <div class="header-inner">
      <NuxtLink to="/" class="header-brand" aria-label="CrowdLens home">
        <BrandMark :size="26" />
      </NuxtLink>

      <nav class="header-nav" aria-label="Primary">
        <NuxtLink v-for="item in navItems" :key="item.href" :to="item.href" class="header-link">
          {{ item.label }}
        </NuxtLink>
      </nav>

      <div class="header-actions">
        <NuxtLink to="/sign-in" class="header-link">Sign in</NuxtLink>
        <NuxtLink to="/app" class="cta">Run a scenario</NuxtLink>
        <button
          type="button"
          class="drawer-toggle"
          aria-label="Open navigation menu"
          :aria-expanded="drawerOpen"
          @click="openDrawer"
        >
          <span aria-hidden="true">≡</span>
        </button>
      </div>
    </div>

    <Teleport to="body">
      <div
        v-if="drawerOpen"
        class="drawer-backdrop"
        role="presentation"
        @click="closeDrawer"
        @keydown="onDrawerKeydown"
      >
        <div
          class="drawer"
          role="dialog"
          aria-modal="true"
          aria-label="Navigation menu"
          tabindex="-1"
          @keydown.stop="onDrawerKeydown"
        >
          <button ref="closeBtn" type="button" class="drawer-close" data-drawer-close @click="closeDrawer">
            Close <span aria-hidden="true">×</span>
          </button>
          <nav aria-label="Mobile">
            <NuxtLink v-for="item in navItems" :key="item.href" :to="item.href" class="drawer-link" @click="closeDrawer">
              {{ item.label }}
            </NuxtLink>
            <NuxtLink to="/sign-in" class="drawer-link" @click="closeDrawer">Sign in</NuxtLink>
            <NuxtLink to="/app" class="drawer-link drawer-cta" @click="closeDrawer">Run a scenario</NuxtLink>
          </nav>
        </div>
      </div>
    </Teleport>
  </header>
</template>

<style scoped>
.site-header {
  position: fixed;
  inset: 0 0 auto 0;
  z-index: 40;
  transition: background-color 180ms ease-out, border-color 180ms ease-out;
  background: transparent;
  border-bottom: 1px solid transparent;
}
.site-header.is-scrolled {
  background: color-mix(in oklab, var(--ink-900) 92%, transparent);
  border-bottom-color: var(--color-border);
}
.header-inner {
  max-width: 1600px;
  margin: 0 auto;
  padding: var(--space-3) var(--space-8);
  display: flex;
  align-items: center;
  gap: var(--space-6);
}
.header-nav {
  display: flex;
  gap: var(--space-6);
  margin-inline-start: auto;
}
.header-link {
  color: var(--color-text-secondary);
  font-size: 0.92rem;
}
.header-link:hover {
  color: var(--color-text);
}
.header-actions {
  display: flex;
  align-items: center;
  gap: var(--space-4);
}
.cta {
  background: var(--color-action);
  color: var(--color-on-action);
  font-weight: 600;
  padding: var(--space-2) var(--space-4);
  border-radius: var(--radius-control);
}
.cta:hover {
  text-decoration: none;
  filter: brightness(1.08);
}
.drawer-toggle {
  display: none;
  background: none;
  border: 1px solid var(--color-border);
  color: var(--color-text);
  border-radius: var(--radius-control);
  font-size: 1.2rem;
  padding: var(--space-1) var(--space-3);
}
.drawer-backdrop {
  position: fixed;
  inset: 0;
  background: rgb(0 0 0 / 0.55);
  z-index: 60;
}
.drawer {
  margin-inline-start: auto;
  height: 100%;
  width: min(320px, 84vw);
  background: var(--color-bg-raised);
  border-inline-start: 1px solid var(--color-border);
  padding: var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}
.drawer-close {
  align-self: flex-end;
  background: none;
  border: 1px solid var(--color-border);
  color: var(--color-text);
  border-radius: var(--radius-control);
  padding: var(--space-1) var(--space-3);
}
.drawer nav {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}
.drawer-link {
  color: var(--color-text);
  font-size: 1.05rem;
}
.drawer-cta {
  color: var(--color-action);
  font-weight: 600;
}
@media (max-width: 900px) {
  .header-nav,
  .header-actions .header-link,
  .header-actions .cta {
    display: none;
  }
  .drawer-toggle {
    display: block;
  }
  .header-nav {
    margin-inline-start: 0;
  }
  .header-actions {
    margin-inline-start: auto;
  }
}
</style>
