"""OpenViking-backed runtime.

This runtime mirrors Memoh-v2's two key behaviors:
1) before-chat semantic retrieval for context injection
2) after-chat session commit for long-term extraction

`structured-fs` is only used as an optional adapter layer for compatibility
views/maintenance when `openviking_mirror_structured=true`.
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
import threading
import time
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from src.agents.memory.core import MemoryReadRequest, MemoryWriteRequest
from src.agents.memory.queue import get_memory_queue
from src.agents.memory.sqlite_index import OpenVikingSQLiteIndex
from src.agents.memory.structured_runtime import StructuredFsRuntime
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


def _is_location_dependent_query(query: str) -> bool:
    normalized = query.strip().lower()
    if not normalized:
        return False
    keywords = (
        "城市",
        "地区",
        "位置",
        "所在地",
        "在哪",
        "哪里",
        "哪儿",
        "天气",
        "气温",
        "温度",
        "下雨",
        "降雨",
        "湿度",
        "风力",
        "weather",
        "forecast",
        "temperature",
        "rain",
        "wind",
    )
    return any(keyword in normalized for keyword in keywords)


def _looks_like_location_fact(content: str, category: str | None = None) -> bool:
    _ = category
    lowered = content.strip().lower()
    if not lowered:
        return False
    location_keywords = (
        "城市",
        "位置",
        "所在地",
        "居住",
        "住在",
        "来自",
        "地区",
        "省份",
        "location",
        "city",
        "province",
        "region",
        "based in",
        "live in",
        "from ",
    )
    return any(keyword in lowered for keyword in location_keywords)


class OpenVikingRuntime:
    """OpenViking runtime with deterministic adapter behavior for Nion."""

    def __init__(self):
        self._paths = get_paths()
        self._structured = StructuredFsRuntime()
        self._sqlite_index = OpenVikingSQLiteIndex(self._paths.openviking_index_db)
        self._scope_locks: dict[str, threading.Lock] = {}
        self._scope_locks_guard = threading.Lock()
        self._embedding_model_cache: dict[str, Any] = {}
        self._embedding_guard = threading.Lock()
        self._embedding_health_cache: dict[str, tuple[bool, str, float]] = {}
        self._last_fallback_reason: dict[str, str] = {}
        self._rerank_min_candidates = 6
        self._rerank_overfetch_ratio = 3

    def __getattr__(self, name: str):
        # Keep maintenance APIs and legacy callers compatible.
        return getattr(self._structured, name)

    # ------------------------------------------------------------------
    # MemoryRuntime protocol (compatibility surface used by provider/updater)
    # ------------------------------------------------------------------
    def get_memory_data(self, request: MemoryReadRequest) -> dict[str, Any]:
        return self._structured.get_memory_data(request)

    def reload_memory_data(self, request: MemoryReadRequest) -> dict[str, Any]:
        return self._structured.reload_memory_data(request)

    def queue_update(self, request: MemoryWriteRequest) -> None:
        config = get_memory_config()
        if config.openviking_session_commit_enabled:
            # OpenViking session commit is asynchronous and best-effort.
            self._commit_session_async(
                thread_id=request.thread_id,
                messages=request.messages,
                agent_name=request.agent_name,
            )
        if config.openviking_mirror_structured:
            # Optional compatibility mirror only.
            get_memory_queue().add(
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
        return self._structured.save_memory_data(
            memory_data,
            agent_name=agent_name,
            thread_id=thread_id,
        )

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
                return results
        except Exception as exc:  # noqa: BLE001
            self._set_last_fallback_reason(
                agent_name=agent_name,
                reason=f"openviking_find_error: {exc}",
            )
            logger.debug("OpenViking find failed: %s", exc)
        # Read fallback: keep old structured memory retrievable during migration/cutover.
        # This keeps user profile context (e.g. city/location) available before OpenViking
        # index is fully populated.
        if config.openviking_mirror_structured or config.fallback_to_v1:
            fallback = self._search_structured_memory(query=query, limit=limit, agent_name=agent_name)
            if fallback:
                self._set_last_fallback_reason(agent_name=agent_name, reason="fallback_structured_memory")
                return fallback
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
        if get_memory_config().openviking_mirror_structured:
            memory_data = self._structured.get_memory_data(MemoryReadRequest(agent_name=agent_name))
            facts = list(memory_data.get("facts") or [])
            facts.append(
                {
                    "id": fact_id,
                    "content": text,
                    "category": "openviking",
                    "confidence": max(0.0, min(1.0, float(confidence))),
                    "createdAt": now,
                    "source": source or thread,
                    "status": "active",
                    "metadata": metadata or {},
                }
            )
            memory_data["facts"] = facts
            self._structured.save_memory_data(memory_data, agent_name=agent_name, thread_id=thread)
        return {
            "id": fact_id,
            "thread_id": thread,
            "stored_at": now,
            "scope": f"agent:{agent_name}" if agent_name else "global",
            "commit_status": commit_result.get("status"),
        }

    def compact_memory(self, *, ratio: float = 0.8, scope: str = "global", agent_name: str | None = None) -> dict[str, Any]:
        if not get_memory_config().openviking_mirror_structured:
            return {
                "status": "skipped",
                "reason": "openviking_compact_not_supported_without_structured_mirror",
                "ratio": ratio,
                "scope": f"agent:{agent_name}" if agent_name else "global",
            }
        resolved_scope = self._structured._resolve_scope_arg(scope=scope, agent_name=agent_name)
        manifest = self._structured._read_manifest(resolved_scope)

        active = [entry for entry in manifest.entries if entry.status == "active"]
        if not active:
            return {"before_count": 0, "after_count": 0, "removed_count": 0, "ratio": ratio}

        bounded_ratio = max(0.1, min(1.0, float(ratio)))
        target_count = max(1, int(round(len(active) * bounded_ratio)))
        active_sorted = sorted(
            active,
            key=lambda item: (item.last_used_at or item.updated_at or item.created_at),
            reverse=True,
        )
        keep_ids = {entry.memory_id for entry in active_sorted[:target_count]}

        removed_count = 0
        for entry in manifest.entries:
            if entry.status != "active":
                continue
            if entry.memory_id in keep_ids:
                continue
            entry.status = "archived"
            entry.updated_at = _utc_iso()
            removed_count += 1

        self._structured._write_manifest(manifest, resolved_scope)
        self._structured._write_overview(resolved_scope, manifest)
        self._structured._write_graph_index(resolved_scope, manifest)
        self._structured._cache.pop(resolved_scope, None)

        return {
            "before_count": len(active),
            "after_count": len(active) - removed_count,
            "removed_count": removed_count,
            "ratio": bounded_ratio,
            "scope": resolved_scope,
        }

    def forget_memory(self, *, memory_id: str, scope: str = "global", agent_name: str | None = None) -> dict[str, Any]:
        target_id = memory_id.strip()
        if not target_id:
            raise ValueError("memory_id is required")
        if not get_memory_config().openviking_mirror_structured:
            return {
                "status": "skipped",
                "reason": "openviking_forget_not_supported_without_structured_mirror",
                "memory_id": target_id,
                "scope": f"agent:{agent_name}" if agent_name else "global",
            }

        resolved_scope = self._structured._resolve_scope_arg(scope=scope, agent_name=agent_name)
        manifest = self._structured._read_manifest(resolved_scope)
        updated = False
        for entry in manifest.entries:
            if entry.memory_id != target_id:
                continue
            entry.status = "archived"
            entry.updated_at = _utc_iso()
            updated = True

        if updated:
            self._structured._write_manifest(manifest, resolved_scope)
            self._structured._write_overview(resolved_scope, manifest)
            self._structured._write_graph_index(resolved_scope, manifest)
            self._structured._cache.pop(resolved_scope, None)

        return {"memory_id": target_id, "updated": updated, "scope": resolved_scope}

    def migrate_from_structured(self, *, include_agents: bool = True) -> dict[str, Any]:
        """Idempotent migration by replaying facts into OpenViking sessions."""
        migrated = 0
        skipped = 0
        failures: list[dict[str, str]] = []

        scopes: list[tuple[str | None, str]] = [(None, "global")]
        if include_agents:
            agents_dir = self._paths.agents_dir
            if agents_dir.exists():
                for agent_dir in agents_dir.iterdir():
                    if agent_dir.is_dir():
                        scopes.append((agent_dir.name, f"agent:{agent_dir.name}"))

        for agent_name, scope_name in scopes:
            data = self._structured.get_memory_data(MemoryReadRequest(agent_name=agent_name))
            facts = data.get("facts") or []
            for fact in facts:
                fact_id = str(fact.get("id", "")).strip()
                if not fact_id:
                    skipped += 1
                    continue
                if str(fact.get("category", "")).strip().lower() == "openviking":
                    skipped += 1
                    continue
                text = str(fact.get("content", "")).strip()
                if not text:
                    skipped += 1
                    continue
                source_thread = str(fact.get("source", "")).strip() or f"migration-{scope_name}"
                try:
                    self.commit_session(
                        thread_id=f"{source_thread}-migrate",
                        messages=[{"role": "user", "content": text}],
                        agent_name=agent_name,
                    )
                    migrated += 1
                except Exception as exc:  # noqa: BLE001
                    failures.append({"scope": scope_name, "fact_id": fact_id, "error": str(exc)})

        return {
            "migrated_count": migrated,
            "skipped_count": skipped,
            "failed_count": len(failures),
            "failures": failures,
            "completed_at": _utc_iso(),
        }

    def get_retrieval_status(self, *, agent_name: str | None = None) -> dict[str, Any]:
        config = get_memory_config()
        embedding_configured, embedding_model = self._resolve_local_embedding_model()
        health_ok = False
        health_message = "local_embedding_not_configured"
        if embedding_configured and embedding_model:
            health_ok, health_message = self._check_embedding_health(embedding_model)
        index_count = self._sqlite_index.vector_count(agent_name=agent_name)
        scope = f"agent:{agent_name}" if agent_name else "global"
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
            data = self._structured.get_memory_data(MemoryReadRequest(agent_name=scoped_agent))
            for fact in data.get("facts") or []:
                memory_id = str(fact.get("id", "")).strip()
                content = str(fact.get("content", "")).strip()
                if not memory_id or not content:
                    continue
                vector = self._embed_text_local(content, embedding_model)
                if not vector:
                    continue
                thread_id = str(fact.get("source", "")).strip() or "reindex"
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
                session = client.session(thread_id)
                session.load()
                try:
                    from openviking.message import Part  # type: ignore
                except Exception as exc:  # noqa: BLE001
                    raise RuntimeError(f"OpenViking Part import failed: {exc}") from exc

                for msg in normalized_messages:
                    session.add_message(msg["role"], [Part.text(msg["content"])])
                result = session.commit()
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
            finally:
                close_fn = getattr(client, "close", None)
                if callable(close_fn):
                    close_fn()

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------
    def _scope_name(self, agent_name: str | None) -> str:
        return f"agent:{agent_name}" if agent_name else "global"

    def _set_last_fallback_reason(self, *, agent_name: str | None, reason: str) -> None:
        self._last_fallback_reason[self._scope_name(agent_name)] = reason

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
                    # Keep vector results even if rerank fails under forced mode.
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
        client = ov.SyncOpenViking(path=str(data_dir), config_file=str(conf_file))
        client.initialize()
        return client

    def _ensure_openviking_scope(self, agent_name: str | None) -> tuple[Path, Path]:
        data_dir = self._paths.openviking_data_dir(agent_name)
        conf_file = self._paths.openviking_config_file(agent_name)
        data_dir.mkdir(parents=True, exist_ok=True)
        conf_file.parent.mkdir(parents=True, exist_ok=True)

        if not conf_file.exists():
            cfg = get_memory_config()
            default_conf = {
                "embedding": {
                    "dense": {
                        "provider": "openai",
                        "model": cfg.embedding_model or "text-embedding-3-small",
                        "api_key": cfg.embedding_api_key or "$OPENAI_API_KEY",
                        "api_base": "",
                    }
                },
                "vlm": {
                    "provider": "openai",
                    "model": cfg.model_name or "",
                    "api_key": "$OPENAI_API_KEY",
                    "api_base": "",
                },
            }
            conf_file.write_text(json.dumps(default_conf, indent=2, ensure_ascii=False), encoding="utf-8")
        return data_dir, conf_file

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

    def _search_structured_memory(self, *, query: str, limit: int, agent_name: str | None) -> list[dict[str, Any]]:
        data = self._structured.get_memory_data(MemoryReadRequest(agent_name=agent_name))
        facts = data.get("facts") or []
        needle = query.strip().lower()
        if not needle:
            return []
        query_tokens = _tokenize(needle)
        scored: list[tuple[float, dict[str, Any]]] = []
        for fact in facts:
            content = str(fact.get("content", "")).strip()
            if not content:
                continue
            lowered = content.lower()
            confidence = float(fact.get("confidence", 0.5) or 0.5)
            relevance_score = 0.0
            if needle in lowered:
                relevance_score += 0.65
            if query_tokens:
                doc_tokens = _tokenize(lowered)
                overlap = len(query_tokens & doc_tokens) / max(1, len(query_tokens))
                relevance_score += overlap * 0.35
            if relevance_score <= 0:
                continue
            score = min(1.0, relevance_score + min(0.2, confidence * 0.2))
            scored.append(
                (
                    score,
                    {
                        "id": str(fact.get("id", "")),
                        "uri": "viking://session/memory",
                        "score": score,
                        "abstract": content,
                        "memory": content,
                        "source": fact.get("source", ""),
                    },
                )
            )
        if not scored and _is_location_dependent_query(query):
            location_scored: list[tuple[float, dict[str, Any]]] = []
            for fact in facts:
                content = str(fact.get("content", "")).strip()
                if not content:
                    continue
                category = str(fact.get("category", "") or "")
                if not _looks_like_location_fact(content, category):
                    continue
                confidence = float(fact.get("confidence", 0.5) or 0.5)
                score = min(1.0, 0.45 + confidence * 0.25)
                location_scored.append(
                    (
                        score,
                        {
                            "id": str(fact.get("id", "")),
                            "uri": "viking://session/memory",
                            "score": score,
                            "abstract": content,
                            "memory": content,
                            "source": fact.get("source", ""),
                        },
                    )
                )
            scored.extend(location_scored)
        scored.sort(key=lambda item: item[0], reverse=True)
        return [item for _, item in scored[: max(1, limit)]]

    def _normalize_messages(self, messages: list[Any]) -> list[dict[str, str]]:
        normalized: list[dict[str, str]] = []
        for msg in messages:
            role = _normalize_role(getattr(msg, "type", None) or getattr(msg, "role", None))
            content = getattr(msg, "content", msg)
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
