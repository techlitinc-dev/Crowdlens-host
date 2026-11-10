"""Bounded kernel validation (WP-07): 100k logical population, 24+ ticks.

Runs the real hybrid kernel in-process with the mock action stream and
reports wall time and peak memory. This validates the kernel's columnar
efficiency claims locally; the full distributed 1M x 32-shard production
gate remains a separate load-environment exercise.
"""

from __future__ import annotations

import time
import tracemalloc

import numpy as np

from simulation_worker.kernel import (
    Population,
    apply_direct_actions,
    compute_aggregates,
    propagate_cohorts,
    select_active,
)

POPULATION = 100_000
TICKS = 24
ACTIVE_BUDGET = 64
RUN_SEED = 20261109


def main() -> None:
    started = time.perf_counter()
    tracemalloc.start()

    pop = Population.generate(size=POPULATION, run_seed=RUN_SEED, shard=0, shard_count=1)
    generated = time.perf_counter() - started

    # Mock provider: deterministic per-tick action list for the active set.
    rng = np.random.default_rng(RUN_SEED)
    events_total = 0
    tick_started = time.perf_counter()
    for tick in range(1, TICKS + 1):
        active = select_active(pop, budget=ACTIVE_BUDGET, run_seed=RUN_SEED, tick=tick)
        actions = [
            {"stance_delta": float(rng.uniform(-0.2, 0.3)), "memory_ref": f"mock/{tick}/{i}"}
            for i in range(len(active))
        ]
        events_total += len(apply_direct_actions(pop, active, actions, RUN_SEED, tick))
        events_total += len(propagate_cohorts(pop, active, RUN_SEED, tick))
        aggregate = compute_aggregates(pop, tick)
        assert aggregate, "aggregates must be produced every tick"
    tick_time = time.perf_counter() - tick_started
    _, peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()
    total = time.perf_counter() - started

    print(f"population={POPULATION} ticks={TICKS} active_budget={ACTIVE_BUDGET}")
    print(f"generate_s={generated:.3f}")
    print(f"simulate_s={tick_time:.3f}")
    print(f"total_s={total:.3f}")
    print(f"peak_python_heap_mb={peak / (1024 * 1024):.1f}")
    print(f"events_total={events_total}")
    print(f"per_tick_ms={(tick_time / TICKS) * 1000:.1f}")


if __name__ == "__main__":
    main()
