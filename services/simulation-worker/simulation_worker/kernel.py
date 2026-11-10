"""Hybrid population kernel (architecture.md §9, WP-07).

Logical agents live in compact columnar state (NumPy arrays). Each tick:
  1. score activation candidates (influence, novelty, stance change, coverage, random)
  2. stratified selection of a bounded active subset
  3. direct structured LLM reasoning for the subset (batched)
  4. cohort/surrogate propagation with stochastic variation (deterministic PRNG)
  5. segment/shard aggregates + atomic checkpoint

A global tick is a bulk-synchronous barrier. PRNG streams are keyed by
(run seed, shard, tick, agent index) for reproducibility.
"""

from __future__ import annotations

import hashlib
import io
import json
from dataclasses import dataclass, field
from typing import Any

import numpy as np

SEGMENTS = np.array(["advocates", "skeptics", "pragmatists", "observers", "influencers"])
STANCE_MIN, STANCE_MAX = -1.0, 1.0


def stream_seed(run_seed: int, shard: int, tick: int, salt: str = "") -> int:
    digest = hashlib.sha256(f"{run_seed}:{shard}:{tick}:{salt}".encode()).digest()
    return int.from_bytes(digest[:4], "little")


def make_rng(run_seed: int, shard: int, tick: int, salt: str = "") -> np.random.Generator:
    return np.random.default_rng(stream_seed(run_seed, shard, tick, salt))


