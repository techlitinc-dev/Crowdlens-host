"""Hybrid population kernel invariants (architecture.md §7, §12.11 test 6/9).

Run on the real kernel: determinism per (run_seed, shard, tick, salt), shard
independence, checkpoint round-trips, and tick-stream independence (a retried
tick must select the same active set — idempotency under worker retry).
"""

from __future__ import annotations

import numpy as np

from simulation_worker.kernel import (
    SEGMENTS,
    Population,
    make_rng,
    select_active,
    stream_seed,
)


def test_stream_seed_depends_on_every_component() -> None:
    base = stream_seed(42, 3, 10, "actions")
    assert stream_seed(43, 3, 10, "actions") != base  # run seed
    assert stream_seed(42, 4, 10, "actions") != base  # shard
    assert stream_seed(42, 3, 11, "actions") != base  # tick
    assert stream_seed(42, 3, 10, "other") != base  # salt
    assert stream_seed(42, 3, 10, "actions") == base  # deterministic


def test_population_generation_is_deterministic_per_shard() -> None:
    a = Population.generate(size=2000, run_seed=7, shard=0, shard_count=1)
    b = Population.generate(size=2000, run_seed=7, shard=0, shard_count=1)
    assert np.array_equal(a.segment, b.segment)
    assert np.allclose(a.stance, b.stance)
    assert np.array_equal(a.cohort, b.cohort)

    other_shard = Population.generate(size=2000, run_seed=7, shard=1, shard_count=2)
    assert not np.array_equal(a.segment, other_shard.segment)


def test_checkpoint_round_trip_preserves_state() -> None:
    pop = Population.generate(size=500, run_seed=11, shard=0, shard_count=1)
    pop.stance[0] = 0.99
    restored = Population.from_bytes(pop.to_bytes())
    assert restored.size == pop.size
    assert restored.shard == pop.shard
    for field in ("segment", "stance", "activity", "influence", "fatigue", "cohort", "last_direct_tick"):
        assert np.allclose(getattr(restored, field), getattr(pop, field)), field
    assert restored.memory_refs == pop.memory_refs


def test_select_active_is_stratified_bounded_and_repeatable() -> None:
    pop = Population.generate(size=10_000, run_seed=5, shard=0, shard_count=1)
    first = select_active(pop, budget=64, run_seed=5, tick=3)
    retry = select_active(pop, budget=64, run_seed=5, tick=3)
    # Stratified allocation: floor(budget/segments) per segment, de-duplicated,
    # never exceeding the budget.
    expected = (64 // len(SEGMENTS)) * len(SEGMENTS)
    assert len(first) == expected
    assert len(first) <= 64
    assert np.array_equal(np.sort(first), np.sort(retry))  # retry picks the same set

    next_tick = select_active(pop, budget=64, run_seed=5, tick=4)
    assert not np.array_equal(np.sort(first), np.sort(next_tick))  # streams differ per tick

    # Stratification: every segment is represented in the active set.
    represented = set(pop.segment[first].tolist())
    assert len(represented) == len(SEGMENTS)


def test_make_rng_streams_do_not_collide_across_salts() -> None:
    draws = []
    for salt in ("actions", "propagation", "memory"):
        rng = make_rng(99, 0, 1, salt)
        draws.append(rng.random(8))
    for i in range(len(draws)):
        for j in range(i + 1, len(draws)):
            assert not np.allclose(draws[i], draws[j])
