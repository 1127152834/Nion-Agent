"""OpenViking-only runtime.

This runtime keeps the online memory stack single-provider (OpenViking) and uses
local SQLite tables only as query/index/governance ledger.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import threading
import time
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from src.agents.memory.core import MemoryReadRequest, MemoryWriteRequest
from src.agents.memory.sqlite_index import OpenVikingSQLiteIndex
from src.config.app_config import get_app_config
from src.config.memory_config import get_memory_config
from src.config.paths import get_paths

logger = logging.getLogger(__name__)


def _utc_iso() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def _normalize_role(raw_role: str | None) -> str:
    role = (raw_role or "").strip().lower()
    if role in {"human", "user"}:
        return "user"
    if role in {"ai", "assistant"}:
        return "assistant"
    if role == "system":
        return "system"
    return "assistant"


def _extract_text_fragments(content: Any) -> list[str]:
    if isinstance(content, str):
        text = content.strip()
        return [text] if text else []

    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            parts.extend(_extract_text_fragments(item))
        return parts

    if isinstance(content, dict):
        parts: list[str] = []
        for key in ("text", "content", "value", "output_text"):
            if key in content:
                parts.extend(_extract_text_fragments(content.get(key)))
        return parts

    return []


def _tokenize(text: str) -> set[str]:
    return set(token for token in re.findall(r"[A-Za-z0-9\u4e00-\u9fff]+", text.lower()) if token)


def _is_ambiguous_query(query: str) -> bool:
    normalized = query.strip().lower()
    if not normalized:
        return False
    tokens = _tokenize(normalized)
    if len(tokens) <= 2:
        return True
    if any(keyword in normalized for keyword in ("这个", "那个", "它", "他", "她", "it", "that", "this")):
        return True
    return len(normalized) <= 8


class OpenVikingRuntime:
    """OpenViking runtime with local ledger/index support."""

    def __init__(self):
        self._paths = get_paths()
        self._sqlite_index = OpenVikingSQLiteIndex(self._paths.openviking_index_db)
        self._scope_locks: dict[str, threading.Lock] = {}
        self._scope_locks_guard = threading.Lock()
        self._embedding_model_cache: dict[str, Any] = {}
        self._embedding_guard = threading.Lock()
        self._embedding_health_cache: dict[str, tuple[bool, str, float]] = {}
        self._last_fallback_reason: dict[str, str] = {}
        self._rerank_min_candidates = 6
        self._rerank_overfetch_ratio = 3
        self._governance_promote_threshold = 0.55

    # ------------------------------------------------------------------
    # MemoryRuntime protocol
    # ------------------------------------------------------------------
    def get_memory_data(self, request: MemoryReadRequest) -> dict[str, Any]:
        items = self._sqlite_index.list_resources(agent_name=request.agent_name)
        facts: list[dict[str, Any]] = []
        last_updated = ""
        for item in items:
            updated_at = str(item.get("updated_at") or "")
            if updated_at and updated_at > last_updated:
                last_updated = updated_at
            facts.append(
                {
                    "id": item.get("memory_id", ""),
                    "content": item.get("summary", ""),
                    "category": "openviking",
                    "confidence": float(item.get("score", 0.0) or 0.0),
                    "createdAt": item.get("created_at", ""),
                    "source": item.get("source_thread_id", ""),
                    "status": item.get("status", "active"),
                    "uri": item.get("uri", ""),
                    "last_used_at": item.get("last_used_at", ""),
                    "use_count": int(item.get("use_count", 0) or 0),
                }
            )

        return {
            "version": "4.0",
            "scope": self._scope_name(request.agent_name),
            "storage_layout": "openviking",
            "lastUpdated": last_updated,
            "user": {
                "workContext": {"summary": "", "updatedAt": ""},
                "personalContext": {"summary": "", "updatedAt": ""},
                "topOfMind": {"summary": "", "updatedAt": ""},
            },
            "history": {
                "recentMonths": {"summary": "", "updatedAt": ""},
                "earlierContext": {"summary": "", "updatedAt": ""},
                "longTermBackground": {"summary": "", "updatedAt": ""},
            },
            "facts": facts,
            "agent_catalog": self._sqlite_index.list_agent_catalog() if request.agent_name is None else [],
        }

    def reload_memory_data(self, request: MemoryReadRequest) -> dict[str, Any]:
        return self.get_memory_data(request)

    def queue_update(self, request: MemoryWriteRequest) -> None:
        config = get_memory_config()
        if config.openviking_session_commit_enabled:
            # Session commit is best-effort and must never block the user turn.
            self._commit_session_async(
                thread_id=request.thread_id,
                messages=request.messages,
                agent_name=request.agent_name,
            )

    def save_memory_data(
        self,
        memory_data: dict[str, Any],
        *,
        agent_name: str | None = None,
        thread_id: str | None = None,
    ) -> bool:
        facts = memory_data.get("facts") or []
        if not isinstance(facts, list):
            return True
        source_thread = (thread_id or "manual-save").strip() or "manual-save"
        for fact in facts:
            if not isinstance(fact, dict):
                continue
            memory_id = str(fact.get("id") or "").strip() or hashlib.sha1(
                str(fact.get("content") or "").encode("utf-8")
            ).hexdigest()[:20]
            summary = str(fact.get("content") or "").strip()
            if not summary:
                continue
            uri = str(fact.get("uri") or "").strip() or f"viking://nion/{memory_id}"
            score = float(fact.get("confidence", 0.0) or 0.0)
            self._sqlite_index.upsert_resource(
                agent_name=agent_name,
                memory_id=memory_id,
                uri=uri,
                summary=summary,
                source_thread_id=source_thread,
                score=score,
                status=str(fact.get("status") or "active"),
                metadata={"source": "save_memory_data"},
            )
        return True

    # ------------------------------------------------------------------
    # OpenViking primary behaviors
    # ------------------------------------------------------------------
    def build_context(self, *, query: str, limit: int | None = None, agent_name: str | None = None) -> str:
        normalized = query.strip()
        if not normalized:
            return ""

        config = get_memory_config()
        resolved_limit = max(1, limit or config.openviking_context_limit)
        results = self.search_memory(query=normalized, limit=resolved_limit, agent_name=agent_name)
        if not results:
            return ""

        lines = ["OpenViking context (relevant knowledge base entries):"]
        for item in results[:resolved_limit]:
            uri = item.get("uri") or "viking://session/memory"
            abstract = str(item.get("abstract") or "").strip()
            text = abstract or str(item.get("memory") or "").strip()
            if not text:
                continue
            lines.append(f"- [{uri}] {text}")
        if len(lines) == 1:
            return ""
        return "\n".join(lines)

    def search_memory(self, *, query: str, limit: int = 8, agent_name: str | None = None) -> list[dict[str, Any]]:
        config = get_memory_config()
        mode = str(config.retrieval_mode or "find").strip().lower()
        if mode in {"vector_auto", "vector_forced"}:
            try:
                vector_results = self._search_vector_memory(
                    query=query,
                    limit=limit,
                    agent_name=agent_name,
                    force_vector=(mode == "vector_forced"),
                )
                if vector_results:
                    self._record_search_results(query=query, results=vector_results, agent_name=agent_name)
                    return vector_results
            except Exception as exc:  # noqa: BLE001
                self._set_last_fallback_reason(
                    agent_name=agent_name,
                    reason=f"vector_search_error: {exc}",
                )
                logger.debug("OpenViking vector search failed: %s", exc)
        try:
            results = self._openviking_find(query=query, limit=limit, agent_name=agent_name)
            if results:
                self._set_last_fallback_reason(agent_name=agent_name, reason="")
                self._record_search_results(query=query, results=results, agent_name=agent_name)
                return results
        except Exception as exc:  # noqa: BLE001
            self._set_last_fallback_reason(
                agent_name=agent_name,
                reason=f"openviking_find_error: {exc}",
            )
            logger.debug("OpenViking find failed: %s", exc)
        return []

    def store_memory(
        self,
        *,
        content: str,
        confidence: float = 0.9,
        source: str | None = None,
        agent_name: str | None = None,
        thread_id: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        text = content.strip()
        if not text:
            raise ValueError("content must not be empty")

        thread = (thread_id or "").strip() or str(uuid.uuid4())
        commit_result = self.commit_session(
            thread_id=thread,
            messages=[{"role": "user", "content": text}],
            agent_name=agent_name,
        )

        fact_id = f"ov_{hashlib.sha1(f'{agent_name}:{text}'.encode()).hexdigest()[:16]}"
        now = _utc_iso()
        resolved_uri = f"viking://nion/{fact_id}"
        resolved_score = max(0.0, min(1.0, float(confidence)))

        try:
            hits = self._openviking_find(query=text, limit=1, agent_name=agent_name)
            if hits:
                top = hits[0]
                resolved_uri = str(top.get("uri") or resolved_uri)
                resolved_score = float(top.get("score") or resolved_score)
        except Exception as exc:  # noqa: BLE001
            logger.debug("OpenViking post-store lookup skipped: %s", exc)

        self._sqlite_index.upsert_resource(
            agent_name=agent_name,
            memory_id=fact_id,
            uri=resolved_uri,
            summary=text,
            source_thread_id=source or thread,
            score=resolved_score,
            status="active",
            metadata=metadata or {},
            bump_usage=True,
        )

        return {
            "memory_id": fact_id,
            "uri": resolved_uri,
            "stored_at": now,
            "scope": self._scope_name(agent_name),
            "score": resolved_score,
            "commit_status": commit_result.get("status"),
        }

    def get_memory_items(self, *, scope: str = "global", agent_name: str | None = None) -> list[dict[str, Any]]:
        resolved_agent = self._resolve_scope_agent(scope=scope, agent_name=agent_name)
        rows = self._sqlite_index.list_resources(agent_name=resolved_agent)
        return [
            {
                "memory_id": row["memory_id"],
                "uri": row["uri"],
                "score": row["score"],
                "status": row["status"],
                "last_used_at": row["last_used_at"],
                "use_count": row["use_count"],
                "summary": row["summary"],
                "source_thread_id": row["source_thread_id"],
                "created_at": row["created_at"],
                "updated_at": row["updated_at"],
                "scope": row["scope"],
                # Backward-compatible fields consumed by existing UI/tests.
                "entry_type": "openviking_resource",
                "tags": [],
                "entity_refs": [],
                "relations": [],
                "source_refs": [],
                "confidence": row["score"],
                "metadata": row.get("metadata") or {},
            }
            for row in rows
        ]

    def compact_memory(self, *, ratio: float = 0.8, scope: str = "global", agent_name: str | None = None) -> dict[str, Any]:
        resolved_agent = self._resolve_scope_agent(scope=scope, agent_name=agent_name)
        rows = self._sqlite_index.list_resources(agent_name=resolved_agent, status="active")
        if not rows:
            return {
                "before_count": 0,
                "after_count": 0,
                "removed_count": 0,
                "ratio": ratio,
                "scope": self._scope_name(resolved_agent),
            }

        bounded_ratio = max(0.1, min(1.0, float(ratio)))
        target_count = max(1, int(round(len(rows) * bounded_ratio)))
        rows_sorted = sorted(
            rows,
            key=lambda item: (item.get("last_used_at") or item.get("updated_at") or item.get("created_at") or ""),
            reverse=True,
        )
        to_remove = rows_sorted[target_count:]
        if not to_remove:
            return {
                "before_count": len(rows),
                "after_count": len(rows),
                "removed_count": 0,
                "ratio": bounded_ratio,
                "scope": self._scope_name(resolved_agent),
            }

        removed_uris: list[str] = []
        for item in to_remove:
            uri = str(item.get("uri") or "").strip()
            if not uri:
                raise RuntimeError(f"Missing uri for memory_id={item.get('memory_id')}")
            self._openviking_rm(uri=uri, agent_name=resolved_agent)
            removed_uris.append(uri)

        with self._sqlite_index.transaction() as conn:
            for item in to_remove:
                self._sqlite_index.delete_resource(
                    agent_name=resolved_agent,
                    memory_id=str(item.get("memory_id") or ""),
                    conn=conn,
                )

        return {
            "before_count": len(rows),
            "after_count": len(rows) - len(to_remove),
            "removed_count": len(to_remove),
            "removed_uris": removed_uris,
            "ratio": bounded_ratio,
            "scope": self._scope_name(resolved_agent),
        }

    def forget_memory(self, *, memory_id: str, scope: str = "global", agent_name: str | None = None) -> dict[str, Any]:
        target_id = memory_id.strip()
        if not target_id:
            raise ValueError("memory_id is required")

        resolved_agent = self._resolve_scope_agent(scope=scope, agent_name=agent_name)
        row = self._sqlite_index.get_resource(agent_name=resolved_agent, memory_id=target_id)
        if row is None:
            raise ValueError(f"memory_id not found: {target_id}")

        uri = str(row.get("uri") or "").strip()
        if not uri:
            raise RuntimeError(f"memory_id {target_id} does not have a deletable uri")

        self._openviking_rm(uri=uri, agent_name=resolved_agent)

        with self._sqlite_index.transaction() as conn:
            deleted = self._sqlite_index.delete_resource(
                agent_name=resolved_agent,
                memory_id=target_id,
                conn=conn,
            )
        if deleted <= 0:
            raise RuntimeError(f"Local ledger delete failed for memory_id={target_id}")

        return {
            "memory_id": target_id,
            "uri": uri,
            "scope": self._scope_name(resolved_agent),
            "deleted": True,
        }

    def get_retrieval_status(self, *, agent_name: str | None = None) -> dict[str, Any]:
        config = get_memory_config()
        embedding_configured, embedding_model = self._resolve_local_embedding_model()
        health_ok = False
        health_message = "local_embedding_not_configured"
        if embedding_configured and embedding_model:
            health_ok, health_message = self._check_embedding_health(embedding_model)
        index_count = self._sqlite_index.vector_count(agent_name=agent_name)
        item_count = self._sqlite_index.count_resources(agent_name=agent_name)
        scope = self._scope_name(agent_name)
        fallback_reason = self._last_fallback_reason.get(scope, "")
        return {
            "scope": scope,
            "retrieval_mode": config.retrieval_mode,
            "rerank_mode": config.rerank_mode,
            "graph_enabled": bool(config.graph_enabled),
            "local_embedding_configured": embedding_configured,
            "local_embedding_model": embedding_model,
            "embedding_health_ok": health_ok,
            "embedding_health_message": health_message,
            "index_available": index_count > 0,
            "index_count": index_count,
            "ledger_item_count": item_count,
            "last_fallback_reason": fallback_reason,
            "graph_stats": self._sqlite_index.graph_stats(agent_name=agent_name),
        }

    def reindex_vectors(self, *, include_agents: bool = True) -> dict[str, Any]:
        embedding_configured, embedding_model = self._resolve_local_embedding_model()
        if not embedding_configured or not embedding_model:
            return {
                "status": "skipped",
                "reason": "local_embedding_not_configured",
                "indexed_count": 0,
            }
        health_ok, health_message = self._check_embedding_health(embedding_model)
        if not health_ok:
            return {
                "status": "skipped",
                "reason": f"embedding_health_failed:{health_message}",
                "indexed_count": 0,
            }

        indexed = 0
        scopes: list[str | None] = [None]
        if include_agents and self._paths.agents_dir.exists():
            for agent_dir in self._paths.agents_dir.iterdir():
                if agent_dir.is_dir():
                    scopes.append(agent_dir.name)

        for scoped_agent in scopes:
            self._sqlite_index.clear_vectors(agent_name=scoped_agent)
            for item in self._sqlite_index.list_resources(agent_name=scoped_agent, status="active"):
                memory_id = str(item.get("memory_id", "")).strip()
                content = str(item.get("summary", "")).strip()
                if not memory_id or not content:
                    continue
                vector = self._embed_text_local(content, embedding_model)
                if not vector:
                    continue
                thread_id = str(item.get("source_thread_id", "")).strip() or "reindex"
                self._sqlite_index.upsert_vector(
                    agent_name=scoped_agent,
                    memory_id=memory_id,
                    thread_id=thread_id,
                    content=content,
                    vector=vector,
                    metadata={"source": "reindex"},
                )
                if get_memory_config().graph_enabled:
                    self._sqlite_index.upsert_graph_from_text(
                        agent_name=scoped_agent,
                        memory_id=memory_id,
                        text=content,
                    )
                indexed += 1
        return {
            "status": "ok",
            "indexed_count": indexed,
            "include_agents": include_agents,
            "completed_at": _utc_iso(),
        }

    def query_memory_graph(
        self,
        *,
        mode: str,
        agent_name: str | None = None,
        entity: str | None = None,
        start_entity: str | None = None,
        end_entity: str | None = None,
        depth: int = 2,
        limit: int = 20,
    ) -> dict[str, Any]:
        if not get_memory_config().graph_enabled:
            return {"mode": mode, "status": "disabled", "reason": "graph_disabled"}
        return self._sqlite_index.query_graph(
            mode=mode,
            agent_name=agent_name,
            entity=entity,
            start_entity=start_entity,
            end_entity=end_entity,
            depth=depth,
            limit=limit,
        )

    def commit_session(self, *, thread_id: str, messages: list[Any], agent_name: str | None = None) -> dict[str, Any]:
        normalized_messages = self._normalize_messages(messages)
        if not normalized_messages:
            return {"status": "skipped", "reason": "no_text_messages"}

        scope_lock = self._lock_for_scope(agent_name)
        with scope_lock:
            client = self._build_openviking_client(agent_name)
            try:
                for msg in normalized_messages:
                    client.add_message(
                        thread_id,
                        msg["role"],
                        content=msg["content"],
                    )
                result = client.commit_session(thread_id)
            finally:
                close_fn = getattr(client, "close", None)
                if callable(close_fn):
                    close_fn()

        try:
            self._upsert_runtime_indexes(
                thread_id=thread_id,
                messages=normalized_messages,
                agent_name=agent_name,
            )
        except Exception as exc:  # noqa: BLE001
            logger.debug("OpenViking local index update skipped: %s", exc)

        return {
            "status": "committed",
            "result": self._to_jsonable(result),
            "message_count": len(normalized_messages),
        }

    # ------------------------------------------------------------------
    # Governance
    # ------------------------------------------------------------------
    def get_governance_status(self, *, agent_name: str | None = None) -> dict[str, Any]:
        status = self._sqlite_index.get_governance_status(agent_name=agent_name)
        status["catalog"] = self._sqlite_index.list_agent_catalog() if agent_name is None else []
        return status

    def replace_agent_catalog(self, cards: list[dict[str, Any]]) -> None:
        self._sqlite_index.replace_agent_catalog(cards)

    def list_agent_catalog(self) -> list[dict[str, Any]]:
        return self._sqlite_index.list_agent_catalog()

    def run_governance(self, *, agent_name: str | None = None) -> dict[str, Any]:
        pending = self._sqlite_index.list_resources(agent_name=agent_name, status="pending")
        promoted = 0
        rejected = 0
        now = _utc_iso()

        with self._sqlite_index.transaction() as conn:
            for item in pending:
                memory_id = str(item.get("memory_id") or "")
                score = float(item.get("score") or 0.0)
                if score >= self._governance_promote_threshold:
                    self._sqlite_index.set_resource_status(
                        agent_name=agent_name,
                        memory_id=memory_id,
                        status="active",
                        conn=conn,
                    )
                    action = "promote"
                    status = "applied"
                    reason = "score_above_threshold"
                    promoted += 1
                else:
                    self._sqlite_index.set_resource_status(
                        agent_name=agent_name,
                        memory_id=memory_id,
                        status="archived",
                        conn=conn,
                    )
                    action = "reject"
                    status = "applied"
                    reason = "score_below_threshold"
                    rejected += 1
                decision_id = f"gov-{memory_id}-{hashlib.sha1(now.encode('utf-8')).hexdigest()[:8]}"
                self._sqlite_index.record_governance_decision(
                    agent_name=agent_name,
                    decision_id=decision_id,
                    memory_id=memory_id,
                    action=action,
                    status=status,
                    reason=reason,
                    candidate={"memory_id": memory_id, "score": score},
                    decided_by="system",
                    decided_at=now,
                    conn=conn,
                )

        self._sqlite_index.set_governance_last_run(agent_name=agent_name, last_run_at=now)
        status_payload = self._sqlite_index.get_governance_status(agent_name=agent_name)
        return {
            "promoted": promoted,
            "rejected": rejected,
            "pending_count": status_payload.get("pending_count", 0),
            "contested_count": status_payload.get("contested_count", 0),
            "last_run_at": status_payload.get("last_run_at", ""),
            "scope": self._scope_name(agent_name),
        }

    def apply_governance_decision(
        self,
        *,
        decision_id: str,
        action: str,
        override_summary: str | None = None,
        decided_by: str = "user",
        agent_name: str | None = None,
    ) -> dict[str, Any]:
        normalized_id = decision_id.strip()
        normalized_action = action.strip().lower()
        if not normalized_id:
            raise ValueError("decision_id is required")
        if normalized_action not in {"promote", "reject", "override"}:
            raise ValueError(f"Unsupported action: {action}")

        status_payload = self._sqlite_index.get_governance_status(agent_name=agent_name)
        queue = status_payload.get("queue") or []
        target = next((item for item in queue if item.get("decision_id") == normalized_id), None)
        if target is None:
            raise ValueError(f"Unknown decision_id: {normalized_id}")

        memory_id = str(target.get("memory_id") or "").strip()
        if not memory_id:
            raise ValueError(f"decision_id {normalized_id} has no memory_id")

        now = _utc_iso()
        with self._sqlite_index.transaction() as conn:
            if normalized_action == "reject":
                self._sqlite_index.set_resource_status(
                    agent_name=agent_name,
                    memory_id=memory_id,
                    status="archived",
                    conn=conn,
                )
                applied_reason = "manual_reject"
            else:
                self._sqlite_index.set_resource_status(
                    agent_name=agent_name,
                    memory_id=memory_id,
                    status="active",
                    conn=conn,
                )
                applied_reason = "manual_promote"
                if normalized_action == "override" and override_summary:
                    row = self._sqlite_index.get_resource(agent_name=agent_name, memory_id=memory_id)
                    if row is not None:
                        self._sqlite_index.upsert_resource(
                            agent_name=agent_name,
                            memory_id=memory_id,
                            uri=str(row.get("uri") or f"viking://nion/{memory_id}"),
                            summary=override_summary.strip(),
                            source_thread_id=str(row.get("source_thread_id") or ""),
                            score=float(row.get("score") or 0.0),
                            status="active",
                            metadata={"override": True, "decision_id": normalized_id},
                            conn=conn,
                        )
                        applied_reason = "manual_override"

            self._sqlite_index.record_governance_decision(
                agent_name=agent_name,
                decision_id=normalized_id,
                memory_id=memory_id,
                action=normalized_action,
                status="decided",
                reason=applied_reason,
                candidate={"memory_id": memory_id},
                decided_by=decided_by,
                decided_at=now,
                conn=conn,
            )

        updated = self._sqlite_index.get_resource(agent_name=agent_name, memory_id=memory_id)
        return {
            "decision_id": normalized_id,
            "memory_id": memory_id,
            "action": normalized_action,
            "decided_by": decided_by,
            "decided_at": now,
            "resource": updated,
        }

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------
    def _scope_name(self, agent_name: str | None) -> str:
        return f"agent:{agent_name}" if agent_name else "global"

    def _resolve_scope_agent(self, *, scope: str, agent_name: str | None) -> str | None:
        normalized_scope = (scope or "global").strip().lower()
        if normalized_scope == "global":
            return None
        if normalized_scope == "agent":
            if not agent_name:
                raise ValueError("agent_name is required when scope=agent")
            return agent_name
        if normalized_scope == "auto":
            return agent_name
        raise ValueError(f"Unsupported scope: {scope}")

    def _set_last_fallback_reason(self, *, agent_name: str | None, reason: str) -> None:
        self._last_fallback_reason[self._scope_name(agent_name)] = reason

    def _record_search_results(self, *, query: str, results: list[dict[str, Any]], agent_name: str | None) -> None:
        source = f"find:{hashlib.sha1(query.encode('utf-8')).hexdigest()[:10]}"
        for item in results:
            uri = str(item.get("uri") or "").strip()
            if not uri:
                continue
            memory_id = str(item.get("id") or "").strip() or hashlib.sha1(uri.encode("utf-8")).hexdigest()[:20]
            summary = str(item.get("abstract") or item.get("memory") or "").strip()
            if not summary:
                continue
            score = float(item.get("score") or 0.0)
            self._sqlite_index.upsert_resource(
                agent_name=agent_name,
                memory_id=memory_id,
                uri=uri,
                summary=summary,
                source_thread_id=source,
                score=score,
                status="active",
                metadata={"source": "openviking.find"},
                bump_usage=True,
            )

    def _resolve_local_embedding_model(self) -> tuple[bool, str | None]:
        cfg = get_memory_config()
        if cfg.embedding_provider.strip().lower() in {
            "sentence-transformers",
            "sentence_transformers",
            "local",
        } and cfg.embedding_model.strip():
            return True, cfg.embedding_model.strip()

        try:
            retrieval = get_app_config().retrieval_models
        except Exception as exc:  # noqa: BLE001
            logger.debug("Resolve retrieval_models config failed: %s", exc)
            return False, None

        active = retrieval.active.embedding
        provider = str(active.provider or "").strip().lower()
        if provider != "local_onnx":
            return False, None
        model_id = str(active.model_id or "").strip()
        if not model_id:
            return False, None
        mapped_models = {
            "zh-embedding-lite": "jinaai/jina-embeddings-v2-base-zh",
            "en-embedding-lite": "BAAI/bge-small-en-v1.5",
        }
        model = mapped_models.get(model_id)
        if not model:
            return False, None
        return True, model

    def _check_embedding_health(self, model_name: str) -> tuple[bool, str]:
        now = time.time()
        cached = self._embedding_health_cache.get(model_name)
        if cached and now - cached[2] <= 30:
            return cached[0], cached[1]
        try:
            vector = self._embed_text_local("health check", model_name)
            ok = bool(vector)
            message = "ok" if ok else "empty_vector"
        except Exception as exc:  # noqa: BLE001
            ok = False
            message = str(exc)
        self._embedding_health_cache[model_name] = (ok, message, now)
        return ok, message

    def _embed_text_local(self, text: str, model_name: str) -> list[float]:
        normalized = text.strip()
        if not normalized:
            return []
        with self._embedding_guard:
            model = self._embedding_model_cache.get(model_name)
            if model is None:
                try:
                    from sentence_transformers import SentenceTransformer  # type: ignore
                except Exception as exc:  # noqa: BLE001
                    raise RuntimeError(f"sentence-transformers unavailable: {exc}") from exc
                model = SentenceTransformer(model_name)
                self._embedding_model_cache[model_name] = model
        embedding = model.encode(normalized)
        return [float(value) for value in list(embedding)]

    def _search_vector_memory(
        self,
        *,
        query: str,
        limit: int,
        agent_name: str | None,
        force_vector: bool,
    ) -> list[dict[str, Any]]:
        configured, model_name = self._resolve_local_embedding_model()
        if not configured or not model_name:
            self._set_last_fallback_reason(agent_name=agent_name, reason="local_embedding_not_configured")
            return []
        health_ok, health_message = self._check_embedding_health(model_name)
        if not health_ok:
            self._set_last_fallback_reason(
                agent_name=agent_name,
                reason=f"embedding_unhealthy:{health_message}",
            )
            return []

        index_count = self._sqlite_index.vector_count(agent_name=agent_name)
        if index_count <= 0:
            self._set_last_fallback_reason(agent_name=agent_name, reason="vector_index_empty")
            return []

        query_vector = self._embed_text_local(query, model_name)
        overfetch = max(limit, limit * self._rerank_overfetch_ratio)
        candidates = self._sqlite_index.search_vectors(
            agent_name=agent_name,
            query_vector=query_vector,
            limit=overfetch,
        )
        if not candidates:
            self._set_last_fallback_reason(agent_name=agent_name, reason="vector_candidates_empty")
            return []

        rerank_mode = str(get_memory_config().rerank_mode or "auto").strip().lower()
        should_rerank = rerank_mode == "forced" or (
            rerank_mode == "auto"
            and len(candidates) >= self._rerank_min_candidates
            and _is_ambiguous_query(query)
        )
        if should_rerank:
            try:
                candidates = self._rerank_candidates(query=query, candidates=candidates)
            except Exception as exc:  # noqa: BLE001
                self._set_last_fallback_reason(
                    agent_name=agent_name,
                    reason=f"rerank_failed:{exc}",
                )
                if force_vector:
                    pass

        self._set_last_fallback_reason(agent_name=agent_name, reason="")
        output: list[dict[str, Any]] = []
        for row in candidates[: max(1, limit)]:
            memory_id = str(row.get("memory_id", "")).strip()
            content = str(row.get("content", "")).strip()
            if not memory_id or not content:
                continue
            score = float(row.get("score", 0.0) or 0.0)
            output.append(
                {
                    "id": memory_id,
                    "uri": f"viking://vector/{memory_id}",
                    "score": score,
                    "abstract": content,
                    "memory": content,
                    "source": str(row.get("thread_id", "")),
                    "retrieval_route": "vector",
                }
            )
        return output

    def _rerank_candidates(self, *, query: str, candidates: list[dict[str, Any]]) -> list[dict[str, Any]]:
        query_tokens = _tokenize(query)
        if not query_tokens:
            return candidates
        rescored: list[dict[str, Any]] = []
        for item in candidates:
            content = str(item.get("content", "")).strip()
            if not content:
                continue
            doc_tokens = _tokenize(content)
            overlap = len(query_tokens & doc_tokens) / max(1, len(query_tokens))
            base_score = float(item.get("score", 0.0) or 0.0)
            item["score"] = round(base_score * 0.6 + overlap * 0.4, 6)
            rescored.append(item)
        rescored.sort(key=lambda row: float(row.get("score", 0.0) or 0.0), reverse=True)
        return rescored

    def _upsert_runtime_indexes(self, *, thread_id: str, messages: list[dict[str, str]], agent_name: str | None) -> None:
        configured, model_name = self._resolve_local_embedding_model()
        if not configured or not model_name:
            self._set_last_fallback_reason(
                agent_name=agent_name,
                reason="local_embedding_not_configured",
            )
            return
        health_ok, health_message = self._check_embedding_health(model_name)
        if not health_ok:
            self._set_last_fallback_reason(
                agent_name=agent_name,
                reason=f"embedding_unhealthy:{health_message}",
            )
            return

        for msg in messages:
            content = str(msg.get("content", "")).strip()
            role = str(msg.get("role", "")).strip().lower() or "assistant"
            if not content:
                continue
            memory_id = hashlib.sha1(
                f"{agent_name or 'global'}:{thread_id}:{role}:{content}".encode()
            ).hexdigest()[:20]
            uri = f"viking://session/{thread_id}/{memory_id}"
            self._sqlite_index.upsert_resource(
                agent_name=agent_name,
                memory_id=memory_id,
                uri=uri,
                summary=content,
                source_thread_id=thread_id,
                score=0.6,
                status="active",
                metadata={"source": "session_commit", "role": role},
                bump_usage=True,
            )

            vector = self._embed_text_local(content, model_name)
            if not vector:
                continue
            self._sqlite_index.upsert_vector(
                agent_name=agent_name,
                memory_id=memory_id,
                thread_id=thread_id,
                content=content,
                vector=vector,
                metadata={"source": "session_commit", "role": role},
            )
            if get_memory_config().graph_enabled:
                self._sqlite_index.upsert_graph_from_text(
                    agent_name=agent_name,
                    memory_id=memory_id,
                    text=content,
                )

    def _commit_session_async(self, *, thread_id: str, messages: list[Any], agent_name: str | None) -> None:
        def _runner():
            try:
                self.commit_session(thread_id=thread_id, messages=messages, agent_name=agent_name)
            except Exception as exc:  # noqa: BLE001
                logger.debug("OpenViking session commit skipped: %s", exc)

        threading.Thread(target=_runner, daemon=True).start()

    def _lock_for_scope(self, agent_name: str | None) -> threading.Lock:
        scope = agent_name.lower() if agent_name else "global"
        with self._scope_locks_guard:
            lock = self._scope_locks.get(scope)
            if lock is None:
                lock = threading.Lock()
                self._scope_locks[scope] = lock
            return lock

    def _build_openviking_client(self, agent_name: str | None):
        try:
            import openviking as ov  # type: ignore
        except Exception as exc:  # noqa: BLE001
            raise RuntimeError(f"OpenViking import failed: {exc}") from exc

        data_dir, conf_file = self._ensure_openviking_scope(agent_name)
        # OpenViking Python SDK currently resolves config via env/default path.
        os.environ["OPENVIKING_CONFIG_FILE"] = str(conf_file)
        client = ov.SyncOpenViking(path=str(data_dir))
        client.initialize()
        return client

    def _openviking_rm(self, *, uri: str, agent_name: str | None) -> None:
        client = self._build_openviking_client(agent_name)
        try:
            rm_fn = getattr(client, "rm", None)
            if not callable(rm_fn):
                raise RuntimeError("OpenViking client does not expose rm(uri)")
            rm_fn(uri)
        finally:
            close_fn = getattr(client, "close", None)
            if callable(close_fn):
                close_fn()

    def _ensure_openviking_scope(self, agent_name: str | None) -> tuple[Path, Path]:
        data_dir = self._paths.openviking_data_dir(agent_name)
        conf_file = self._paths.openviking_config_file(agent_name)
        data_dir.mkdir(parents=True, exist_ok=True)
        conf_file.parent.mkdir(parents=True, exist_ok=True)

        raw_config: dict[str, Any] = {}
        if conf_file.exists():
            try:
                loaded = json.loads(conf_file.read_text(encoding="utf-8"))
                if isinstance(loaded, dict):
                    raw_config = loaded
            except Exception:  # noqa: BLE001
                raw_config = {}

        normalized = self._normalize_openviking_config(raw_config)
        if normalized != raw_config:
            conf_file.write_text(json.dumps(normalized, indent=2, ensure_ascii=False), encoding="utf-8")
        return data_dir, conf_file

    def _normalize_openviking_config(self, raw: dict[str, Any]) -> dict[str, Any]:
        config = dict(raw)
        config["embedding"] = self._normalize_openviking_embedding_config(config.get("embedding"))
        config["vlm"] = self._normalize_openviking_vlm_config(config.get("vlm"))
        return config

    def _normalize_openviking_embedding_config(self, raw_embedding: Any) -> dict[str, Any]:
        memory_cfg = get_memory_config()
        embedding = dict(raw_embedding) if isinstance(raw_embedding, dict) else {}
        dense = dict(embedding.get("dense")) if isinstance(embedding.get("dense"), dict) else {}

        provider = str(dense.get("provider") or dense.get("backend") or memory_cfg.embedding_provider or "").strip().lower()
        if provider not in {"openai", "volcengine", "jina"}:
            provider = "jina" if "jina" in str(memory_cfg.embedding_model or "").lower() else "openai"

        model = str(dense.get("model") or memory_cfg.embedding_model or "").strip()
        if not model:
            model = "jina-embeddings-v3" if provider == "jina" else "text-embedding-3-small"

        api_key = str(dense.get("api_key") or memory_cfg.embedding_api_key or "").strip()
        if not api_key:
            default_env = {
                "openai": "OPENAI_API_KEY",
                "volcengine": "ARK_API_KEY",
                "jina": "JINA_API_KEY",
            }[provider]
            api_key = f"${default_env}"

        dense["provider"] = provider
        dense["model"] = model
        dense["api_key"] = api_key
        dense.setdefault("api_base", "")

        embedding["dense"] = dense
        return embedding

    def _normalize_openviking_vlm_config(self, raw_vlm: Any) -> dict[str, Any]:
        vlm = dict(raw_vlm) if isinstance(raw_vlm, dict) else {}
        has_provider_pool = bool(vlm.get("providers"))
        has_direct_model = bool(str(vlm.get("model") or "").strip())
        has_direct_key = bool(str(vlm.get("api_key") or "").strip())

        if has_provider_pool and has_direct_model:
            return vlm
        if has_direct_model and has_direct_key:
            return vlm

        return {}

    def _openviking_find(self, *, query: str, limit: int, agent_name: str | None) -> list[dict[str, Any]]:
        client = self._build_openviking_client(agent_name)
        try:
            results = client.find(query, limit=max(1, limit))
            resources = getattr(results, "resources", None) or []
            output: list[dict[str, Any]] = []
            for resource in resources:
                uri = getattr(resource, "uri", "") or "viking://session/memory"
                score = float(getattr(resource, "score", 0.0) or 0.0)
                abstract = ""
                try:
                    abstract = str(client.abstract(uri) or "").strip()
                except Exception:  # noqa: BLE001
                    abstract = ""
                output.append(
                    {
                        "id": hashlib.sha1(uri.encode("utf-8")).hexdigest()[:16],
                        "uri": uri,
                        "score": score,
                        "abstract": abstract,
                        "memory": abstract,
                    }
                )
            return output
        finally:
            close_fn = getattr(client, "close", None)
            if callable(close_fn):
                close_fn()

    def _normalize_messages(self, messages: list[Any]) -> list[dict[str, str]]:
        normalized: list[dict[str, str]] = []
        for msg in messages:
            if isinstance(msg, dict):
                role_raw = msg.get("type") or msg.get("role")
                content = msg.get("content", msg)
            else:
                role_raw = getattr(msg, "type", None) or getattr(msg, "role", None)
                content = getattr(msg, "content", msg)

            role = _normalize_role(role_raw)
            fragments = _extract_text_fragments(content)
            if not fragments:
                continue
            text = "\n".join(fragments).strip()
            if not text:
                continue
            normalized.append({"role": role, "content": text})
        return normalized

    @staticmethod
    def _to_jsonable(value: Any) -> Any:
        if isinstance(value, str | int | float | bool) or value is None:
            return value
        if isinstance(value, dict):
            return {str(k): OpenVikingRuntime._to_jsonable(v) for k, v in value.items()}
        if isinstance(value, list):
            return [OpenVikingRuntime._to_jsonable(v) for v in value]
        if hasattr(value, "__dict__"):
            return OpenVikingRuntime._to_jsonable(value.__dict__)
        return str(value)
