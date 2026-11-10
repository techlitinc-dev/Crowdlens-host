<script setup lang="ts">
/**
 * Section III — "Not a million chatbots" (design.md §3.6): credibility
 * section. A large population field with a bounded stream of illuminated
 * active agents, plus the three labelled layers.
 */
const activeCount = 23;
const illuminated = ref<number[]>([]);
let timer: ReturnType<typeof setInterval> | null = null;
const reduced = ref(false);

onMounted(() => {
  reduced.value = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduced.value) {
    illuminated.value = Array.from({ length: activeCount }, (_, i) => i);
    return;
  }
  timer = setInterval(() => {
    const next = new Set<number>();
    while (next.size < 12) next.add(Math.floor(Math.random() * 240));
    illuminated.value = [...next];
  }, 1200);
});

onBeforeUnmount(() => {
  if (timer) clearInterval(timer);
});

const layers = [
  {
    id: "LOGICAL STATE",
    text: "Lightweight logical agents model the full crowd — stances, exposure, fatigue — in a columnar kernel.",
  },
  {
    id: "ACTIVE REASONING",
    text: "A bounded, stratified subset reasons directly with Gemini or OpenRouter models. Billed per call, never per agent.",
  },
  {
    id: "COHORT PROPAGATION",
    text: "Cohort rules propagate the effects of each direct reasoning step to the surrounding population.",
  },
];
</script>

<template>
  <section class="section-frame not-chatbots" aria-labelledby="not-chatbots-heading">
    <p class="section-eyebrow">Section III</p>
    <h2 id="not-chatbots-heading" class="section-title">Not a million chatbots</h2>
    <blockquote class="credibility-copy">
      CrowdLens separates population scale from paid reasoning. Lightweight logical agents model
      the crowd. A bounded, stratified subset reasons directly with Gemini or OpenRouter models.
      Cohort rules propagate the effects, and every output says how it was produced.
    </blockquote>

    <div class="layers-grid">
      <div class="population-field surface" aria-label="Population field: 240 representative dots, 12 illuminated at a time">
        <span
          v-for="i in 240"
          :key="i"
          class="dot"
          :class="{ illuminated: illuminated.includes(i - 1), surrogate: !illuminated.includes(i - 1) }"
          aria-hidden="true"
        />
        <p class="mono-label field-caption">1,000,000 logical · 4,800 active reasoning — illustrative configuration</p>
      </div>
      <ol class="layer-list">
        <li v-for="layer in layers" :key="layer.id" class="surface layer">
          <p class="mono-label">{{ layer.id }}</p>
          <p>{{ layer.text }}</p>
        </li>
      </ol>
    </div>
    <p class="scale-note mono-label">
      Scale target: the million-agent production gate in specs.md is pending; pre-benchmark builds
      do not claim million-agent production readiness.
    </p>
  </section>
</template>

<style scoped>
.section-title {
  font-size: clamp(2.25rem, 4vw, 4.75rem);
  font-weight: 600;
  max-width: 16ch;
}
.credibility-copy {
  font-size: clamp(1.1rem, 1.6vw, 1.4rem);
  line-height: 1.5;
  max-width: 62ch;
  border-inline-start: 2px solid var(--color-action);
  padding-inline-start: var(--space-4);
  margin: 0 0 var(--space-8);
}
.layers-grid {
  display: grid;
  grid-template-columns: 1.4fr 1fr;
  gap: var(--space-6);
}
@media (max-width: 1024px) {
  .layers-grid {
    grid-template-columns: 1fr;
  }
}
.population-field {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-content: flex-start;
  padding: var(--space-6);
  min-height: 260px;
  position: relative;
}
.dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  transition: background-color 160ms ease-out, box-shadow 160ms ease-out;
}
.dot.surrogate {
  border: 1px solid rgba(244, 236, 216, 0.28);
  background: transparent;
}
.dot.illuminated {
  background: var(--color-action);
  box-shadow: 0 0 6px rgba(0, 217, 163, 0.55);
}
.field-caption {
  position: absolute;
  inset: auto var(--space-4) var(--space-3) var(--space-4);
}
.layer-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: var(--space-4);
}
.layer {
  padding: var(--space-4);
}
.layer p:last-child {
  margin: var(--space-2) 0 0;
}
.scale-note {
  margin-top: var(--space-6);
}
</style>
