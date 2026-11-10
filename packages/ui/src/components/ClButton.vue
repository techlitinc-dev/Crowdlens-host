<script setup lang="ts">
import { computed } from "vue";

const props = withDefaults(
  defineProps<{
    variant?: "primary" | "secondary" | "ghost" | "danger";
    size?: "sm" | "md" | "lg";
    loading?: boolean;
    disabled?: boolean;
    type?: "button" | "submit";
  }>(),
  { variant: "primary", size: "md", type: "button" },
);

const emit = defineEmits<{ click: [MouseEvent] }>();

const classes = computed(() => [
  "cl-button",
  `cl-button--${props.variant}`,
  `cl-button--${props.size}`,
  { "cl-button--loading": props.loading },
]);

function onClick(event: MouseEvent): void {
  if (props.loading || props.disabled) return;
  emit("click", event);
}
</script>

<template>
  <button
    :class="classes"
    :type="type"
    :disabled="disabled || loading"
    :aria-busy="loading || undefined"
    @click="onClick"
  >
    <span v-if="loading" class="cl-button__spinner" aria-hidden="true" />
    <slot />
  </button>
</template>

<style scoped>
.cl-button {
  font-family: var(--font-body);
  font-weight: 550;
  border-radius: var(--radius-control);
  border: 1px solid transparent;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  min-height: 44px;
  transition: background-color 160ms ease-out, border-color 160ms ease-out, color 160ms ease-out;
}
.cl-button--sm { padding: 6px 12px; font-size: 13px; min-height: 32px; }
.cl-button--md { padding: 10px 20px; font-size: 15px; }
.cl-button--lg { padding: 14px 28px; font-size: 16px; }
.cl-button--primary { background: var(--color-action); color: var(--color-on-action); }
.cl-button--primary:hover:not(:disabled) { background: oklch(0.83 0.16 166.9); }
.cl-button--secondary {
  background: transparent;
  color: var(--color-text);
  border-color: var(--color-border);
}
.cl-button--secondary:hover:not(:disabled) { border-color: var(--color-action); }
.cl-button--ghost { background: transparent; color: var(--color-text-secondary); }
.cl-button--ghost:hover:not(:disabled) { color: var(--color-text); }
.cl-button--danger { background: transparent; color: var(--color-danger); border-color: var(--color-danger); }
.cl-button:disabled { opacity: 0.55; cursor: not-allowed; }
.cl-button:focus-visible { outline: 2px solid var(--color-focus); outline-offset: 2px; }
.cl-button__spinner {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 2px solid currentColor;
  border-top-color: transparent;
  animation: cl-spin 700ms linear infinite;
}
@keyframes cl-spin {
  to { transform: rotate(360deg); }
}
</style>
