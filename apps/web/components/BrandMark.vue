<script setup lang="ts">
withDefaults(defineProps<{ size?: number; label?: boolean }>(), { size: 28, label: true });
</script>

<template>
  <span class="brand" aria-label="CrowdLens">
    <svg
      :width="size"
      :height="size"
      viewBox="0 0 24 24"
      fill="none"
      role="img"
      aria-hidden="true"
      class="brand-mark"
    >
      <!-- Aperture: six unevenly spaced nodes, one breaking the ring (design.md §2.1). -->
      <g stroke="currentColor" stroke-width="1.4">
        <circle cx="12" cy="12" r="3.2" stroke-opacity="0.55" />
        <circle cx="12" cy="4.6" r="1.7" fill="currentColor" stroke="none" />
        <circle cx="19.2" cy="8.9" r="1.7" fill="currentColor" stroke="none" />
        <circle cx="17.3" cy="17.7" r="1.7" fill="currentColor" stroke="none" />
        <circle cx="6.9" cy="16.9" r="1.7" fill="currentColor" stroke="none" />
      </g>
      <circle cx="5.4" cy="7.6" r="2.4" fill="none" stroke="var(--color-action)" stroke-width="1.4" />
    </svg>
    <span v-if="label" class="brand-word">Crowd<span class="brand-lens">Lens</span></span>
  </span>
</template>

<style scoped>
.brand {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--color-text);
}
.brand-mark {
  color: var(--color-text);
  flex: none;
}
.brand-word {
  font-family: var(--font-display);
  font-weight: 600;
  letter-spacing: -0.02em;
  font-size: 1.05rem;
}
.brand-lens {
  color: var(--color-action);
}
</style>
