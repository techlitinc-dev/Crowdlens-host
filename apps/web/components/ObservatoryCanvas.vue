<script setup lang="ts">
/**
 * Canvas network renderer for the hero observatory (design.md §3.3, §4).
 * - Representative nodes only (≤ ~1200 desktop / ~400 mobile); each node is a
 *   cohort member, never one DOM/canvas node per logical agent.
 * - Direct-LLM agents: solid mint rings. Surrogate cohorts: outlined marks.
 * - Reduced motion: renders the final coherent layout once, no drift.
 * - Canvas failure/unavailable: the parent shows a static SVG poster + DOM
 *   summary instead (canvas-unavailable state).
 */
import type { ObservatoryFixture, ObservatorySegment } from "~/types/observatory";

const props = defineProps<{
  fixture: ObservatoryFixture;
  tick: number;
  selectedSegment: string | null;
  reducedMotion: boolean;
}>();

const emit = defineEmits<{ (e: "select", segmentId: string): void }>();

const canvasEl = ref<HTMLCanvasElement | null>(null);
const canvasFailed = ref(false);
const hoverSegment = ref<string | null>(null);

interface Node {
  x: number;
  y: number;
  vx: number;
  vy: number;
  segment: ObservatorySegment;
  active: boolean;
  ring: number;
}

let nodes: Node[] = [];
let raf = 0;
let width = 0;
let height = 0;
let ctx: CanvasRenderingContext2D | null = null;
let resizeObserver: ResizeObserver | null = null;

function targetPosition(node: Node, t: number, w: number, h: number): { x: number; y: number } {
  // Five communities arranged on a loose ring; centres drift subtly with tick.
  const segments = props.fixture.scenario.segments;
  const index = segments.findIndex((s) => s.id === node.segment.id);
  const angle = (index / segments.length) * Math.PI * 2 + t * 0.012;
  const radius = Math.min(w, h) * (0.26 + (index % 2) * 0.07);
  const cx = w / 2 + Math.cos(angle) * radius;
  const cy = h / 2 + Math.sin(angle) * radius * 0.72;
  const jitter = 26 + (node.ring % 5) * 9;
  return {
    x: cx + Math.cos(node.ring * 2.399 + index) * jitter,
    y: cy + Math.sin(node.ring * 2.399 + index) * jitter,
  };
}

function buildNodes(maxNodes: number) {
  const segments = props.fixture.scenario.segments;
  const total = segments.reduce((sum, s) => sum + s.nodes, 0);
  nodes = [];
  for (const segment of segments) {
    const count = Math.max(6, Math.round((segment.nodes / total) * maxNodes));
    const activeCount = Math.round(count * segment.active_share);
    for (let i = 0; i < count; i++) {
      nodes.push({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: 0,
        vy: 0,
        segment,
        active: i < activeCount,
        ring: i,
      });
    }
  }
}

function nodeBudget(): number {
  const mobile = typeof window !== "undefined" && window.innerWidth < 720;
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  const base = mobile ? 400 : 1200;
  return dpr > 2 ? Math.round(base * 0.7) : base;
}

function setup() {
  const canvas = canvasEl.value;
  if (!canvas) return;
  ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) {
    canvasFailed.value = true;
    return;
  }
  const rect = canvas.getBoundingClientRect();
  width = rect.width;
  height = rect.height;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  buildNodes(nodeBudget());
  if (props.reducedMotion) {
    // Reduced motion: jump straight to the final coherent layout.
    for (const node of nodes) {
      const target = targetPosition(node, props.tick, width, height);
      node.x = target.x;
      node.y = target.y;
    }
    draw();
  }
}

