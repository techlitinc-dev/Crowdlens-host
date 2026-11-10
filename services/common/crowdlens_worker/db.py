"""PostgreSQL access for workers with tenant-scoped RLS transactions."""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

import psycopg
from psycopg.rows import dict_row


def _safe_rollback(conn: psycopg.Connection) -> None:
    try:
        conn.execute("ROLLBACK")
    except Exception:  # noqa: BLE001, S110 - the connection may already be closed
        pass


class WorkerDb:
    def __init__(self, app_database_url: str, owner_database_url: str) -> None:
        self._app_url = app_database_url
        self._owner_url = owner_database_url
        self._app: psycopg.Connection | None = None
        self._owner: psycopg.Connection | None = None

    def connect(self) -> None:
        self._app = psycopg.connect(self._app_url, row_factory=dict_row, autocommit=False)
        self._owner = psycopg.connect(self._owner_url, row_factory=dict_row, autocommit=False)

    def reconnect(self) -> None:
        """Re-establish connections after a server restart (embedded PG cycles)."""
        try:
            if self._app:
                self._app.close()
            if self._owner:
                self._owner.close()
        except Exception:  # noqa: BLE001, S110 - closing a dead connection
            pass
        self.connect()

    def close(self) -> None:
        if self._app:
            self._app.close()
        if self._owner:
            self._owner.close()

    @contextmanager
    def tenant_tx(self, workspace_id: str) -> Iterator[psycopg.Connection]:
        """Transaction with the RLS tenant context pinned (fail-closed)."""
        assert self._app is not None, "connect() first"
        conn = self._app
        try:
            conn.execute("BEGIN")
            conn.execute("SELECT set_config('app.workspace_id', %s::text, true)", (str(workspace_id),))
            yield conn
            conn.execute("COMMIT")
        except Exception:
            _safe_rollback(conn)
            raise

    @contextmanager
    def owner_tx(self) -> Iterator[psycopg.Connection]:
        assert self._owner is not None, "connect() first"
        conn = self._owner
        try:
            conn.execute("BEGIN")
            yield conn
            conn.execute("COMMIT")
        except Exception:
            _safe_rollback(conn)
            raise

    def fetchone(self, sql: str, params: tuple[Any, ...] = ()) -> dict[str, Any] | None:
        with self.owner_tx() as conn:
            row = conn.execute(sql, params).fetchone()
            return dict(row) if row else None

    def fetchall(self, sql: str, params: tuple[Any, ...] = ()) -> list[dict[str, Any]]:
        with self.owner_tx() as conn:
            return [dict(r) for r in conn.execute(sql, params).fetchall()]
