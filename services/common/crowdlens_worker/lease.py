"""Durable work-queue claiming with leases, heartbeats, and bounded retries."""

from __future__ import annotations

import os
import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from .db import WorkerDb

OWNER_ID = f"{os.path.basename(os.getcwd())}-{uuid.uuid4().hex[:8]}"


@dataclass
class WorkClaim:
    id: int
    workspace_id: str
    kind: str
    ref_id: str
    payload: dict[str, Any]
    attempt: int


def claim_one(db: WorkerDb, kinds: list[str], lease_seconds: int = 300) -> WorkClaim | None:
    with db.owner_tx() as conn:
        row = conn.execute(
            """UPDATE work_items
               SET status = 'leased', lease_owner = %s,
                   lease_expires = now() + (%s || ' seconds')::interval,
                   attempt = attempt + 1, heartbeat_at = now(), updated_at = now()
               WHERE id = (
                 SELECT id FROM work_items
                 WHERE (status = 'queued' OR (status = 'leased' AND lease_expires < now()))
                   AND kind = ANY(%s)
                 ORDER BY id
                 FOR UPDATE SKIP LOCKED
                 LIMIT 1
               )
               RETURNING id, workspace_id, kind, ref_id, payload, attempt""",
            (OWNER_ID, str(lease_seconds), kinds),
        ).fetchone()
        if not row:
            return None
        return WorkClaim(
            id=row["id"],
            workspace_id=row["workspace_id"],
            kind=row["kind"],
            ref_id=row["ref_id"],
            payload=dict(row["payload"]),
            attempt=row["attempt"],
        )


def heartbeat(db: WorkerDb, claim: WorkClaim) -> bool:
    with db.owner_tx() as conn:
        return (
            conn.execute(
                "UPDATE work_items SET heartbeat_at = now() WHERE id = %s AND lease_owner = %s AND status = 'leased'",
                (claim.id, OWNER_ID),
            ).rowcount
            == 1
        )


def complete(db: WorkerDb, claim: WorkClaim) -> None:
    with db.owner_tx() as conn:
        conn.execute(
            "UPDATE work_items SET status = 'done', lease_owner = NULL, updated_at = now() WHERE id = %s AND lease_owner = %s",
            (claim.id, OWNER_ID),
        )


def fail(db: WorkerDb, claim: WorkClaim, error: str) -> None:
    with db.owner_tx() as conn:
        conn.execute(
            """UPDATE work_items
               SET status = CASE WHEN attempt >= max_attempts THEN 'failed' ELSE 'queued' END,
                   lease_owner = NULL, last_error = %s, updated_at = now()
               WHERE id = %s AND lease_owner = %s
               RETURNING status""",
            (error[:2000], claim.id, OWNER_ID),
        )


def enqueue(
    db: WorkerDb,
    workspace_id: str,
    kind: str,
    ref_id: str,
    payload: dict[str, Any],
    dedupe_key: str | None = None,
) -> None:
    """Enqueue a work item from a worker (idempotent by dedupe key)."""
    key = dedupe_key or f"{kind}:{ref_id}"
    with db.owner_tx() as conn:
        conn.execute(
            """INSERT INTO work_items (workspace_id, kind, ref_id, payload)
               VALUES (%s, %s, %s, %s)
               ON CONFLICT DO NOTHING""",
            (workspace_id, kind, ref_id, json_dumps({**payload, "dedupe_key": key})),
        )


def json_dumps(value: dict[str, Any]) -> str:
    import json

    return json.dumps(value)


def claim_loop(
    db: WorkerDb,
    kinds: list[str],
    handler: Callable[[WorkClaim], None],
    *,
    idle_sleep: float = 2.0,
    once: bool = False,
) -> None:
    """Poll-claim loop. `once=True` processes a single item (used in tests)."""
    for attempt in range(30):
        try:
            db.connect()
            break
        except Exception as error:  # noqa: BLE001 - server may still be starting
            print(f"[worker] waiting for database ({error})", flush=True)
            time.sleep(2)
    else:
        raise RuntimeError("database never became available")
    try:
        while True:
            try:
                claim = claim_one(db, kinds)
            except Exception as error:  # noqa: BLE001 - server may have restarted
                print(f"[worker] claim failed ({error}); reconnecting", flush=True)
                try:
                    db.reconnect()
                except Exception as reconnect_error:  # noqa: BLE001
                    print(f"[worker] reconnect failed: {reconnect_error}", flush=True)
                time.sleep(3)
                continue
            if claim is None:
                if once:
                    return
                time.sleep(idle_sleep)
                continue
            try:
                handler(claim)
                complete(db, claim)
            except Exception as error:  # noqa: BLE001 - durable retry records the error
                try:
                    fail(db, claim, str(error))
                except Exception:  # noqa: BLE001
                    db.reconnect()
    finally:
        db.close()