function draw() {
  if (!ctx) return;
  ctx.clearRect(0, 0, width, height);
  // Community guides.
  ctx.strokeStyle = "rgba(133, 192, 147, 0.12)";
  ctx.lineWidth = 1;
  const segments = props.fixture.scenario.segments;
  segments.forEach((segment, index) => {
    const angle = (index / segments.length) * Math.PI * 2 + props.tick * 0.012;
    const radius = Math.min(width, height) * (0.26 + (index % 2) * 0.07);
    ctx!.beginPath();
    ctx!.arc(width / 2 + Math.cos(angle) * radius, height / 2 + Math.sin(angle) * radius * 0.72, 34, 0, Math.PI * 2);
    ctx!.stroke();
  });
  // Edges within communities (sampled for perf).
  ctx.lineWidth = 0.6;
  for (let i = 0; i < nodes.length; i += 3) {
    const a = nodes[i]!;
    const b = nodes[(i + 7) % nodes.length]!;
    if (a.segment.id !== b.segment.id) continue;
    ctx.strokeStyle = "rgba(244, 236, 216, 0.05)";
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  const highlighted = hoverSegment.value ?? props.selectedSegment;
  for (const node of nodes) {
    const dimmed = highlighted !== null && node.segment.id !== highlighted;
    const r = node.active ? 3.1 : 2.2;
    ctx.beginPath();
    ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
    if (node.active) {
      ctx.fillStyle = dimmed ? "rgba(0, 217, 163, 0.25)" : "rgba(0, 217, 163, 0.9)";
      ctx.fill();
    } else {
      ctx.strokeStyle = dimmed ? "rgba(244, 236, 216, 0.12)" : "rgba(244, 236, 216, 0.45)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
}

function step() {
  for (const node of nodes) {
    const target = targetPosition(node, props.tick, width, height);
    node.vx += (target.x - node.x) * 0.012;
    node.vy += (target.y - node.y) * 0.012;
    node.vx *= 0.9;
    node.vy *= 0.9;
    node.x += node.vx;
    node.y += node.vy;
  }
  draw();
  raf = requestAnimationFrame(step);
}

function onPointerMove(event: PointerEvent) {
  const canvas = canvasEl.value;
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  let best: Node | null = null;
  let bestDist = 28 * 28;
  for (const node of nodes) {
    const dx = node.x - x;
    const dy = node.y - y;
    const d = dx * dx + dy * dy;
    if (d < bestDist) {
      bestDist = d;
      best = node;
    }
  }
  hoverSegment.value = best?.segment.id ?? null;
}

function onClick() {
  if (hoverSegment.value) emit("select", hoverSegment.value);
}

let visibilityObserver: IntersectionObserver | null = null;
let pageVisible = true;

onMounted(() => {
  try {
    setup();
  } catch {
    canvasFailed.value = true;
    return;
  }
  if (canvasFailed.value) return;
  if (!props.reducedMotion) raf = requestAnimationFrame(step);
  resizeObserver = new ResizeObserver(() => {
    if (props.reducedMotion) setup();
  });
  if (canvasEl.value) resizeObserver.observe(canvasEl.value);
  // Pause rendering offscreen / hidden tab (design.md §4.2).
  visibilityObserver = new IntersectionObserver(([entry]) => {
    if (props.reducedMotion) return;
    if (entry?.isIntersecting && pageVisible && !raf) {
      raf = requestAnimationFrame(step);
    } else if (!entry?.isIntersecting && raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  });
  if (canvasEl.value) visibilityObserver.observe(canvasEl.value);
  const onVisibility = () => {
    pageVisible = document.visibilityState === "visible";
    if (!pageVisible && raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    } else if (pageVisible && !raf && !props.reducedMotion) {
      raf = requestAnimationFrame(step);
    }
  };
  document.addEventListener("visibilitychange", onVisibility);
  onBeforeUnmount(() => document.removeEventListener("visibilitychange", onVisibility));
});

onBeforeUnmount(() => {
  if (raf) cancelAnimationFrame(raf);
  resizeObserver?.disconnect();
  visibilityObserver?.disconnect();
});

watch(() => props.tick, () => {
  if (props.reducedMotion) {
    for (const node of nodes) {
      const target = targetPosition(node, props.tick, width, height);
      node.x = target.x;
      node.y = target.y;
    }
    draw();
  }
});

watch(() => props.selectedSegment, draw);
watch(() => hoverSegment.value, draw);

defineExpose({ canvasFailed });
</script>

<template>
  <div class="canvas-wrap">
    <canvas
      v-if="!canvasFailed"
      ref="canvasEl"
      class="observatory-canvas"
      data-testid="observatory-canvas"
      role="img"
      :aria-label="`Synthetic population map with ${fixture.scenario.segments.length} audience communities; illustrative sample`"
      @pointermove="onPointerMove"
      @pointerleave="hoverSegment = null"
      @click="onClick"
    ></canvas>
    <slot v-if="canvasFailed" name="poster" />
  </div>
</template>

<style scoped>
.canvas-wrap {
  position: absolute;
  inset: 0;
}
.observatory-canvas {
  width: 100%;
  height: 100%;
  display: block;
  touch-action: manipulation;
}
</style>
