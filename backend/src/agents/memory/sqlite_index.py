"""SQLite-backed ledger/vector/graph index for OpenViking-only memory runtime."""

from __future__ import annotations

import hashlib
import json
import math
import re
import sqlite3
import threading
from collections import deque
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Iterator


def _utc_iso() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def _scope_key(agent_name: str | None) -> str:
    return f"agent:{agent_name.lower()}" if agent_name else "global"


def _as_node_id(entity: str) -> str:
    normalized = entity.strip().lower()
    return hashlib.sha1(normalized.encode("utf-8")).hexdigest()[:16]


def _extract_entities(text: str, limit: int = 10) -> list[str]:
    tokens = re.findall(r"[A-Za-z][A-Za-z0-9_\-/+.]{2,}|[\u4e00-\u9fff]{2,}", text)
    out: list[str] = []
    for token in tokens:
        if token not in out:
            out.append(token)
        if len(out) >= limit:
            break
    return out


def _cosine_similarity(vec_a: list[float], vec_b: list[float]) -> float:
    if not vec_a or not vec_b or len(vec_a) != len(vec_b):
        return 0.0
    dot = 0.0
    norm_a = 0.0
    norm_b = 0.0
    for av, bv in zip(vec_a, vec_b, strict=False):
        dot += av * bv
        norm_a += av * av
        norm_b += bv * bv
    if norm_a <= 0.0 or norm_b <= 0.0:
        return 0.0
    return dot / (math.sqrt(norm_a) * math.sqrt(norm_b))


