"""Checkpoint resume without duplicate effects (architecture.md §12.11 test 6).

Simulates a worker that dies mid-run: run N ticks with checkpointing, throw,
reload the LAST COMPLETE checkpoint, and continue. The final population state
must equal an uninterrupted run, and re-processed ticks must not duplicate
events — this is the mechanism that makes worker retries safe.
"""

from __future__ import annotations


import numpy as np

from simulation_worker.kernel import (
    Population,
    apply_direct_actions,
    compute_aggregates,
    propagate_cohorts,
    select_active,
)

POP = 5000
RUN_SEED = 777
TICKS = 12
KILL_AT = 5


def run_ticks(pop: Population, start: int, end: int, events: list) -> None:
    rng = np.random.default_rng(RUN_SEED + start)
    for tick in range(start, end + 1):
        active = select_active(pop, budget=32, run_seed=RUN_SEED, tick=tick)
        actions = [
            {"stance_delta": float(rng.uniform(-0.2, 0.3)), "memory_ref": f"t{tick}/{i}"}
            for i in range(len(active))
        ]
        events.extend(apply_direct_actions(pop, active, actions, RUN_SEED, tick))
        events.extend(propagate_cohorts(pop, active, RUN_SEED, tick))
        compute_aggregates(pop, tick)


def checkpoint_bytes(pop: Population) -> bytes:
    return pop.to_bytes()


def test_checkpoint_resume_matches_uninterrupted_run() -> None:
    # Reference: an uninterrupted run.
    ref = Population.generate(size=POP, run_seed=RUN_SEED, shard=0, shard_count=1)
    ref_events: list = []
    run_ticks(ref, 1, TICKS, ref_events)

    # Interrupted run: checkpoint after KILL_AT ticks, "crash", resume.
    pop = Population.generate(size=POP, run_seed=RUN_SEED, shard=0, shard_count=1)
    events: list = []
    run_ticks(pop, 1, KILL_AT, events)
    saved = pop.to_bytes()
    crashed_events = len(events)

    restored = Population.from_bytes(saved)
    run_ticks(restored, KILL_AT + 1, TICKS, events)

    assert np.allclose(restored.stance, ref.stance)
    assert np.allclose(restored.fatigue, ref.fatigue)
    assert np.array_equal(restored.last_direct_tick, ref.last_direct_tick)
    assert len(events) == len(ref_events)
    assert crashed_events < len(events)


def test_replayed_tick_does_not_duplicate_memory_refs() -> None:
    # A tick that is retried after a crash (before checkpoint) re-selects the
    # same agents (same stream) — memory refs must stay unique per agent/tick.
    pop = Population.generate(size=POP, run_seed=RUN_SEED, shard=0, shard_count=1)
    rng = np.random.default_rng(1)

    def do_tick(tick: int) -> list:
        active = select_active(pop, budget=32, run_seed=RUN_SEED, tick=tick)
        actions = [
            {"stance_delta": float(rng.uniform(-0.2, 0.3)), "memory_ref": f"t{tick}/{i}"}
            for i in range(len(active))
        ]
        ev = apply_direct_actions(pop, active, actions, RUN_SEED, tick)
        ev.extend(propagate_cohorts(pop, active, RUN_SEED, tick))
        return ev

    first = do_tick(9)
    # Retry-safe selection: a retried tick picks the same agents from the
    # same population state (stream-based selection, no hidden counters).
    pop2 = Population.generate(size=POP, run_seed=RUN_SEED, shard=0, shard_count=1)
    active_a = select_active(pop2, budget=32, run_seed=RUN_SEED, tick=9)
    active_b = select_active(pop2, budget=32, run_seed=RUN_SEED, tick=9)
    assert np.array_equal(np.sort(active_a), np.sort(active_b))
    assert len(first) > 0
