<script setup lang="ts">
withDefaults(defineProps<{ inset?: boolean }>(), { inset: false });
</script>

<template>
  <section class="cl-panel" :class="{ 'cl-panel--inset': inset }">
    <header v-if="$slots.title" class="cl-panel__title">
      <slot name="title" />
    </header>
    <slot />
  </section>
</template>

<style scoped>
.cl-panel {
  background: var(--color-bg-raised);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-panel);
  padding: var(--space-6);
}
.cl-panel--inset {
  background: var(--color-bg-inset);
}
.cl-panel__title {
  font-family: var(--font-mono);
  font-size: 12px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-text-secondary);
  margin-bottom: var(--space-4);
}
</style>