class OpenVikingSQLiteIndex:
    """Utility for maintaining OpenViking local ledger + retrieval metadata."""

    def __init__(self, db_path: Path):
        self._db_path = db_path
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        self._guard = threading.Lock()
        self._ensure_schema()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self._db_path)
        conn.row_factory = sqlite3.Row
        return conn

    @contextmanager
    def transaction(self) -> Iterator[sqlite3.Connection]:
        """Open a guarded transaction for multi-step local updates."""
        with self._guard:
            conn = self._connect()
            try:
                yield conn
                conn.commit()
            except Exception:
                conn.rollback()
                raise
            finally:
                conn.close()

    def _ensure_schema(self) -> None:
        with self._guard, self._connect() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS memory_resources (
                    scope TEXT NOT NULL,
                    memory_id TEXT NOT NULL,
                    uri TEXT NOT NULL,
                    summary TEXT NOT NULL,
                    source_thread_id TEXT,
                    score REAL NOT NULL DEFAULT 0.0,
                    status TEXT NOT NULL DEFAULT 'active',
                    use_count INTEGER NOT NULL DEFAULT 0,
                    last_used_at TEXT,
                    metadata_json TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY (scope, memory_id)
                );
                CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_resources_scope_uri
                    ON memory_resources(scope, uri);
                CREATE INDEX IF NOT EXISTS idx_memory_resources_scope_status
                    ON memory_resources(scope, status);
                CREATE INDEX IF NOT EXISTS idx_memory_resources_scope_updated
                    ON memory_resources(scope, updated_at DESC);

                CREATE TABLE IF NOT EXISTS memory_manifest (
                    scope TEXT NOT NULL,
                    memory_id TEXT NOT NULL,
                    content TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'active',
                    source_thread_id TEXT,
                    metadata_json TEXT,
                    last_action TEXT NOT NULL DEFAULT 'ADD',
                    revision INTEGER NOT NULL DEFAULT 1,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY (scope, memory_id)
                );
                CREATE INDEX IF NOT EXISTS idx_memory_manifest_scope_status
                    ON memory_manifest(scope, status);
                CREATE INDEX IF NOT EXISTS idx_memory_manifest_scope_updated
                    ON memory_manifest(scope, updated_at DESC);

                CREATE TABLE IF NOT EXISTS memory_action_log (
                    scope TEXT NOT NULL,
                    action_id TEXT NOT NULL,
                    trace_id TEXT,
                    chat_id TEXT,
                    memory_id TEXT NOT NULL,
                    action TEXT NOT NULL,
                    reason TEXT,
                    before_content TEXT,
                    after_content TEXT,
                    evidence_json TEXT,
                    created_at TEXT NOT NULL,
                    PRIMARY KEY (scope, action_id)
                );
                CREATE INDEX IF NOT EXISTS idx_memory_action_log_scope_created
                    ON memory_action_log(scope, created_at DESC);
                CREATE INDEX IF NOT EXISTS idx_memory_action_log_scope_trace
                    ON memory_action_log(scope, trace_id, created_at DESC);
                CREATE INDEX IF NOT EXISTS idx_memory_action_log_scope_chat
                    ON memory_action_log(scope, chat_id, created_at DESC);

                CREATE TABLE IF NOT EXISTS governance_queue (
                    scope TEXT NOT NULL,
                    decision_id TEXT NOT NULL,
                    memory_id TEXT,
                    action TEXT NOT NULL,
                    status TEXT NOT NULL,
                    reason TEXT,
                    candidate_json TEXT,
                    created_at TEXT NOT NULL,
                    decided_at TEXT,
                    decided_by TEXT,
                    PRIMARY KEY (scope, decision_id)
                );
                CREATE INDEX IF NOT EXISTS idx_governance_queue_scope_status
                    ON governance_queue(scope, status);

                CREATE TABLE IF NOT EXISTS governance_state (
                    scope TEXT NOT NULL PRIMARY KEY,
                    last_run_at TEXT
                );

                CREATE TABLE IF NOT EXISTS agent_catalog (
                    agent_name TEXT NOT NULL PRIMARY KEY,
                    role TEXT NOT NULL,
                    capability_summary TEXT NOT NULL,
                    persona_summary TEXT NOT NULL,
                    style_hint TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS vector_memory (
                    scope TEXT NOT NULL,
                    memory_id TEXT NOT NULL,
                    thread_id TEXT,
                    content TEXT NOT NULL,
                    vector_json TEXT NOT NULL,
                    metadata_json TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY (scope, memory_id)
                );
                CREATE INDEX IF NOT EXISTS idx_vector_memory_scope ON vector_memory(scope);

                CREATE TABLE IF NOT EXISTS nodes (
                    scope TEXT NOT NULL,
                    node_id TEXT NOT NULL,
                    label TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY (scope, node_id)
                );
                CREATE INDEX IF NOT EXISTS idx_nodes_scope_label ON nodes(scope, label);

                CREATE TABLE IF NOT EXISTS edges (
                    scope TEXT NOT NULL,
                    source_node_id TEXT NOT NULL,
                    target_node_id TEXT NOT NULL,
                    edge_type TEXT NOT NULL,
                    weight REAL NOT NULL DEFAULT 1.0,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY (scope, source_node_id, target_node_id, edge_type)
                );
                CREATE INDEX IF NOT EXISTS idx_edges_scope_source ON edges(scope, source_node_id);
                CREATE INDEX IF NOT EXISTS idx_edges_scope_target ON edges(scope, target_node_id);

                CREATE TABLE IF NOT EXISTS memory_links (
                    scope TEXT NOT NULL,
                    node_id TEXT NOT NULL,
                    memory_id TEXT NOT NULL,
                    relevance REAL NOT NULL DEFAULT 1.0,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY (scope, node_id, memory_id)
                );
                CREATE INDEX IF NOT EXISTS idx_memory_links_scope_node ON memory_links(scope, node_id);
                """
            )
            conn.commit()

    # ------------------------------------------------------------------
    # Resource ledger
    # ------------------------------------------------------------------
    def upsert_resource(
        self,
        *,
        agent_name: str | None,
        memory_id: str,
        uri: str,
        summary: str,
        source_thread_id: str | None = None,
        score: float = 0.0,
        status: str = "active",
        metadata: dict[str, Any] | None = None,
        bump_usage: bool = False,
        conn: sqlite3.Connection | None = None,
    ) -> None:
        scope = _scope_key(agent_name)
        now = _utc_iso()
        normalized_status = (status or "active").strip().lower() or "active"
        payload = json.dumps(metadata or {}, ensure_ascii=False)
        use_increment = 1 if bump_usage else 0
        last_used = now if bump_usage else None

        def _execute(target_conn: sqlite3.Connection) -> None:
            target_conn.execute(
                """
                INSERT INTO memory_resources(
                    scope, memory_id, uri, summary, source_thread_id, score, status,
                    use_count, last_used_at, metadata_json, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(scope, memory_id) DO UPDATE SET
                    uri=excluded.uri,
                    summary=excluded.summary,
                    source_thread_id=COALESCE(excluded.source_thread_id, memory_resources.source_thread_id),
                    score=excluded.score,
                    status=excluded.status,
                    metadata_json=excluded.metadata_json,
                    updated_at=excluded.updated_at,
                    last_used_at=COALESCE(excluded.last_used_at, memory_resources.last_used_at),
                    use_count=(memory_resources.use_count + ?)
                """,
                (
                    scope,
                    memory_id,
                    uri,
                    summary,
                    source_thread_id,
                    float(score),
                    normalized_status,
                    use_increment,
                    last_used,
                    payload,
                    now,
                    now,
                    use_increment,
                ),
            )

        if conn is not None:
            _execute(conn)
            return
        with self._guard, self._connect() as inner:
            _execute(inner)
            inner.commit()

    def list_resources(self, *, agent_name: str | None = None, status: str | None = None) -> list[dict[str, Any]]:
        scope = _scope_key(agent_name)
        with self._connect() as conn:
            if status:
                rows = conn.execute(
                    """
                    SELECT scope, memory_id, uri, summary, source_thread_id, score, status,
                           use_count, last_used_at, metadata_json, created_at, updated_at
                    FROM memory_resources
                    WHERE scope = ? AND status = ?
                    ORDER BY COALESCE(last_used_at, updated_at) DESC, use_count DESC, updated_at DESC
                    """,
                    (scope, status.strip().lower()),
                ).fetchall()
            else:
                rows = conn.execute(
                    """
                    SELECT scope, memory_id, uri, summary, source_thread_id, score, status,
                           use_count, last_used_at, metadata_json, created_at, updated_at
                    FROM memory_resources
                    WHERE scope = ?
                    ORDER BY COALESCE(last_used_at, updated_at) DESC, use_count DESC, updated_at DESC
                    """,
                    (scope,),
                ).fetchall()

        output: list[dict[str, Any]] = []
        for row in rows:
            metadata_json = str(row["metadata_json"] or "{}")
            try:
                metadata = json.loads(metadata_json)
            except Exception:  # noqa: BLE001
                metadata = {}
            output.append(
                {
                    "scope": str(row["scope"]),
                    "memory_id": str(row["memory_id"]),
                    "uri": str(row["uri"]),
                    "summary": str(row["summary"]),
                    "source_thread_id": str(row["source_thread_id"] or ""),
                    "score": float(row["score"] or 0.0),
                    "status": str(row["status"] or "active"),
                    "use_count": int(row["use_count"] or 0),
                    "last_used_at": str(row["last_used_at"] or ""),
                    "created_at": str(row["created_at"] or ""),
                    "updated_at": str(row["updated_at"] or ""),
                    "metadata": metadata if isinstance(metadata, dict) else {},
                }
            )
        return output

    def get_resource(self, *, agent_name: str | None = None, memory_id: str) -> dict[str, Any] | None:
        scope = _scope_key(agent_name)
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT scope, memory_id, uri, summary, source_thread_id, score, status,
                       use_count, last_used_at, metadata_json, created_at, updated_at
                FROM memory_resources
                WHERE scope = ? AND memory_id = ?
                """,
                (scope, memory_id),
            ).fetchone()
        if row is None:
            return None
        metadata_json = str(row["metadata_json"] or "{}")
        try:
            metadata = json.loads(metadata_json)
        except Exception:  # noqa: BLE001
            metadata = {}
        return {
            "scope": str(row["scope"]),
            "memory_id": str(row["memory_id"]),
            "uri": str(row["uri"]),
            "summary": str(row["summary"]),
            "source_thread_id": str(row["source_thread_id"] or ""),
            "score": float(row["score"] or 0.0),
            "status": str(row["status"] or "active"),
            "use_count": int(row["use_count"] or 0),
            "last_used_at": str(row["last_used_at"] or ""),
            "created_at": str(row["created_at"] or ""),
            "updated_at": str(row["updated_at"] or ""),
            "metadata": metadata if isinstance(metadata, dict) else {},
        }

    def delete_resource(
        self,
        *,
        agent_name: str | None,
        memory_id: str,
        conn: sqlite3.Connection | None = None,
    ) -> int:
        scope = _scope_key(agent_name)

        def _execute(target_conn: sqlite3.Connection) -> int:
            cur = target_conn.execute(
                "DELETE FROM memory_resources WHERE scope = ? AND memory_id = ?",
                (scope, memory_id),
            )
            target_conn.execute(
                "DELETE FROM vector_memory WHERE scope = ? AND memory_id = ?",
                (scope, memory_id),
            )
            target_conn.execute(
                "DELETE FROM memory_links WHERE scope = ? AND memory_id = ?",
                (scope, memory_id),
            )
            return int(cur.rowcount or 0)

        if conn is not None:
            return _execute(conn)
        with self._guard, self._connect() as inner:
            deleted = _execute(inner)
            inner.commit()
            return deleted

    def set_resource_status(
        self,
        *,
        agent_name: str | None,
        memory_id: str,
        status: str,
        conn: sqlite3.Connection | None = None,
    ) -> int:
        scope = _scope_key(agent_name)
        now = _utc_iso()

        def _execute(target_conn: sqlite3.Connection) -> int:
            cur = target_conn.execute(
                """
                UPDATE memory_resources
                SET status = ?, updated_at = ?
                WHERE scope = ? AND memory_id = ?
                """,
                (status.strip().lower(), now, scope, memory_id),
            )
            return int(cur.rowcount or 0)

        if conn is not None:
            return _execute(conn)
        with self._guard, self._connect() as inner:
            updated = _execute(inner)
            inner.commit()
            return updated

    def count_resources(self, *, agent_name: str | None = None, status: str | None = None) -> int:
        scope = _scope_key(agent_name)
        with self._connect() as conn:
            if status:
                row = conn.execute(
                    "SELECT COUNT(*) AS cnt FROM memory_resources WHERE scope = ? AND status = ?",
                    (scope, status.strip().lower()),
                ).fetchone()
            else:
                row = conn.execute(
                    "SELECT COUNT(*) AS cnt FROM memory_resources WHERE scope = ?",
                    (scope,),
                ).fetchone()
        return int(row["cnt"] if row else 0)

    # ------------------------------------------------------------------
    # Manifest + action log (source of truth)
    # ------------------------------------------------------------------
    def upsert_manifest_entry(
        self,
        *,
        agent_name: str | None,
        memory_id: str,
        content: str,
        status: str = "active",
        source_thread_id: str | None = None,
        metadata: dict[str, Any] | None = None,
        last_action: str = "ADD",
        conn: sqlite3.Connection | None = None,
    ) -> None:
        scope = _scope_key(agent_name)
        now = _utc_iso()
        normalized_status = (status or "active").strip().lower() or "active"
        metadata_json = json.dumps(metadata or {}, ensure_ascii=False)

        def _execute(target_conn: sqlite3.Connection) -> None:
            target_conn.execute(
                """
                INSERT INTO memory_manifest(
                    scope, memory_id, content, status, source_thread_id, metadata_json,
                    last_action, revision, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(scope, memory_id) DO UPDATE SET
                    content=excluded.content,
                    status=excluded.status,
                    source_thread_id=COALESCE(excluded.source_thread_id, memory_manifest.source_thread_id),
                    metadata_json=excluded.metadata_json,
                    last_action=excluded.last_action,
                    revision=(memory_manifest.revision + 1),
                    updated_at=excluded.updated_at
                """,
                (
                    scope,
                    memory_id,
                    content,
                    normalized_status,
                    source_thread_id,
                    metadata_json,
                    last_action.strip().upper() or "ADD",
                    1,
                    now,
                    now,
                ),
            )

        if conn is not None:
            _execute(conn)
            return
        with self._guard, self._connect() as inner:
            _execute(inner)
            inner.commit()

    def get_manifest_entry(self, *, agent_name: str | None, memory_id: str) -> dict[str, Any] | None:
        scope = _scope_key(agent_name)
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT scope, memory_id, content, status, source_thread_id, metadata_json,
                       last_action, revision, created_at, updated_at
                FROM memory_manifest
                WHERE scope = ? AND memory_id = ?
                """,
                (scope, memory_id),
            ).fetchone()
        if row is None:
            return None
        try:
            metadata = json.loads(str(row["metadata_json"] or "{}"))
        except Exception:  # noqa: BLE001
            metadata = {}
        return {
            "scope": str(row["scope"]),
            "memory_id": str(row["memory_id"]),
            "content": str(row["content"] or ""),
            "status": str(row["status"] or "active"),
            "source_thread_id": str(row["source_thread_id"] or ""),
            "metadata": metadata if isinstance(metadata, dict) else {},
            "last_action": str(row["last_action"] or "ADD"),
            "revision": int(row["revision"] or 1),
            "created_at": str(row["created_at"] or ""),
            "updated_at": str(row["updated_at"] or ""),
        }

    def list_manifest_entries(
        self,
        *,
        agent_name: str | None = None,
        status: str | None = "active",
    ) -> list[dict[str, Any]]:
        scope = _scope_key(agent_name)
        with self._connect() as conn:
            if status is None:
                rows = conn.execute(
                    """
                    SELECT scope, memory_id, content, status, source_thread_id, metadata_json,
                           last_action, revision, created_at, updated_at
                    FROM memory_manifest
                    WHERE scope = ?
                    ORDER BY updated_at DESC
                    """,
                    (scope,),
                ).fetchall()
            else:
                rows = conn.execute(
                    """
                    SELECT scope, memory_id, content, status, source_thread_id, metadata_json,
                           last_action, revision, created_at, updated_at
                    FROM memory_manifest
                    WHERE scope = ? AND status = ?
                    ORDER BY updated_at DESC
                    """,
                    (scope, status.strip().lower()),
                ).fetchall()

        output: list[dict[str, Any]] = []
        for row in rows:
            try:
                metadata = json.loads(str(row["metadata_json"] or "{}"))
            except Exception:  # noqa: BLE001
                metadata = {}
            output.append(
                {
                    "scope": str(row["scope"]),
                    "memory_id": str(row["memory_id"]),
                    "content": str(row["content"] or ""),
                    "status": str(row["status"] or "active"),
                    "source_thread_id": str(row["source_thread_id"] or ""),
                    "metadata": metadata if isinstance(metadata, dict) else {},
                    "last_action": str(row["last_action"] or "ADD"),
                    "revision": int(row["revision"] or 1),
                    "created_at": str(row["created_at"] or ""),
                    "updated_at": str(row["updated_at"] or ""),
                }
            )
        return output

    def append_action_log(
        self,
        *,
        agent_name: str | None,
        action_id: str,
        memory_id: str,
        action: str,
        trace_id: str | None = None,
        chat_id: str | None = None,
        reason: str | None = None,
        before_content: str | None = None,
        after_content: str | None = None,
        evidence: dict[str, Any] | None = None,
        conn: sqlite3.Connection | None = None,
    ) -> None:
        scope = _scope_key(agent_name)
        now = _utc_iso()
        evidence_json = json.dumps(evidence or {}, ensure_ascii=False)

        def _execute(target_conn: sqlite3.Connection) -> None:
            target_conn.execute(
                """
                INSERT OR REPLACE INTO memory_action_log(
                    scope, action_id, trace_id, chat_id, memory_id, action, reason,
                    before_content, after_content, evidence_json, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    scope,
                    action_id,
                    trace_id,
                    chat_id,
                    memory_id,
                    action.strip().upper(),
                    reason,
                    before_content,
                    after_content,
                    evidence_json,
                    now,
                ),
            )

        if conn is not None:
            _execute(conn)
            return
        with self._guard, self._connect() as inner:
            _execute(inner)
            inner.commit()

    def list_action_logs(
        self,
        *,
        agent_name: str | None = None,
        trace_id: str | None = None,
        chat_id: str | None = None,
        limit: int = 100,
    ) -> list[dict[str, Any]]:
        scope = _scope_key(agent_name)
        query = """
            SELECT scope, action_id, trace_id, chat_id, memory_id, action, reason,
                   before_content, after_content, evidence_json, created_at
            FROM memory_action_log
            WHERE scope = ?
        """
        params: list[Any] = [scope]
        if trace_id:
            query += " AND trace_id = ?"
            params.append(trace_id)
        if chat_id:
            query += " AND chat_id = ?"
            params.append(chat_id)
        query += " ORDER BY created_at DESC LIMIT ?"
        params.append(max(1, int(limit)))

        with self._connect() as conn:
            rows = conn.execute(query, tuple(params)).fetchall()

        output: list[dict[str, Any]] = []
        for row in rows:
            try:
                evidence = json.loads(str(row["evidence_json"] or "{}"))
            except Exception:  # noqa: BLE001
                evidence = {}
            output.append(
                {
                    "scope": str(row["scope"]),
                    "action_id": str(row["action_id"]),
                    "trace_id": str(row["trace_id"] or ""),
                    "chat_id": str(row["chat_id"] or ""),
                    "memory_id": str(row["memory_id"]),
                    "action": str(row["action"] or ""),
                    "reason": str(row["reason"] or ""),
                    "before_content": str(row["before_content"] or ""),
                    "after_content": str(row["after_content"] or ""),
                    "evidence": evidence if isinstance(evidence, dict) else {},
                    "created_at": str(row["created_at"] or ""),
                }
            )
        return output

    def get_manifest_revision(self, *, agent_name: str | None = None) -> int:
        scope = _scope_key(agent_name)
        with self._connect() as conn:
            row = conn.execute(
                "SELECT MAX(revision) AS rev FROM memory_manifest WHERE scope = ?",
                (scope,),
            ).fetchone()
        if row is None or row["rev"] is None:
            return 0
        return int(row["rev"])

    def clear_scope_derived_indexes(self, *, agent_name: str | None = None) -> None:
        scope = _scope_key(agent_name)
        with self._guard, self._connect() as conn:
            conn.execute("DELETE FROM memory_resources WHERE scope = ?", (scope,))
            conn.execute("DELETE FROM vector_memory WHERE scope = ?", (scope,))
            conn.execute("DELETE FROM nodes WHERE scope = ?", (scope,))
            conn.execute("DELETE FROM edges WHERE scope = ?", (scope,))
            conn.execute("DELETE FROM memory_links WHERE scope = ?", (scope,))
            conn.commit()

    # ------------------------------------------------------------------
    # Governance ledger
    # ------------------------------------------------------------------
    def get_governance_status(self, *, agent_name: str | None = None) -> dict[str, Any]:
        scope = _scope_key(agent_name)
        with self._connect() as conn:
            pending_row = conn.execute(
                "SELECT COUNT(*) AS cnt FROM memory_resources WHERE scope = ? AND status = 'pending'",
                (scope,),
            ).fetchone()
            contested_row = conn.execute(
                "SELECT COUNT(*) AS cnt FROM memory_resources WHERE scope = ? AND status = 'contested'",
                (scope,),
            ).fetchone()
            state_row = conn.execute(
                "SELECT last_run_at FROM governance_state WHERE scope = ?",
                (scope,),
            ).fetchone()
            queue_rows = conn.execute(
                """
                SELECT decision_id, memory_id, action, status, reason, candidate_json, created_at, decided_at, decided_by
                FROM governance_queue
                WHERE scope = ?
                ORDER BY created_at DESC
                LIMIT 50
                """,
                (scope,),
            ).fetchall()

        queue: list[dict[str, Any]] = []
        for row in queue_rows:
            candidate_json = str(row["candidate_json"] or "{}")
            try:
                candidate = json.loads(candidate_json)
            except Exception:  # noqa: BLE001
                candidate = {}
            queue.append(
                {
                    "decision_id": str(row["decision_id"]),
                    "memory_id": str(row["memory_id"] or ""),
                    "action": str(row["action"] or ""),
                    "status": str(row["status"] or ""),
                    "reason": str(row["reason"] or ""),
                    "candidate": candidate if isinstance(candidate, dict) else {},
                    "created_at": str(row["created_at"] or ""),
                    "decided_at": str(row["decided_at"] or ""),
                    "decided_by": str(row["decided_by"] or ""),
                }
            )

        return {
            "pending_count": int(pending_row["cnt"] if pending_row else 0),
            "contested_count": int(contested_row["cnt"] if contested_row else 0),
            "last_run_at": str(state_row["last_run_at"] or "") if state_row else "",
            "queue": queue,
        }

    def record_governance_decision(
        self,
        *,
        agent_name: str | None,
        decision_id: str,
        memory_id: str | None,
        action: str,
        status: str,
        reason: str,
        candidate: dict[str, Any] | None = None,
        decided_by: str | None = None,
        decided_at: str | None = None,
        conn: sqlite3.Connection | None = None,
    ) -> None:
        scope = _scope_key(agent_name)
        now = _utc_iso()
        payload = json.dumps(candidate or {}, ensure_ascii=False)

        def _execute(target_conn: sqlite3.Connection) -> None:
            target_conn.execute(
                """
                INSERT INTO governance_queue(
                    scope, decision_id, memory_id, action, status, reason,
                    candidate_json, created_at, decided_at, decided_by
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(scope, decision_id) DO UPDATE SET
                    memory_id=excluded.memory_id,
                    action=excluded.action,
                    status=excluded.status,
                    reason=excluded.reason,
                    candidate_json=excluded.candidate_json,
                    decided_at=excluded.decided_at,
                    decided_by=excluded.decided_by
                """,
                (
                    scope,
                    decision_id,
                    memory_id,
                    action,
                    status,
                    reason,
                    payload,
                    now,
                    decided_at,
                    decided_by,
                ),
            )

        if conn is not None:
            _execute(conn)
            return
        with self._guard, self._connect() as inner:
            _execute(inner)
            inner.commit()

    def set_governance_last_run(self, *, agent_name: str | None = None, last_run_at: str | None = None) -> None:
        scope = _scope_key(agent_name)
        ts = (last_run_at or _utc_iso()).strip()
        with self._guard, self._connect() as conn:
            conn.execute(
                """
                INSERT INTO governance_state(scope, last_run_at)
                VALUES (?, ?)
                ON CONFLICT(scope) DO UPDATE SET last_run_at = excluded.last_run_at
                """,
                (scope, ts),
            )
            conn.commit()

    # ------------------------------------------------------------------
    # Agent catalog
    # ------------------------------------------------------------------
    def replace_agent_catalog(self, cards: list[dict[str, Any]]) -> None:
        with self._guard, self._connect() as conn:
            conn.execute("DELETE FROM agent_catalog")
            for card in cards:
                conn.execute(
                    """
                    INSERT INTO agent_catalog(agent_name, role, capability_summary, persona_summary, style_hint, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (
                        str(card.get("agent_name") or "").strip(),
                        str(card.get("role") or "custom_agent"),
                        str(card.get("capability_summary") or ""),
                        str(card.get("persona_summary") or ""),
                        str(card.get("style_hint") or ""),
                        str(card.get("updated_at") or ""),
                    ),
                )
            conn.commit()

    def list_agent_catalog(self) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT agent_name, role, capability_summary, persona_summary, style_hint, updated_at
                FROM agent_catalog
                ORDER BY agent_name ASC
                """
            ).fetchall()
        return [
            {
                "agent_name": str(row["agent_name"] or ""),
                "role": str(row["role"] or "custom_agent"),
                "capability_summary": str(row["capability_summary"] or ""),
                "persona_summary": str(row["persona_summary"] or ""),
                "style_hint": str(row["style_hint"] or ""),
                "updated_at": str(row["updated_at"] or ""),
            }
            for row in rows
        ]

    # ------------------------------------------------------------------
    # Vector index
    # ------------------------------------------------------------------
    def upsert_vector(
        self,
        *,
        agent_name: str | None,
        memory_id: str,
        thread_id: str | None,
        content: str,
        vector: list[float],
        metadata: dict[str, Any] | None = None,
    ) -> None:
        scope = _scope_key(agent_name)
        now = _utc_iso()
        payload = json.dumps(vector, ensure_ascii=False)
        metadata_json = json.dumps(metadata or {}, ensure_ascii=False)
        with self._guard, self._connect() as conn:
            conn.execute(
                """
                INSERT INTO vector_memory(scope, memory_id, thread_id, content, vector_json, metadata_json, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(scope, memory_id) DO UPDATE SET
                    thread_id=excluded.thread_id,
                    content=excluded.content,
                    vector_json=excluded.vector_json,
                    metadata_json=excluded.metadata_json,
                    updated_at=excluded.updated_at
                """,
                (scope, memory_id, thread_id, content, payload, metadata_json, now, now),
            )
            conn.commit()

    def clear_vectors(self, *, agent_name: str | None = None) -> int:
        scope = _scope_key(agent_name)
        with self._guard, self._connect() as conn:
            cur = conn.execute("DELETE FROM vector_memory WHERE scope = ?", (scope,))
            deleted = int(cur.rowcount or 0)
            conn.commit()
            return deleted

    def clear_graph(self, *, agent_name: str | None = None) -> None:
        scope = _scope_key(agent_name)
        with self._guard, self._connect() as conn:
            conn.execute("DELETE FROM nodes WHERE scope = ?", (scope,))
            conn.execute("DELETE FROM edges WHERE scope = ?", (scope,))
            conn.execute("DELETE FROM memory_links WHERE scope = ?", (scope,))
            conn.commit()

    def vector_count(self, *, agent_name: str | None = None) -> int:
        scope = _scope_key(agent_name)
        with self._connect() as conn:
            row = conn.execute(
                "SELECT COUNT(*) AS cnt FROM vector_memory WHERE scope = ?",
                (scope,),
            ).fetchone()
        return int(row["cnt"] if row else 0)

    def search_vectors(
        self,
        *,
        agent_name: str | None,
        query_vector: list[float],
        limit: int,
    ) -> list[dict[str, Any]]:
        scope = _scope_key(agent_name)
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT memory_id, thread_id, content, vector_json, metadata_json
                FROM vector_memory
                WHERE scope = ?
                """,
                (scope,),
            ).fetchall()

        scored: list[dict[str, Any]] = []
        for row in rows:
            try:
                vector = json.loads(str(row["vector_json"]))
            except Exception:  # noqa: BLE001
                continue
            if not isinstance(vector, list):
                continue
            parsed = [float(item) for item in vector]
            score = _cosine_similarity(query_vector, parsed)
            scored.append(
                {
                    "memory_id": str(row["memory_id"]),
                    "thread_id": str(row["thread_id"] or ""),
                    "content": str(row["content"] or ""),
                    "score": score,
                    "metadata_json": str(row["metadata_json"] or "{}"),
                }
            )

        scored.sort(key=lambda item: item["score"], reverse=True)
        return scored[: max(1, limit)]

    # ------------------------------------------------------------------
    # Graph index
    # ------------------------------------------------------------------
    def upsert_graph_from_text(
        self,
        *,
        agent_name: str | None,
        memory_id: str,
        text: str,
    ) -> None:
        entities = _extract_entities(text)
        if not entities:
            return
        scope = _scope_key(agent_name)
        now = _utc_iso()
        node_pairs = [(entity, _as_node_id(entity)) for entity in entities]

        with self._guard, self._connect() as conn:
            for entity, node_id in node_pairs:
                conn.execute(
                    """
                    INSERT INTO nodes(scope, node_id, label, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?)
                    ON CONFLICT(scope, node_id) DO UPDATE SET
                        label=excluded.label,
                        updated_at=excluded.updated_at
                    """,
                    (scope, node_id, entity, now, now),
                )
                conn.execute(
                    """
                    INSERT INTO memory_links(scope, node_id, memory_id, relevance, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                    ON CONFLICT(scope, node_id, memory_id) DO UPDATE SET
                        relevance=excluded.relevance,
                        updated_at=excluded.updated_at
                    """,
                    (scope, node_id, memory_id, 1.0, now, now),
                )

            for index, (_, src_node) in enumerate(node_pairs):
                for _, dst_node in node_pairs[index + 1 :]:
                    left, right = sorted((src_node, dst_node))
                    conn.execute(
                        """
                        INSERT INTO edges(scope, source_node_id, target_node_id, edge_type, weight, created_at, updated_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?)
                        ON CONFLICT(scope, source_node_id, target_node_id, edge_type) DO UPDATE SET
                            weight=edges.weight + 1.0,
                            updated_at=excluded.updated_at
                        """,
                        (scope, left, right, "co_occurs", 1.0, now, now),
                    )
            conn.commit()

    def graph_stats(self, *, agent_name: str | None = None) -> dict[str, int]:
        scope = _scope_key(agent_name)
        with self._connect() as conn:
            node_row = conn.execute(
                "SELECT COUNT(*) AS cnt FROM nodes WHERE scope = ?",
                (scope,),
            ).fetchone()
            edge_row = conn.execute(
                "SELECT COUNT(*) AS cnt FROM edges WHERE scope = ?",
                (scope,),
            ).fetchone()
            link_row = conn.execute(
                "SELECT COUNT(*) AS cnt FROM memory_links WHERE scope = ?",
                (scope,),
            ).fetchone()
        return {
            "nodes": int(node_row["cnt"] if node_row else 0),
            "edges": int(edge_row["cnt"] if edge_row else 0),
            "memory_links": int(link_row["cnt"] if link_row else 0),
        }

    def query_graph(
        self,
        *,
        mode: str,
        agent_name: str | None,
        entity: str | None = None,
        start_entity: str | None = None,
        end_entity: str | None = None,
        depth: int = 2,
        limit: int = 20,
    ) -> dict[str, Any]:
        normalized_mode = (mode or "").strip().lower()
        if normalized_mode == "neighbors":
            if not entity:
                raise ValueError("entity is required for neighbors query")
            rows = self._query_neighbors(agent_name=agent_name, entity=entity, limit=limit)
            return {"mode": "neighbors", "entity": entity, "total": len(rows), "results": rows}
        if normalized_mode == "path":
            if not start_entity or not end_entity:
                raise ValueError("start_entity and end_entity are required for path query")
            path = self._query_path(
                agent_name=agent_name,
                start_entity=start_entity,
                end_entity=end_entity,
                depth=depth,
            )
            return {
                "mode": "path",
                "start_entity": start_entity,
                "end_entity": end_entity,
                "path": path,
                "found": bool(path),
            }
        if normalized_mode == "memories":
            if not entity:
                raise ValueError("entity is required for memories query")
            rows = self._query_memories(agent_name=agent_name, entity=entity, limit=limit)
            return {"mode": "memories", "entity": entity, "total": len(rows), "results": rows}
        raise ValueError(f"Unsupported graph query mode: {mode}")

    def _query_neighbors(self, *, agent_name: str | None, entity: str, limit: int) -> list[dict[str, Any]]:
        scope = _scope_key(agent_name)
        node_id = _as_node_id(entity)
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT n.label AS label, e.weight AS weight
                FROM edges e
                JOIN nodes n
                  ON n.scope = e.scope
                 AND (n.node_id = e.source_node_id OR n.node_id = e.target_node_id)
                WHERE e.scope = ?
                  AND (e.source_node_id = ? OR e.target_node_id = ?)
                  AND n.node_id != ?
                ORDER BY e.weight DESC, n.label ASC
                LIMIT ?
                """,
                (scope, node_id, node_id, node_id, max(1, limit)),
            ).fetchall()
        return [{"label": str(row["label"]), "weight": float(row["weight"] or 0.0)} for row in rows]

    def _query_path(
        self,
        *,
        agent_name: str | None,
        start_entity: str,
        end_entity: str,
        depth: int,
    ) -> list[str]:
        scope = _scope_key(agent_name)
        start_id = _as_node_id(start_entity)
        end_id = _as_node_id(end_entity)
        max_depth = max(1, min(6, int(depth)))

        adjacency: dict[str, set[str]] = {}
        labels: dict[str, str] = {}
        with self._connect() as conn:
            node_rows = conn.execute(
                "SELECT node_id, label FROM nodes WHERE scope = ?",
                (scope,),
            ).fetchall()
            edge_rows = conn.execute(
                "SELECT source_node_id, target_node_id FROM edges WHERE scope = ?",
                (scope,),
            ).fetchall()
        for row in node_rows:
            labels[str(row["node_id"])] = str(row["label"])
        for row in edge_rows:
            left = str(row["source_node_id"])
            right = str(row["target_node_id"])
            adjacency.setdefault(left, set()).add(right)
            adjacency.setdefault(right, set()).add(left)

        if start_id not in adjacency or end_id not in adjacency:
            return []

        queue: deque[tuple[str, list[str]]] = deque([(start_id, [start_id])])
        visited = {start_id}
        while queue:
            current, path = queue.popleft()
            if current == end_id:
                return [labels.get(node, node) for node in path]
            if len(path) > max_depth + 1:
                continue
            for nxt in adjacency.get(current, set()):
                if nxt in visited:
                    continue
                visited.add(nxt)
                queue.append((nxt, [*path, nxt]))
        return []

    def _query_memories(self, *, agent_name: str | None, entity: str, limit: int) -> list[dict[str, Any]]:
        scope = _scope_key(agent_name)
        node_id = _as_node_id(entity)
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT mr.memory_id, mr.uri, mr.summary, mr.score, mr.status,
                       mr.source_thread_id, mr.use_count, mr.last_used_at
                FROM memory_links ml
                JOIN memory_resources mr
                  ON mr.scope = ml.scope
                 AND mr.memory_id = ml.memory_id
                WHERE ml.scope = ?
                  AND ml.node_id = ?
                ORDER BY ml.relevance DESC, mr.updated_at DESC
                LIMIT ?
                """,
                (scope, node_id, max(1, limit)),
            ).fetchall()
        return [
            {
                "memory_id": str(row["memory_id"]),
                "uri": str(row["uri"] or ""),
                "summary": str(row["summary"] or ""),
                "score": float(row["score"] or 0.0),
                "status": str(row["status"] or "active"),
                "source_thread_id": str(row["source_thread_id"] or ""),
                "use_count": int(row["use_count"] or 0),
                "last_used_at": str(row["last_used_at"] or ""),
            }
            for row in rows
        ]