@dataclass
class Population:
    """Columnar logical-agent state (compact, shard-local)."""

    size: int
    segment: np.ndarray  # int8 index into SEGMENTS
    stance: np.ndarray  # float32 [-1, 1]
    activity: np.ndarray  # float32 [0, 1]
    influence: np.ndarray  # float32 [0, 1]
    fatigue: np.ndarray  # float32 [0, 1]
    cohort: np.ndarray  # int32 cohort id
    last_direct_tick: np.ndarray  # int32 (-1 = never)
    memory_refs: list[str] = field(default_factory=list)  # compact refs; text only for active agents
    shard: int = 0

    @classmethod
    def generate(cls, size: int, run_seed: int, shard: int, shard_count: int) -> Population:
        rng = make_rng(run_seed, shard, 0, "population")
        segment = rng.integers(0, len(SEGMENTS), size=size).astype(np.int8)
        stance = rng.uniform(-0.25, 0.35, size=size).astype(np.float32)
        activity = rng.uniform(0.05, 0.4, size=size).astype(np.float32)
        influence = np.clip(rng.beta(2, 5, size=size), 0, 1).astype(np.float32)
        # Community/cohort structure: shard-local communities of ~50-400 agents.
        cohort = np.repeat(np.arange(max(1, size // 150)), 150)[:size].astype(np.int32)
        if size % 150:
            cohort = np.concatenate([cohort, np.full(size - len(cohort), cohort.max() + 1)]).astype(np.int32)
        return cls(
            size=size,
            segment=segment,
            stance=stance,
            activity=activity,
            influence=influence,
            fatigue=np.zeros(size, dtype=np.float32),
            cohort=cohort,
            last_direct_tick=np.full(size, -1, dtype=np.int32),
            memory_refs=[""] * size,
            shard=shard,
        )

    # ---------- columnar persistence ----------

    def to_bytes(self) -> bytes:
        header = json.dumps({"size": self.size, "shard": self.shard, "memory_refs": self.memory_refs}).encode()
        buffer = io.BytesIO()
        np.savez(
            buffer,
            segment=self.segment,
            stance=self.stance,
            activity=self.activity,
            influence=self.influence,
            fatigue=self.fatigue,
            cohort=self.cohort,
            last_direct_tick=self.last_direct_tick,
        )
        payload = buffer.getvalue()
        return len(header).to_bytes(4, "little") + header + payload

    @classmethod
    def from_bytes(cls, body: bytes) -> Population:
        header_len = int.from_bytes(body[:4], "little")
        header = json.loads(body[4 : 4 + header_len].decode())
        data = np.load(io_bytes(body[4 + header_len :]), allow_pickle=False)
        return cls(
            size=header["size"],
            segment=data["segment"],
            stance=data["stance"],
            activity=data["activity"],
            influence=data["influence"],
            fatigue=data["fatigue"],
            cohort=data["cohort"],
            last_direct_tick=data["last_direct_tick"],
            memory_refs=header["memory_refs"],
            shard=header["shard"],
        )


def io_bytes(body: bytes) -> Any:
    return io.BytesIO(body)


@dataclass
class TickResult:
    tick: int
    active_indices: np.ndarray
    direct_actions: list[dict[str, Any]]
    aggregates: dict[str, dict[str, float]]
    events: list[dict[str, Any]]
    stance_delta_mean: float


def select_active(pop: Population, budget: int, run_seed: int, tick: int) -> np.ndarray:
    """Stratified active-agent selection (architecture.md §9.4)."""
    if budget >= pop.size:
        return np.arange(pop.size)
    rng = make_rng(run_seed, pop.shard, tick, "selection")
    # Score: influence, inverse fatigue, activity, novelty (long since direct),
    # plus stratified coverage across segments so extreme voices don't dominate.
    since_direct = tick - pop.last_direct_tick.astype(np.float32)
    novelty = np.where(pop.last_direct_tick < 0, 2.0, np.minimum(since_direct / 8.0, 2.0))
    score = 0.45 * pop.influence + 0.2 * pop.activity + 0.2 * novelty + 0.15 * (1 - pop.fatigue)
    score += rng.uniform(0, 0.15, size=pop.size)  # random stratified sampling

    chosen: list[np.ndarray] = []
    per_segment = max(1, budget // len(SEGMENTS))
    for seg_idx in range(len(SEGMENTS)):
        members = np.where(pop.segment == seg_idx)[0]
        if members.size == 0:
            continue
        seg_scores = score[members]
        take = min(per_segment, members.size)
        top = members[np.argsort(-seg_scores)[:take]]
        chosen.append(top)
    selected = np.unique(np.concatenate(chosen)) if chosen else np.array([], dtype=np.int64)
    if selected.size > budget:
        rng.shuffle(selected)
        selected = selected[:budget]
    return selected


def apply_direct_actions(
    pop: Population,
    active: np.ndarray,
    actions: list[dict[str, Any]],
    run_seed: int,
    tick: int,
) -> list[dict[str, Any]]:
    """Apply structured LLM actions to active agents and record events."""
    events: list[dict[str, Any]] = []
    for offset, index in enumerate(active.tolist()):
        action = actions[offset] if offset < len(actions) else {}
        stance_shift = float(action.get("stance_shift", 0.0))
        message = str(action.get("message", ""))[:280]
        pop.stance[index] = np.clip(pop.stance[index] + stance_shift, STANCE_MIN, STANCE_MAX)
        pop.activity[index] = np.clip(pop.activity[index] + abs(stance_shift) * 0.6, 0, 1)
        pop.fatigue[index] = np.clip(pop.fatigue[index] + 0.08, 0, 1)
        pop.last_direct_tick[index] = tick
        if message:
            pop.memory_refs[index] = f"shard/{pop.shard}/tick/{tick}/agent/{index}"
        events.append(
            {
                "agent": int(index),
                "segment": str(SEGMENTS[pop.segment[index]]),
                "type": "direct_action",
                "stance_shift": stance_shift,
                "provenance": "llm_generated",
                "tick": tick,
                "message": message,
            }
        )
    return events


def propagate_cohorts(pop: Population, active: np.ndarray, run_seed: int, tick: int) -> list[dict[str, Any]]:
    """Cohort/surrogate propagation for non-active agents (§9.3 step 5)."""
    events: list[dict[str, Any]] = []
    rng = make_rng(run_seed, pop.shard, tick, "cohorts")
    active_set = set(active.tolist())
    if not active_set:
        return events
    # Aggregate active stance shifts per cohort → propagate with stochastic variation.
    cohort_shift: dict[int, float] = {}
    for index in active:
        cohort_shift[int(pop.cohort[index])] = cohort_shift.get(int(pop.cohort[index]), 0.0) + float(pop.stance[index]) / max(1, len(active))
    surrogate_indices = np.where(np.isin(np.arange(pop.size), list(active_set), invert=True))[0]
    if surrogate_indices.size == 0:
        return events
    noise = rng.normal(0, 0.03, size=surrogate_indices.size).astype(np.float32)
    base = np.array([cohort_shift.get(int(pop.cohort[i]), 0.0) for i in surrogate_indices], dtype=np.float32)
    adoption = 0.35  # cohort adoption factor
    pop.stance[surrogate_indices] = np.clip(
        pop.stance[surrogate_indices] + adoption * base + noise, STANCE_MIN, STANCE_MAX
    )
    pop.activity[surrogate_indices] = np.clip(pop.activity[surrogate_indices] * 0.995, 0, 1)
    pop.fatigue[surrogate_indices] = np.clip(pop.fatigue[surrogate_indices] - 0.01, 0, 1)
    if surrogate_indices.size > 0:
        events.append(
            {
                "type": "cohort_propagation",
                "provenance": "surrogate_inferred",
                "tick": tick,
                "agents": int(surrogate_indices.size),
                "mean_shift": float(adoption * np.mean(base)) if base.size else 0.0,
            }
        )
    return events


def compute_aggregates(pop: Population, tick: int) -> dict[str, dict[str, float]]:
    """Per-segment aggregates for this shard (coarse, browser-safe)."""
    aggregates: dict[str, dict[str, float]] = {}
    for seg_idx, name in enumerate(SEGMENTS):
        members = np.where(pop.segment == seg_idx)[0]
        if members.size == 0:
            continue
        aggregates[name] = {
            "agents": int(members.size),
            "stance_mean": round(float(np.mean(pop.stance[members])), 4),
            "support_share": round(float(np.mean(pop.stance[members] > 0.1)), 4),
            "opposition_share": round(float(np.mean(pop.stance[members] < -0.1)), 4),
            "activity_mean": round(float(np.mean(pop.activity[members])), 4),
            "direct_agents": int(np.count_nonzero(pop.last_direct_tick[members] == tick)),
        }
    return aggregates
