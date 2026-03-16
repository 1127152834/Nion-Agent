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
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from src.agents.memory.core import MemoryReadRequest, MemoryWriteRequest
from src.agents.memory.scope import normalize_agent_name_for_memory, resolve_agent_for_memory_scope
from src.agents.memory.sqlite_index import OpenVikingSQLiteIndex
from src.agents.memory.write_graph import MemoryWriteAction, MemoryWriteGraph
from src.config.app_config import get_app_config
from src.config.memory_config import get_memory_config
from src.config.paths import get_paths
from src.processlog.service import get_processlog_service

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


def _parse_iso(value: str | None) -> datetime | None:
    raw = (value or "").strip()
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00")).astimezone(UTC)
    except Exception:  # noqa: BLE001
        return None


def _is_not_found_error(exc: Exception) -> bool:
    """Best-effort classification for idempotent delete.

    OpenViking rm/forget/compact is expected to be idempotent from the caller
    perspective. When the remote resource is already missing, we still want to
    continue cleaning up the local ledger.
    """

    text = str(exc).strip().lower()
    return "not found" in text


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
        self._processlog = get_processlog_service()
        self._write_graph = MemoryWriteGraph(self)

    @staticmethod
    def _memory_tier(metadata: dict[str, Any] | None) -> str:
        if not isinstance(metadata, dict):
            return "episode"
        value = str(metadata.get("tier") or "").strip().lower()
        if value in {"profile", "preference", "episode", "trace"}:
            return value
        return "episode"

    @staticmethod
    def _is_expired(metadata: dict[str, Any] | None) -> bool:
        if not isinstance(metadata, dict):
            return False
        expires_at = _parse_iso(str(metadata.get("expires_at") or ""))
        if expires_at is None:
            return False
        return expires_at <= datetime.now(UTC)

    @staticmethod
    def _memory_retention(meta: dict[str, Any] | None) -> tuple[str, str]:
        if not isinstance(meta, dict):
            return ("mid_term_180d", "")
        return (
            str(meta.get("retention_policy") or "mid_term_180d"),
            str(meta.get("expires_at") or ""),
        )

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
        if not config.enabled:
            return

        # Hard-cut mode: all online writes must go through structured graph.
        self._write_graph_async(
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
            memory_id = str(fact.get("id") or "").strip() or hashlib.sha1(str(fact.get("content") or "").encode("utf-8")).hexdigest()[:20]
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
        # "_default" is a reserved runtime agent name and must share the global ledger/index.
        agent_name = self._normalize_agent_name(agent_name)
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
                if mode == "find":
                    self._set_last_fallback_reason(agent_name=agent_name, reason="")
                self._record_search_results(query=query, results=results, agent_name=agent_name)
                return results
        except Exception as exc:  # noqa: BLE001
            self._set_last_fallback_reason(
                agent_name=agent_name,
                reason=f"openviking_find_error: {exc}",
            )
            logger.debug("OpenViking find failed: %s", exc)
        local_results = self._search_local_resources(query=query, limit=limit, agent_name=agent_name)
        if local_results:
            self._set_last_fallback_reason(agent_name=agent_name, reason="local_ledger_fallback")
            return local_results
        return []

    def _search_local_resources(self, *, query: str, limit: int, agent_name: str | None) -> list[dict[str, Any]]:
        normalized_query = query.strip()
        if not normalized_query:
            return []

        rows = self._sqlite_index.list_resources(agent_name=agent_name, status="active")
        if not rows:
            return []

        query_lower = normalized_query.lower()
        query_tokens = _tokenize(normalized_query)
        query_cjk_chars = {ch for ch in normalized_query if "\u4e00" <= ch <= "\u9fff"}
        asks_for_name = any(marker in query_lower for marker in ("叫什么", "名字", "name", "who am i", "my name"))
        scored: list[tuple[float, dict[str, Any]]] = []

        for row in rows:
            metadata = row.get("metadata") if isinstance(row.get("metadata"), dict) else {}
            tier = self._memory_tier(metadata)
            if tier == "trace":
                continue
            if self._is_expired(metadata):
                continue

            summary = str(row.get("summary") or "").strip()
            if not summary:
                continue
            summary_lower = summary.lower()
            doc_tokens = _tokenize(summary)
            token_overlap = len(query_tokens & doc_tokens) / max(1, len(query_tokens))
            contains = 1.0 if query_lower in summary_lower else 0.0
            doc_cjk_chars = {ch for ch in summary if "\u4e00" <= ch <= "\u9fff"}
            cjk_overlap = len(query_cjk_chars & doc_cjk_chars) / max(1, len(query_cjk_chars)) if query_cjk_chars else 0.0
            name_hint = 0.0
            if asks_for_name and any(marker in summary_lower for marker in ("我叫", "名字", "name", "我是")):
                name_hint = 0.45
            tier_bonus = {
                "profile": 0.15,
                "preference": 0.08,
                "episode": 0.04,
            }.get(tier, 0.0)
            score = max(token_overlap, contains * 0.9, cjk_overlap * 0.7, name_hint) + tier_bonus
            if score <= 0.0:
                continue
            scored.append((score, row))

        scored.sort(
            key=lambda item: (
                item[0],
                str(item[1].get("last_used_at") or item[1].get("updated_at") or item[1].get("created_at") or ""),
            ),
            reverse=True,
        )

        output: list[dict[str, Any]] = []
        for score, row in scored[: max(1, int(limit))]:
            uri = str(row.get("uri") or "").strip() or "viking://session/memory"
            summary = str(row.get("summary") or "").strip()
            memory_id = str(row.get("memory_id") or "").strip()
            output.append(
                {
                    "id": memory_id or hashlib.sha1(uri.encode("utf-8")).hexdigest()[:16],
                    "uri": uri,
                    "score": round(float(score), 6),
                    "abstract": summary,
                    "memory": summary,
                    "retrieval_route": "ledger",
                }
            )
        return output

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
        write_result = self.write_memory_graph(
            thread_id=thread,
            messages=[{"role": "user", "content": text}],
            agent_name=agent_name,
            chat_id=thread,
            write_source="tool",
            explicit_write=True,
        )

        commit_result = self.commit_session(
            thread_id=thread,
            messages=[{"role": "user", "content": text}],
            agent_name=agent_name,
        )

        now = _utc_iso()
        applied_results = write_result.get("applied_results") or []
        action_results = [item for item in applied_results if str(item.get("action") or "").upper() in {"ADD", "UPDATE"}]
        primary_result = action_results[0] if action_results else None
        fact_id = str((primary_result or {}).get("memory_id") or "")
        if not fact_id:
            fact_id = f"ov_{hashlib.sha1(f'{agent_name}:{text}'.encode()).hexdigest()[:16]}"

        resolved_uri = f"viking://manifest/{fact_id}"
        resolved_score = max(0.0, min(1.0, float(confidence)))
        resolved_status = "active"
        resolved_tier = "episode"
        resolved_reason = "tool_store_fallback"
        evidence: dict[str, Any] = {}
        if primary_result is not None:
            resolved_status = str(primary_result.get("after_status") or resolved_status)
            resolved_score = float(primary_result.get("quality_score") or resolved_score)
            resolved_tier = str(primary_result.get("tier") or resolved_tier)
            resolved_reason = str(primary_result.get("reason") or "tool_store")
            evidence = primary_result.get("evidence") if isinstance(primary_result.get("evidence"), dict) else {}

        if fact_id:
            row = self._sqlite_index.get_resource(agent_name=agent_name, memory_id=fact_id)
            if row is not None:
                resolved_uri = str(row.get("uri") or resolved_uri)
                resolved_score = float(row.get("score") or resolved_score)
                resolved_status = str(row.get("status") or resolved_status)
                row_meta = row.get("metadata") if isinstance(row.get("metadata"), dict) else {}
                resolved_tier = self._memory_tier(row_meta)
                if metadata:
                    merged_meta = {**row_meta, **metadata}
                    merged_meta["source"] = source or row_meta.get("source") or "tool"
                    self._sqlite_index.upsert_resource(
                        agent_name=agent_name,
                        memory_id=fact_id,
                        uri=resolved_uri,
                        summary=str(row.get("summary") or text),
                        source_thread_id=source or thread,
                        score=resolved_score,
                        status=resolved_status,
                        metadata=merged_meta,
                        bump_usage=True,
                    )

        return {
            "memory_id": fact_id,
            "uri": resolved_uri,
            "stored_at": now,
            "scope": self._scope_name(agent_name),
            "score": resolved_score,
            "status": resolved_status,
            "tier": resolved_tier,
            "source": source or "tool",
            "quality_score": resolved_score,
            "decision_reason": resolved_reason,
            "evidence": evidence,
            "memory_write_evidence_id": str(evidence.get("write_evidence_id") or ""),
            "write_result": write_result,
            "commit_status": commit_result.get("status"),
        }

    def get_memory_items(self, *, scope: str = "global", agent_name: str | None = None) -> list[dict[str, Any]]:
        resolved_agent = self._resolve_scope_agent(scope=scope, agent_name=agent_name)
        rows = self._sqlite_index.list_resources(agent_name=resolved_agent)
        items: list[dict[str, Any]] = []
        for row in rows:
            metadata = row.get("metadata") if isinstance(row.get("metadata"), dict) else {}
            tier = self._memory_tier(metadata)
            source = str(metadata.get("source") or "auto")
            quality_score = float(metadata.get("quality_score") or row["score"] or 0.0)
            decision_reason = str(metadata.get("decision_reason") or metadata.get("reason") or "")
            evidence = metadata.get("evidence") if isinstance(metadata.get("evidence"), dict) else {}
            retention_policy, expires_at = self._memory_retention(metadata)
            ttl_seconds: int | None = None
            expires_at_dt = _parse_iso(expires_at)
            if expires_at_dt is not None:
                ttl_seconds = max(0, int((expires_at_dt - datetime.now(UTC)).total_seconds()))

            items.append(
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
                    "tier": tier,
                    "source": source,
                    "quality": quality_score,
                    "quality_score": quality_score,
                    "decision_reason": decision_reason,
                    "evidence": evidence,
                    "retention_policy": retention_policy,
                    "ttl": ttl_seconds,
                    # Backward-compatible fields consumed by existing UI/tests.
                    "entry_type": "openviking_resource",
                    "tags": [],
                    "entity_refs": [],
                    "relations": [],
                    "source_refs": [],
                    "confidence": row["score"],
                    "metadata": metadata,
                }
            )
        return items

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
            try:
                self._openviking_rm(uri=uri, agent_name=resolved_agent)
            except Exception as exc:  # noqa: BLE001
                if not _is_not_found_error(exc):
                    raise
                logger.debug(
                    "OpenViking rm not-found tolerated during compact (scope=%s uri=%s): %s",
                    self._scope_name(resolved_agent),
                    uri,
                    exc,
                )
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

        try:
            self._openviking_rm(uri=uri, agent_name=resolved_agent)
        except Exception as exc:  # noqa: BLE001
            if not _is_not_found_error(exc):
                raise
            logger.debug(
                "OpenViking rm not-found tolerated during forget (scope=%s uri=%s): %s",
                self._scope_name(resolved_agent),
                uri,
                exc,
            )

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
        # "_default" is a reserved runtime agent name and must share the global ledger/index.
        agent_name = self._normalize_agent_name(agent_name)
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

    def explain_query(self, *, query: str, limit: int = 8, agent_name: str | None = None) -> dict[str, Any]:
        # "_default" is a reserved runtime agent name and must share the global ledger/index.
        agent_name = self._normalize_agent_name(agent_name)
        normalized_query = query.strip()
        if not normalized_query:
            return {
                "route_taken": "none",
                "dense_hits": [],
                "sparse_hits": [],
                "fusion_hits": [],
                "fallback_reason": "empty_query",
            }

        dense_hits: list[dict[str, Any]] = []
        sparse_hits: list[dict[str, Any]] = []
        route_parts: list[str] = []

        try:
            dense_hits = self._search_vector_memory(
                query=normalized_query,
                limit=max(1, int(limit)),
                agent_name=agent_name,
                force_vector=False,
            )
        except Exception as exc:  # noqa: BLE001
            self._set_last_fallback_reason(agent_name=agent_name, reason=f"dense_error:{exc}")
            dense_hits = []

        if dense_hits:
            route_parts.append("dense")

        sparse_hits = self._search_local_resources(
            query=normalized_query,
            limit=max(1, int(limit)),
            agent_name=agent_name,
        )
        if sparse_hits:
            route_parts.append("sparse")

        fusion_hits = self._rrf_fusion(
            dense_hits=dense_hits,
            sparse_hits=sparse_hits,
            limit=max(1, int(limit)),
        )
        if fusion_hits:
            route_parts.append("fusion")

        fallback_reason = self._last_fallback_reason.get(self._scope_name(agent_name), "")
        return {
            "query": normalized_query,
            "route_taken": "+".join(route_parts) if route_parts else "none",
            "dense_hits": dense_hits,
            "sparse_hits": sparse_hits,
            "fusion_hits": fusion_hits,
            "fallback_reason": fallback_reason,
            "recent_actions": self._sqlite_index.list_action_logs(agent_name=agent_name, limit=20),
        }

    def apply_memory_actions(
        self,
        *,
        actions: list[MemoryWriteAction],
        thread_id: str,
        agent_name: str | None = None,
        trace_id: str | None = None,
        chat_id: str | None = None,
    ) -> list[dict[str, Any]]:
        if not actions:
            return []

        applied: list[dict[str, Any]] = []
        now = _utc_iso()
        with self._sqlite_index.transaction() as conn:
            for action in actions:
                normalized_action = str(action.get("action") or "").strip().upper()
                memory_id = str(action.get("memory_id") or "").strip()
                content = str(action.get("content") or "").strip()
                reason = str(action.get("reason") or "")
                evidence = action.get("evidence") if isinstance(action.get("evidence"), dict) else {}
                tier = str(action.get("tier") or evidence.get("tier") or "episode").strip().lower()
                source = str(action.get("source") or evidence.get("source") or "auto").strip().lower()
                quality_score = float(action.get("quality_score") or evidence.get("quality_score") or 0.0)
                retention_policy = str(action.get("retention_policy") or evidence.get("retention_policy") or "")
                ttl_seconds_raw = action.get("ttl_seconds")
                ttl_seconds = int(ttl_seconds_raw) if isinstance(ttl_seconds_raw, int | float) else None
                target_status = str(action.get("target_status") or "active").strip().lower()
                decision_reason = str(evidence.get("decision_reason") or reason or "")
                expires_at = str(evidence.get("expires_at") or "")
                if ttl_seconds is not None and ttl_seconds > 0 and not expires_at:
                    expires_at = datetime.fromtimestamp(datetime.now(UTC).timestamp() + ttl_seconds, tz=UTC).isoformat().replace("+00:00", "Z")

                if not memory_id:
                    if content:
                        memory_id = hashlib.sha1(f"{agent_name or 'global'}:{thread_id}:{content}".encode()).hexdigest()[:20]
                    else:
                        continue

                action_id = uuid.uuid4().hex[:16]
                before = self._sqlite_index.get_manifest_entry(agent_name=agent_name, memory_id=memory_id)
                before_content = str(before.get("content") or "") if before else ""
                before_status = str(before.get("status") or "missing") if before else "missing"
                evidence_payload = {
                    **evidence,
                    "write_evidence_id": action_id,
                    "tier": tier,
                    "source": source,
                    "quality_score": round(quality_score, 6),
                    "decision_reason": decision_reason,
                    "retention_policy": retention_policy,
                    "ttl_seconds": ttl_seconds,
                    "expires_at": expires_at,
                    "updated_at": now,
                }

                if normalized_action == "DELETE":
                    self._sqlite_index.upsert_manifest_entry(
                        agent_name=agent_name,
                        memory_id=memory_id,
                        content=before_content or content,
                        status="deleted",
                        source_thread_id=thread_id,
                        metadata={"trace_id": trace_id or "", "chat_id": chat_id or "", **evidence_payload},
                        last_action="DELETE",
                        conn=conn,
                    )
                    self._sqlite_index.delete_resource(agent_name=agent_name, memory_id=memory_id, conn=conn)
                    after_status = "deleted"
                    after_content = before_content or content
                elif normalized_action == "UPDATE":
                    if not content:
                        continue
                    self._sqlite_index.upsert_manifest_entry(
                        agent_name=agent_name,
                        memory_id=memory_id,
                        content=content,
                        status=target_status if target_status in {"active", "pending", "contested", "archived"} else "active",
                        source_thread_id=thread_id,
                        metadata={"trace_id": trace_id or "", "chat_id": chat_id or "", **evidence_payload},
                        last_action="UPDATE",
                        conn=conn,
                    )
                    self._sqlite_index.upsert_resource(
                        agent_name=agent_name,
                        memory_id=memory_id,
                        uri=f"viking://manifest/{memory_id}",
                        summary=content,
                        source_thread_id=thread_id,
                        score=max(0.0, min(1.0, quality_score if quality_score > 0 else 0.85)),
                        status=target_status if target_status in {"active", "pending", "contested", "archived"} else "active",
                        metadata={
                            "source": source,
                            "tier": tier,
                            "quality_score": round(quality_score, 6),
                            "decision_reason": decision_reason,
                            "retention_policy": retention_policy,
                            "ttl_seconds": ttl_seconds,
                            "expires_at": expires_at,
                            "evidence": evidence_payload,
                            "manifest_source": "manifest_update",
                        },
                        conn=conn,
                    )
                    after_status = target_status if target_status in {"active", "pending", "contested", "archived"} else "active"
                    after_content = content
                elif normalized_action == "ADD":
                    if not content:
                        continue
                    self._sqlite_index.upsert_manifest_entry(
                        agent_name=agent_name,
                        memory_id=memory_id,
                        content=content,
                        status=target_status if target_status in {"active", "pending", "contested", "archived"} else "active",
                        source_thread_id=thread_id,
                        metadata={"trace_id": trace_id or "", "chat_id": chat_id or "", **evidence_payload},
                        last_action="ADD",
                        conn=conn,
                    )
                    self._sqlite_index.upsert_resource(
                        agent_name=agent_name,
                        memory_id=memory_id,
                        uri=f"viking://manifest/{memory_id}",
                        summary=content,
                        source_thread_id=thread_id,
                        score=max(0.0, min(1.0, quality_score if quality_score > 0 else 0.75)),
                        status=target_status if target_status in {"active", "pending", "contested", "archived"} else "active",
                        metadata={
                            "source": source,
                            "tier": tier,
                            "quality_score": round(quality_score, 6),
                            "decision_reason": decision_reason,
                            "retention_policy": retention_policy,
                            "ttl_seconds": ttl_seconds,
                            "expires_at": expires_at,
                            "evidence": evidence_payload,
                            "manifest_source": "manifest_add",
                        },
                        conn=conn,
                    )
                    after_status = target_status if target_status in {"active", "pending", "contested", "archived"} else "active"
                    after_content = content
                else:
                    continue

                self._sqlite_index.append_action_log(
                    agent_name=agent_name,
                    action_id=action_id,
                    trace_id=trace_id,
                    chat_id=chat_id,
                    memory_id=memory_id,
                    action=normalized_action,
                    reason=reason,
                    before_content=before_content,
                    after_content=after_content,
                    evidence=evidence_payload,
                    conn=conn,
                )
                applied.append(
                    {
                        "action_id": action_id,
                        "action": normalized_action,
                        "memory_id": memory_id,
                        "before_status": before_status,
                        "after_status": after_status,
                        "reason": reason,
                        "tier": tier,
                        "source": source,
                        "quality_score": round(quality_score, 6),
                        "decision_reason": decision_reason,
                        "evidence": evidence_payload,
                    }
                )

        self._refresh_vectors_and_graph_from_manifest(agent_name=agent_name)
        return applied

    def get_manifest_revision(self, *, agent_name: str | None = None) -> int:
        return self._sqlite_index.get_manifest_revision(agent_name=agent_name)

    def rebuild_from_manifest(self, *, agent_name: str | None = None) -> dict[str, Any]:
        self._sqlite_index.clear_scope_derived_indexes(agent_name=agent_name)

        active_entries = self._sqlite_index.list_manifest_entries(agent_name=agent_name, status="active")
        indexed = 0
        for entry in active_entries:
            memory_id = str(entry.get("memory_id") or "")
            content = str(entry.get("content") or "")
            if not memory_id or not content:
                continue
            source_thread = str(entry.get("source_thread_id") or "")
            entry_meta = entry.get("metadata") if isinstance(entry.get("metadata"), dict) else {}
            self._sqlite_index.upsert_resource(
                agent_name=agent_name,
                memory_id=memory_id,
                uri=f"viking://manifest/{memory_id}",
                summary=content,
                source_thread_id=source_thread,
                score=float(entry_meta.get("quality_score") or 0.8),
                status="active",
                metadata={
                    "source": str(entry_meta.get("source") or "manifest_rebuild"),
                    "tier": self._memory_tier(entry_meta),
                    "quality_score": float(entry_meta.get("quality_score") or 0.8),
                    "decision_reason": str(entry_meta.get("decision_reason") or "manifest_rebuild"),
                    "retention_policy": str(entry_meta.get("retention_policy") or "mid_term_180d"),
                    "ttl_seconds": entry_meta.get("ttl_seconds"),
                    "expires_at": str(entry_meta.get("expires_at") or ""),
                    "evidence": entry_meta.get("evidence") if isinstance(entry_meta.get("evidence"), dict) else {},
                    "manifest_source": "manifest_rebuild",
                },
            )
            indexed += 1

        self._refresh_vectors_and_graph_from_manifest(agent_name=agent_name)
        return {
            "status": "ok",
            "scope": self._scope_name(agent_name),
            "rebuilt_count": indexed,
            "manifest_revision": self._sqlite_index.get_manifest_revision(agent_name=agent_name),
            "completed_at": _utc_iso(),
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

    def write_memory_graph(
        self,
        *,
        thread_id: str,
        messages: list[Any],
        agent_name: str | None = None,
        write_source: str = "auto",
        explicit_write: bool = False,
        trace_id: str | None = None,
        chat_id: str | None = None,
    ) -> dict[str, Any]:
        # "_default" is a reserved runtime agent name and must share the global ledger/index.
        resolved_agent = self._normalize_agent_name(agent_name)
        return self._write_graph.invoke(
            thread_id=thread_id,
            messages=messages,
            agent_name=resolved_agent,
            write_source="tool" if str(write_source).strip().lower() == "tool" else "auto",
            explicit_write=bool(explicit_write),
            trace_id=trace_id,
            chat_id=chat_id,
        )

    def emit_processlog_event(
        self,
        *,
        trace_id: str | None,
        chat_id: str | None,
        step: str,
        level: str,
        duration_ms: int,
        data: dict[str, Any],
    ) -> None:
        normalized_trace = (trace_id or "").strip()
        if not normalized_trace:
            return
        self._processlog.record(
            trace_id=normalized_trace,
            chat_id=(chat_id or "").strip() or None,
            step=step,
            level="error" if level == "error" else "info",
            duration_ms=duration_ms,
            data=data,
        )

    def commit_session(self, *, thread_id: str, messages: list[Any], agent_name: str | None = None) -> dict[str, Any]:
        normalized_messages = self._normalize_messages(messages)
        if not normalized_messages:
            return {"status": "skipped", "reason": "no_text_messages"}

        # "_default" is a reserved runtime agent name and must share the global OpenViking scope.
        agent_name = self._normalize_agent_name(agent_name)

        commit_status = "committed"
        commit_result_payload: Any = None
        degraded_reason = ""

        scope_lock = self._lock_for_scope(agent_name)
        with scope_lock:
            client = None
            try:
                client = self._build_openviking_client(agent_name)
                for msg in normalized_messages:
                    client.add_message(
                        thread_id,
                        msg["role"],
                        content=msg["content"],
                    )
                result = client.commit_session(thread_id)
                commit_result_payload = self._to_jsonable(result)
            except Exception as exc:  # noqa: BLE001
                # Degrade to local ledger-only commit when OpenViking is unavailable.
                commit_status = "committed_local_only"
                degraded_reason = str(exc)
                logger.warning(
                    "OpenViking session commit degraded to local-only mode for thread %s (scope=%s): %s",
                    thread_id,
                    self._scope_name(agent_name),
                    exc,
                )
            finally:
                if client is not None:
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

        payload: dict[str, Any] = {
            "status": commit_status,
            "message_count": len(normalized_messages),
        }
        if commit_result_payload is not None:
            payload["result"] = commit_result_payload
        if degraded_reason:
            payload["degraded_reason"] = degraded_reason
        return payload

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
        self._cleanup_expired_items(agent_name=agent_name)
        compression_result = self._semantic_compact_episodes(agent_name=agent_name)

        pending = self._sqlite_index.list_resources(agent_name=agent_name, status="pending")
        contested = self._sqlite_index.list_resources(agent_name=agent_name, status="contested")
        promoted = 0
        rejected = 0
        flagged = 0
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

            for item in contested:
                memory_id = str(item.get("memory_id") or "")
                score = float(item.get("score") or 0.0)
                decision_id = f"gov-contested-{memory_id}-{hashlib.sha1(now.encode('utf-8')).hexdigest()[:8]}"
                self._sqlite_index.record_governance_decision(
                    agent_name=agent_name,
                    decision_id=decision_id,
                    memory_id=memory_id,
                    action="review",
                    status="pending_review",
                    reason="conflict_requires_manual_review",
                    candidate={"memory_id": memory_id, "score": score},
                    decided_by="system",
                    decided_at=now,
                    conn=conn,
                )
                flagged += 1

        self._sqlite_index.set_governance_last_run(agent_name=agent_name, last_run_at=now)
        status_payload = self._sqlite_index.get_governance_status(agent_name=agent_name)
        return {
            "promoted": promoted,
            "rejected": rejected,
            "flagged": flagged,
            "compressed_story_cards": int(compression_result.get("created_cards", 0)),
            "archived_episode_items": int(compression_result.get("archived_items", 0)),
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
                        existing_meta = row.get("metadata") if isinstance(row.get("metadata"), dict) else {}
                        self._sqlite_index.upsert_resource(
                            agent_name=agent_name,
                            memory_id=memory_id,
                            uri=str(row.get("uri") or f"viking://nion/{memory_id}"),
                            summary=override_summary.strip(),
                            source_thread_id=str(row.get("source_thread_id") or ""),
                            score=float(row.get("score") or 0.0),
                            status="active",
                            metadata={**existing_meta, "override": True, "decision_id": normalized_id},
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

    def _cleanup_expired_items(self, *, agent_name: str | None = None) -> dict[str, int]:
        rows = self._sqlite_index.list_resources(agent_name=agent_name)
        manifest_map = {str(entry.get("memory_id") or ""): entry for entry in self._sqlite_index.list_manifest_entries(agent_name=agent_name, status=None)}
        expired_ids: list[str] = []
        for row in rows:
            if str(row.get("status") or "").strip().lower() not in {"active", "pending", "contested"}:
                continue
            metadata = row.get("metadata") if isinstance(row.get("metadata"), dict) else {}
            if not self._is_expired(metadata):
                continue
            expired_ids.append(str(row.get("memory_id") or ""))

        if not expired_ids:
            return {"expired": 0}

        with self._sqlite_index.transaction() as conn:
            for memory_id in expired_ids:
                if not memory_id:
                    continue
                self._sqlite_index.set_resource_status(
                    agent_name=agent_name,
                    memory_id=memory_id,
                    status="archived",
                    conn=conn,
                )
                manifest = manifest_map.get(memory_id)
                if manifest is not None:
                    metadata = manifest.get("metadata") if isinstance(manifest.get("metadata"), dict) else {}
                    metadata["decision_reason"] = "ttl_expired_auto_archive"
                    self._sqlite_index.upsert_manifest_entry(
                        agent_name=agent_name,
                        memory_id=memory_id,
                        content=str(manifest.get("content") or ""),
                        status="archived",
                        source_thread_id=str(manifest.get("source_thread_id") or ""),
                        metadata=metadata,
                        last_action="UPDATE",
                        conn=conn,
                    )
        return {"expired": len(expired_ids)}

    def _semantic_compact_episodes(self, *, agent_name: str | None = None) -> dict[str, Any]:
        rows = self._sqlite_index.list_resources(agent_name=agent_name, status="active")
        manifest_map = {str(entry.get("memory_id") or ""): entry for entry in self._sqlite_index.list_manifest_entries(agent_name=agent_name, status=None)}
        groups: dict[tuple[str, str], list[dict[str, Any]]] = {}
        for row in rows:
            metadata = row.get("metadata") if isinstance(row.get("metadata"), dict) else {}
            tier = self._memory_tier(metadata)
            if tier != "episode":
                continue
            if self._is_expired(metadata):
                continue
            created_at = str(row.get("created_at") or "")
            day_key = created_at[:10] if len(created_at) >= 10 else "unknown-day"
            thread_key = str(row.get("source_thread_id") or "global-thread") or "global-thread"
            groups.setdefault((day_key, thread_key), []).append(row)

        created_cards = 0
        archived_items = 0
        now = _utc_iso()
        for (day_key, thread_key), entries in groups.items():
            if len(entries) < 3:
                continue

            sorted_entries = sorted(entries, key=lambda item: str(item.get("updated_at") or ""))
            merged_summary = self._build_story_card_from_entries(day_key=day_key, entries=sorted_entries)
            if not merged_summary.strip():
                continue

            card_id = hashlib.sha1(f"{agent_name or 'global'}:episode-card:{day_key}:{thread_key}:{merged_summary}".encode()).hexdigest()[:20]
            refs = [str(item.get("memory_id") or "") for item in sorted_entries]
            self._sqlite_index.upsert_manifest_entry(
                agent_name=agent_name,
                memory_id=card_id,
                content=merged_summary,
                status="active",
                source_thread_id=thread_key,
                metadata={
                    "source": "semantic_compact",
                    "tier": "episode",
                    "quality_score": 0.79,
                    "decision_reason": "semantic_episode_compaction",
                    "retention_policy": "mid_term_180d",
                    "ttl_seconds": 180 * 24 * 3600,
                    "expires_at": (datetime.now(UTC) + timedelta(days=180)).isoformat().replace("+00:00", "Z"),
                    "evidence": {"source_memory_ids": refs},
                },
                last_action="ADD",
            )
            self._sqlite_index.upsert_resource(
                agent_name=agent_name,
                memory_id=card_id,
                uri=f"viking://manifest/{card_id}",
                summary=merged_summary,
                source_thread_id=thread_key,
                score=0.79,
                status="active",
                metadata={
                    "source": "semantic_compact",
                    "tier": "episode",
                    "quality_score": 0.79,
                    "decision_reason": "semantic_episode_compaction",
                    "retention_policy": "mid_term_180d",
                    "ttl_seconds": 180 * 24 * 3600,
                    "expires_at": (datetime.now(UTC) + timedelta(days=180)).isoformat().replace("+00:00", "Z"),
                    "evidence": {"source_memory_ids": refs},
                },
            )
            created_cards += 1

            with self._sqlite_index.transaction() as conn:
                for item in sorted_entries:
                    memory_id = str(item.get("memory_id") or "")
                    if not memory_id or memory_id == card_id:
                        continue
                    self._sqlite_index.set_resource_status(
                        agent_name=agent_name,
                        memory_id=memory_id,
                        status="archived",
                        conn=conn,
                    )
                    manifest = manifest_map.get(memory_id)
                    if manifest is not None:
                        manifest_meta = manifest.get("metadata") if isinstance(manifest.get("metadata"), dict) else {}
                        manifest_meta["decision_reason"] = "semantic_episode_compaction_archived"
                        manifest_meta["compacted_into"] = card_id
                        self._sqlite_index.upsert_manifest_entry(
                            agent_name=agent_name,
                            memory_id=memory_id,
                            content=str(manifest.get("content") or ""),
                            status="archived",
                            source_thread_id=str(manifest.get("source_thread_id") or ""),
                            metadata=manifest_meta,
                            last_action="UPDATE",
                            conn=conn,
                        )
                        archived_items += 1

        if created_cards > 0:
            self._refresh_vectors_and_graph_from_manifest(agent_name=agent_name)
        return {"created_cards": created_cards, "archived_items": archived_items, "timestamp": now}

    @staticmethod
    def _build_story_card_from_entries(*, day_key: str, entries: list[dict[str, Any]]) -> str:
        facts = [str(item.get("summary") or "").strip() for item in entries if str(item.get("summary") or "").strip()]
        if not facts:
            return ""
        merged_text = "；".join(facts[:6])
        entities = re.findall(r"[A-Za-z0-9_\-/+.]{2,}|[\u4e00-\u9fff]{2,}", merged_text)
        unique_entities: list[str] = []
        for entity in entities:
            if entity in unique_entities:
                continue
            unique_entities.append(entity)
            if len(unique_entities) >= 8:
                break
        entity_line = ", ".join(unique_entities) if unique_entities else "-"
        issue_resolution = "contains_issue_resolution" if any(keyword in merged_text.lower() for keyword in ("问题", "报错", "error", "失败", "冲突", "修复", "解决")) else "-"
        return f"when: {day_key}\ntask: merged_episode_story\nkey_entities: {entity_line}\nactions: {merged_text[:360]}\nissue_resolution: {issue_resolution}\noutcome: compacted_story_card\nfollowup: -"

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------
    @staticmethod
    def _normalize_agent_name(agent_name: str | None) -> str | None:
        """Normalize runtime agent_name for memory scoping.

        Contract:
        - None/empty -> None
        - Reserved default agent name ("_default") -> None (global)
        - Otherwise keep trimmed name

        This is intentionally aligned with src.agents.memory.scope to ensure the
        default agent never creates an agent-scoped ledger/index.
        """

        return normalize_agent_name_for_memory(agent_name)

    def _scope_name(self, agent_name: str | None) -> str:
        normalized = self._normalize_agent_name(agent_name)
        return f"agent:{normalized}" if normalized else "global"

    def _resolve_scope_agent(self, *, scope: str, agent_name: str | None) -> str | None:
        # NOTE: keep backward-compatible behavior: empty/None scope means "global".
        normalized_scope = (scope or "global").strip().lower() or "global"
        try:
            return resolve_agent_for_memory_scope(scope=normalized_scope, agent_name=agent_name)
        except ValueError as exc:
            # Preserve the older error shape for callers that bubble this up directly.
            raise ValueError(str(exc)) from exc

    def _set_last_fallback_reason(self, *, agent_name: str | None, reason: str) -> None:
        self._last_fallback_reason[self._scope_name(agent_name)] = reason

    def _rrf_fusion(
        self,
        *,
        dense_hits: list[dict[str, Any]],
        sparse_hits: list[dict[str, Any]],
        limit: int,
        k: int = 60,
    ) -> list[dict[str, Any]]:
        by_id: dict[str, dict[str, Any]] = {}

        def _merge(source: str, rows: list[dict[str, Any]]) -> None:
            for rank, row in enumerate(rows, start=1):
                memory_id = str(row.get("id") or row.get("memory_id") or "").strip()
                if not memory_id:
                    continue
                entry = by_id.setdefault(
                    memory_id,
                    {
                        "memory_id": memory_id,
                        "content": str(row.get("abstract") or row.get("memory") or row.get("content") or ""),
                        "sources": [],
                        "score": 0.0,
                    },
                )
                entry["score"] = float(entry["score"]) + (1.0 / (k + rank))
                sources = entry.get("sources")
                if isinstance(sources, list) and source not in sources:
                    sources.append(source)

        _merge("dense", dense_hits)
        _merge("sparse", sparse_hits)
        items = sorted(by_id.values(), key=lambda item: float(item.get("score") or 0.0), reverse=True)
        return items[: max(1, int(limit))]

    def _refresh_vectors_and_graph_from_manifest(self, *, agent_name: str | None) -> None:
        entries = self._sqlite_index.list_manifest_entries(agent_name=agent_name, status="active")
        self._sqlite_index.clear_vectors(agent_name=agent_name)
        if get_memory_config().graph_enabled:
            self._sqlite_index.clear_graph(agent_name=agent_name)

        configured, model_name = self._resolve_local_embedding_model()
        vector_ready = bool(configured and model_name)
        if vector_ready and model_name:
            health_ok, _ = self._check_embedding_health(model_name)
            vector_ready = health_ok

        for entry in entries:
            memory_id = str(entry.get("memory_id") or "")
            content = str(entry.get("content") or "")
            source_thread = str(entry.get("source_thread_id") or "")
            if not memory_id or not content:
                continue
            if vector_ready and model_name:
                vector = self._embed_text_local(content, model_name)
                if vector:
                    self._sqlite_index.upsert_vector(
                        agent_name=agent_name,
                        memory_id=memory_id,
                        thread_id=source_thread or "manifest",
                        content=content,
                        vector=vector,
                        metadata={"source": "manifest"},
                    )
            if get_memory_config().graph_enabled:
                self._sqlite_index.upsert_graph_from_text(
                    agent_name=agent_name,
                    memory_id=memory_id,
                    text=content,
                )

    def _record_search_results(self, *, query: str, results: list[dict[str, Any]], agent_name: str | None) -> None:
        source = f"find:{hashlib.sha1(query.encode('utf-8')).hexdigest()[:10]}"
        expires_at = (datetime.now(UTC) + timedelta(days=7)).isoformat().replace("+00:00", "Z")
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
                metadata={
                    "source": "openviking.find",
                    "tier": "trace",
                    "quality_score": max(0.0, min(1.0, score)),
                    "decision_reason": "retrieval_trace",
                    "retention_policy": "short_term_7d",
                    "ttl_seconds": 7 * 24 * 3600,
                    "expires_at": expires_at,
                },
                bump_usage=True,
            )

    def _resolve_local_embedding_model(self) -> tuple[bool, str | None]:
        cfg = get_memory_config()
        if (
            cfg.embedding_provider.strip().lower()
            in {
                "sentence-transformers",
                "sentence_transformers",
                "local",
            }
            and cfg.embedding_model.strip()
        ):
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
        should_rerank = rerank_mode == "forced" or (rerank_mode == "auto" and len(candidates) >= self._rerank_min_candidates and _is_ambiguous_query(query))
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
        vector_ready = bool(configured and model_name)
        if not vector_ready:
            self._set_last_fallback_reason(
                agent_name=agent_name,
                reason="local_embedding_not_configured",
            )
        else:
            health_ok, health_message = self._check_embedding_health(model_name)
            if not health_ok:
                vector_ready = False
                self._set_last_fallback_reason(
                    agent_name=agent_name,
                    reason=f"embedding_unhealthy:{health_message}",
                )

        for msg in messages:
            content = str(msg.get("content", "")).strip()
            role = str(msg.get("role", "")).strip().lower() or "assistant"
            if not content:
                continue
            memory_id = hashlib.sha1(f"{agent_name or 'global'}:{thread_id}:{role}:{content}".encode()).hexdigest()[:20]
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

            if not vector_ready or not model_name:
                continue
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

    def _write_graph_async(self, *, thread_id: str, messages: list[Any], agent_name: str | None) -> None:
        def _runner():
            try:
                self.write_memory_graph(
                    thread_id=thread_id,
                    messages=messages,
                    agent_name=agent_name,
                    chat_id=thread_id,
                    write_source="auto",
                    explicit_write=False,
                )
            except Exception as exc:  # noqa: BLE001
                logger.debug("OpenViking write graph skipped: %s", exc)

        threading.Thread(target=_runner, daemon=True).start()

    def _lock_for_scope(self, agent_name: str | None) -> threading.Lock:
        normalized_agent = self._normalize_agent_name(agent_name)
        scope = normalized_agent.lower() if normalized_agent else "global"
        with self._scope_locks_guard:
            lock = self._scope_locks.get(scope)
            if lock is None:
                lock = threading.Lock()
                self._scope_locks[scope] = lock
            return lock

    def _build_openviking_client(self, agent_name: str | None):
        agent_name = self._normalize_agent_name(agent_name)
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
