<script setup lang="ts">
import { computed } from "vue";

/**
 * Provenance/status chip. Colour never carries meaning alone (design.md §2.2):
 * always paired with a text label; `tone` changes shape border treatment.
 */
const props = withDefaults(
  defineProps<{ tone?: "source" | "llm" | "aggregate" | "surrogate" | "neutral" | "risk" }>(),
  { tone: "neutral" },
);

const classes = computed(() => ["cl-chip", `cl-chip--${props.tone}`]);
</script>

<template>
  <span :class="classes"><slot /></span>
</template>

<style scoped>
.cl-chip {
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  padding: 3px 8px;
  border-radius: var(--radius-control);
  border: 1px solid var(--color-border);
  color: var(--color-text-secondary);
  white-space: nowrap;
}
.cl-chip--source { border-color: var(--sage-400); color: var(--sage-400); border-style: solid; }
.cl-chip--llm { border-color: var(--color-action); color: var(--color-action); }
.cl-chip--aggregate { border-color: var(--color-grid-guide); color: var(--paper-100); border-style: dashed; }
.cl-chip--surrogate { border-color: var(--slate-400); color: var(--slate-400); border-style: dotted; }
.cl-chip--risk { border-color: var(--color-danger); color: var(--color-danger); }
</style>
