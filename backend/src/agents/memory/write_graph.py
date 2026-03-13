"""LangGraph memory write pipeline (quality-tiered memory extraction)."""

from __future__ import annotations

import hashlib
import re
import uuid
from datetime import UTC, datetime
from difflib import SequenceMatcher
from typing import Any, Literal, TypedDict

from langgraph.graph import END, StateGraph


def _utc_iso() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


class MemoryWriteAction(TypedDict, total=False):
    action: Literal["ADD", "UPDATE", "DELETE"]
    memory_id: str
    content: str
    reason: str
    target_status: Literal["active", "pending", "contested", "archived"]
    tier: Literal["profile", "preference", "episode", "trace"]
    source: Literal["auto", "tool"]
    quality_score: float
    retention_policy: str
    ttl_seconds: int | None
    evidence: dict[str, Any]


class MemoryCandidate(TypedDict, total=False):
    candidate_id: str
    role: Literal["user", "assistant"]
    tier: Literal["profile", "preference", "episode", "trace"]
    source: Literal["auto", "tool"]
    quality_score: float
    raw_text: str
    content: str
    reason: str
    retention_policy: str
    ttl_seconds: int | None
    expires_at: str | None
    entities: list[str]


class MemorySkippedCandidate(TypedDict, total=False):
    candidate_id: str
    tier: str
    reason: str
    quality_score: float
    matched_memory_id: str
    matched_similarity: float


class MemoryWriteGraphState(TypedDict, total=False):
    thread_id: str
    chat_id: str
    trace_id: str
    agent_name: str | None
    write_source: Literal["auto", "tool"]
    explicit_write: bool
    raw_messages: list[Any]
    normalized_messages: list[dict[str, str]]
    extracted_candidates: list[MemoryCandidate]
    retrieval_by_candidate: dict[str, dict[str, Any]]
    actions: list[MemoryWriteAction]
    skipped_candidates: list[MemorySkippedCandidate]
    applied_results: list[dict[str, Any]]
    manifest_revision: int
    route_taken: str
    fallback_reason: str


class MemoryWriteGraph:
    """Structured write graph aligned with memoh-v2 style action pipeline."""

    def __init__(self, runtime: Any):
        self._runtime = runtime
        graph: StateGraph[MemoryWriteGraphState] = StateGraph(MemoryWriteGraphState)
        graph.add_node("ingest", self._node_ingest)
        graph.add_node("extract", self._node_extract)
        graph.add_node("retrieve_candidates", self._node_retrieve_candidates)
        graph.add_node("decide", self._node_decide)
        graph.add_node("apply_actions", self._node_apply_actions)
        graph.add_node("persist_manifest", self._node_persist_manifest)
        graph.add_node("reindex", self._node_reindex)
        graph.add_node("emit_trace", self._node_emit_trace)

        graph.set_entry_point("ingest")
        graph.add_edge("ingest", "extract")
        graph.add_edge("extract", "retrieve_candidates")
        graph.add_edge("retrieve_candidates", "decide")
        graph.add_edge("decide", "apply_actions")
        graph.add_edge("apply_actions", "persist_manifest")
        graph.add_edge("persist_manifest", "reindex")
        graph.add_edge("reindex", "emit_trace")
        graph.add_edge("emit_trace", END)
        self._compiled = graph.compile()

    def invoke(
        self,
        *,
        thread_id: str,
        messages: list[Any],
        agent_name: str | None = None,
        write_source: Literal["auto", "tool"] = "auto",
        explicit_write: bool = False,
        trace_id: str | None = None,
        chat_id: str | None = None,
    ) -> dict[str, Any]:
        final_state = self._compiled.invoke(
            MemoryWriteGraphState(
                thread_id=thread_id,
                chat_id=chat_id or thread_id,
                trace_id=trace_id or uuid.uuid4().hex[:12],
                agent_name=agent_name,
                write_source=write_source,
                explicit_write=explicit_write,
                raw_messages=messages,
            )
        )
        return {
            "trace_id": final_state.get("trace_id", ""),
            "chat_id": final_state.get("chat_id", ""),
            "actions": final_state.get("actions", []),
            "skipped_candidates": final_state.get("skipped_candidates", []),
            "applied_results": final_state.get("applied_results", []),
            "manifest_revision": int(final_state.get("manifest_revision") or 0),
            "route_taken": final_state.get("route_taken", ""),
            "fallback_reason": final_state.get("fallback_reason", ""),
        }

    # ------------------------------------------------------------------
    # Nodes
    # ------------------------------------------------------------------
    def _node_ingest(self, state: MemoryWriteGraphState) -> MemoryWriteGraphState:
        normalized: list[dict[str, str]] = []
        for msg in state.get("raw_messages", []):
            if isinstance(msg, dict):
                role = self._normalize_role(msg.get("role") or msg.get("type"))
                content = self._extract_text(msg.get("content"))
            else:
                role = self._normalize_role(getattr(msg, "role", None) or getattr(msg, "type", None))
                content = self._extract_text(getattr(msg, "content", ""))
            if not content:
                continue
            normalized.append({"role": role, "content": content})
        self._emit_step(state, "Ingest", {"message_count": len(normalized)})
        return {"normalized_messages": normalized}

    def _node_extract(self, state: MemoryWriteGraphState) -> MemoryWriteGraphState:
        extracted: list[MemoryCandidate] = []
        write_source = state.get("write_source") or "auto"
        explicit_write = bool(state.get("explicit_write"))
        now = _utc_iso()

        for row in state.get("normalized_messages", []):
            text = str(row.get("content") or "").strip()
            if not text:
                continue
            role = str(row.get("role") or "")
            if role == "user":
                candidate = self._build_user_candidate(
                    text=text,
                    write_source=write_source,
                    explicit_write=explicit_write,
                    now=now,
                )
                if candidate is not None:
                    extracted.append(candidate)
                continue

            # Assistant content only participates when it carries durable outcomes.
            if role == "assistant":
                candidate = self._build_assistant_candidate(
                    text=text,
                    write_source=write_source,
                    explicit_write=explicit_write,
                    now=now,
                )
                if candidate is not None:
                    extracted.append(candidate)

        candidates = self._dedupe_candidates(extracted)[-8:]
        self._emit_step(
            state,
            "Extract",
            {
                "candidate_count": len(candidates),
                "tiers": [candidate.get("tier") for candidate in candidates],
            },
        )
        return {"extracted_candidates": candidates}

    def _node_retrieve_candidates(self, state: MemoryWriteGraphState) -> MemoryWriteGraphState:
        retrieval_by_candidate: dict[str, dict[str, Any]] = {}
        route_taken: list[str] = []
        fallback_reason = ""

        candidates = state.get("extracted_candidates", [])
        if not candidates:
            return {
                "retrieval_by_candidate": {},
                "route_taken": "none",
                "fallback_reason": "no_extracted_candidates",
            }

        for candidate in candidates:
            candidate_id = str(candidate.get("candidate_id") or "")
            query = str(candidate.get("content") or "").strip()
            if not candidate_id or not query:
                continue
            retrieval = self._runtime.explain_query(
                query=query,
                limit=8,
                agent_name=state.get("agent_name"),
            )
            retrieval_by_candidate[candidate_id] = retrieval
            route_taken.append(str(retrieval.get("route_taken") or "none"))
            fallback_reason = str(retrieval.get("fallback_reason") or fallback_reason)

        self._emit_step(
            state,
            "RetrieveCandidates",
            {
                "candidate_count": len(retrieval_by_candidate),
                "route_taken": sorted(set(route_taken)),
            },
        )
        return {
            "retrieval_by_candidate": retrieval_by_candidate,
            "route_taken": ",".join(sorted(set(route_taken))) if route_taken else "none",
            "fallback_reason": fallback_reason,
        }

    def _node_decide(self, state: MemoryWriteGraphState) -> MemoryWriteGraphState:
        actions: list[MemoryWriteAction] = []
        skipped: list[MemorySkippedCandidate] = []
        retrieval_by_candidate = state.get("retrieval_by_candidate") or {}
        explicit_write = bool(state.get("explicit_write"))

        for candidate in state.get("extracted_candidates", []):
            candidate_id = str(candidate.get("candidate_id") or "")
            content = str(candidate.get("content") or "").strip()
            tier = str(candidate.get("tier") or "episode")
            source = str(candidate.get("source") or "auto")
            quality_score = float(candidate.get("quality_score") or 0.0)
            retention_policy = str(candidate.get("retention_policy") or "")
            ttl_seconds = candidate.get("ttl_seconds")
            expires_at = candidate.get("expires_at")
            if not content:
                continue

            if explicit_write:
                quality_score = min(0.99, max(quality_score, 0.9))

            lowered = content.lower()
            retrieval = retrieval_by_candidate.get(candidate_id, {})
            fusion_hits = retrieval.get("fusion_hits") or []
            best_hit, similarity = self._best_hit_for_candidate(content, fusion_hits)
            best_id = str((best_hit or {}).get("memory_id") or "")
            best_content = str((best_hit or {}).get("content") or "")

            if lowered.startswith("delete:") or lowered.startswith("forget:"):
                memory_id = best_id or self._memory_id_for_candidate(state, tier=tier, content=content)
                actions.append(
                    MemoryWriteAction(
                        action="DELETE",
                        memory_id=memory_id,
                        reason="explicit_delete_intent",
                        tier=tier,  # type: ignore[typeddict-item]
                        source=source,  # type: ignore[typeddict-item]
                        quality_score=quality_score,  # type: ignore[typeddict-item]
                        retention_policy=retention_policy,  # type: ignore[typeddict-item]
                        ttl_seconds=ttl_seconds if isinstance(ttl_seconds, int) else None,  # type: ignore[typeddict-item]
                        evidence={
                            "candidate_id": candidate_id,
                            "text": content,
                            "matched_memory": best_id,
                            "matched_similarity": round(similarity, 6),
                            "tier": tier,
                            "source": source,
                            "expires_at": expires_at,
                        },
                    )
                )
                continue

            duplicate_threshold, update_threshold, high_threshold, medium_threshold = self._tier_thresholds(tier)

            if best_id and similarity >= duplicate_threshold:
                skipped.append(
                    MemorySkippedCandidate(
                        candidate_id=candidate_id,
                        tier=tier,
                        reason="duplicate_existing_memory",
                        quality_score=quality_score,
                        matched_memory_id=best_id,
                        matched_similarity=round(similarity, 6),
                    )
                )
                continue

            has_conflict = bool(best_id) and self._is_conflict(tier=tier, incoming=content, existing=best_content)
            if best_id and similarity >= update_threshold and tier in {"profile", "preference"} and not has_conflict:
                actions.append(
                    MemoryWriteAction(
                        action="UPDATE",
                        memory_id=best_id,
                        content=content,
                        reason="semantic_update",
                        target_status="active",  # type: ignore[typeddict-item]
                        tier=tier,  # type: ignore[typeddict-item]
                        source=source,  # type: ignore[typeddict-item]
                        quality_score=max(quality_score, 0.85),  # type: ignore[typeddict-item]
                        retention_policy=retention_policy,  # type: ignore[typeddict-item]
                        ttl_seconds=ttl_seconds if isinstance(ttl_seconds, int) else None,  # type: ignore[typeddict-item]
                        evidence={
                            "candidate_id": candidate_id,
                            "matched_memory_id": best_id,
                            "matched_similarity": round(similarity, 6),
                            "previous_content": best_content,
                            "tier": tier,
                            "source": source,
                            "decision_reason": "high_similarity_semantic_update",
                            "expires_at": expires_at,
                        },
                    )
                )
                continue

            if has_conflict and tier in {"profile", "preference"}:
                target_status: Literal["contested", "pending", "active"] = "contested"
                decision_reason = "conflicting_fact_requires_review"
            elif quality_score >= high_threshold:
                target_status = "active"
                decision_reason = "high_value_memory"
            elif quality_score >= medium_threshold:
                target_status = "pending"
                decision_reason = "medium_value_memory_pending_review"
            else:
                skipped.append(
                    MemorySkippedCandidate(
                        candidate_id=candidate_id,
                        tier=tier,
                        reason="low_value_memory",
                        quality_score=quality_score,
                        matched_memory_id=best_id,
                        matched_similarity=round(similarity, 6),
                    )
                )
                continue

            actions.append(
                MemoryWriteAction(
                    action="ADD",
                    memory_id=self._memory_id_for_candidate(state, tier=tier, content=content),
                    content=content,
                    reason=decision_reason,
                    target_status=target_status,  # type: ignore[typeddict-item]
                    tier=tier,  # type: ignore[typeddict-item]
                    source=source,  # type: ignore[typeddict-item]
                    quality_score=quality_score,  # type: ignore[typeddict-item]
                    retention_policy=retention_policy,  # type: ignore[typeddict-item]
                    ttl_seconds=ttl_seconds if isinstance(ttl_seconds, int) else None,  # type: ignore[typeddict-item]
                    evidence={
                        "candidate_id": candidate_id,
                        "matched_memory_id": best_id,
                        "matched_similarity": round(similarity, 6),
                        "tier": tier,
                        "source": source,
                        "decision_reason": decision_reason,
                        "quality_score": round(quality_score, 6),
                        "expires_at": expires_at,
                        "entities": candidate.get("entities") or [],
                    },
                )
            )

        self._emit_step(
            state,
            "Decide",
            {
                "action_count": len(actions),
                "skipped_count": len(skipped),
                "action_tiers": [action.get("tier") for action in actions],
            },
        )
        return {"actions": actions, "skipped_candidates": skipped}

    def _node_apply_actions(self, state: MemoryWriteGraphState) -> MemoryWriteGraphState:
        applied = self._runtime.apply_memory_actions(
            actions=state.get("actions", []),
            thread_id=state.get("thread_id", ""),
            agent_name=state.get("agent_name"),
            trace_id=state.get("trace_id"),
            chat_id=state.get("chat_id"),
        )
        self._emit_step(state, "ApplyActions", {"applied_count": len(applied)})
        return {"applied_results": applied}

    def _node_persist_manifest(self, state: MemoryWriteGraphState) -> MemoryWriteGraphState:
        revision = self._runtime.get_manifest_revision(agent_name=state.get("agent_name"))
        self._emit_step(state, "PersistManifest", {"manifest_revision": revision})
        return {"manifest_revision": revision}

    def _node_reindex(self, state: MemoryWriteGraphState) -> MemoryWriteGraphState:
        result = self._runtime.rebuild_from_manifest(agent_name=state.get("agent_name"))
        self._emit_step(state, "Reindex", result)
        return {}

    def _node_emit_trace(self, state: MemoryWriteGraphState) -> MemoryWriteGraphState:
        self._emit_step(
            state,
            "EmitTrace",
            {
                "trace_id": state.get("trace_id"),
                "chat_id": state.get("chat_id"),
                "action_count": len(state.get("actions") or []),
                "skipped_count": len(state.get("skipped_candidates") or []),
            },
        )
        return {}

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------
    def _emit_step(self, state: MemoryWriteGraphState, step: str, data: dict[str, Any]) -> None:
        if hasattr(self._runtime, "emit_processlog_event"):
            self._runtime.emit_processlog_event(
                trace_id=state.get("trace_id"),
                chat_id=state.get("chat_id"),
                step=step,
                level="info",
                duration_ms=0,
                data=data,
            )

    @staticmethod
    def _normalize_role(role: Any) -> str:
        value = str(role or "").strip().lower()
        if value in {"human", "user"}:
            return "user"
        if value in {"ai", "assistant"}:
            return "assistant"
        if value == "system":
            return "system"
        return "assistant"

    @classmethod
    def _extract_text(cls, content: Any) -> str:
        if isinstance(content, str):
            return content.strip()
        if isinstance(content, list):
            parts: list[str] = []
            for item in content:
                text = cls._extract_text(item)
                if text:
                    parts.append(text)
            return "\n".join(parts).strip()
        if isinstance(content, dict):
            for key in ("text", "content", "value", "output_text"):
                if key in content:
                    text = cls._extract_text(content.get(key))
                    if text:
                        return text
        return ""

    @staticmethod
    def _memory_id_for_candidate(
        state: MemoryWriteGraphState,
        *,
        tier: str,
        content: str,
    ) -> str:
        canonical = re.sub(r"\s+", " ", content.strip().lower())
        seed = f"{state.get('agent_name') or 'global'}:{tier}:{canonical}"
        return hashlib.sha1(seed.encode("utf-8")).hexdigest()[:20]

    @staticmethod
    def _contains_any(text: str, markers: tuple[str, ...]) -> bool:
        lowered = text.lower()
        return any(marker in lowered for marker in markers)

    def _build_user_candidate(
        self,
        *,
        text: str,
        write_source: Literal["auto", "tool"],
        explicit_write: bool,
        now: str,
    ) -> MemoryCandidate | None:
        normalized = self._normalize_sentence(text)
        if len(normalized) < 2:
            return None

        if explicit_write:
            tier = self._infer_tier(normalized)
            quality = 0.93
            reason = "explicit_memory_store"
        else:
            tier, quality, reason = self._classify_user_text(normalized)
            if quality < 0.45:
                return None

        content = normalized if tier != "episode" else self._build_episode_card(normalized, now)
        retention_policy, ttl_seconds, expires_at = self._retention_for_tier(tier, now)
        candidate_id = hashlib.sha1(f"user:{tier}:{normalized}".encode("utf-8")).hexdigest()[:16]
        return MemoryCandidate(
            candidate_id=candidate_id,
            role="user",
            tier=tier,
            source=write_source,
            quality_score=quality,
            raw_text=normalized,
            content=content,
            reason=reason,
            retention_policy=retention_policy,
            ttl_seconds=ttl_seconds,
            expires_at=expires_at,
            entities=self._extract_entities(normalized),
        )

    def _build_assistant_candidate(
        self,
        *,
        text: str,
        write_source: Literal["auto", "tool"],
        explicit_write: bool,
        now: str,
    ) -> MemoryCandidate | None:
        normalized = self._normalize_sentence(text)
        if len(normalized) < 6:
            return None

        if explicit_write:
            # Tool-triggered writes rely on user input as source of truth.
            return None

        if not self._looks_like_assistant_outcome(normalized):
            return None

        quality = 0.62
        content = self._build_episode_card(normalized, now)
        retention_policy, ttl_seconds, expires_at = self._retention_for_tier("episode", now)
        candidate_id = hashlib.sha1(f"assistant:episode:{normalized}".encode("utf-8")).hexdigest()[:16]
        return MemoryCandidate(
            candidate_id=candidate_id,
            role="assistant",
            tier="episode",
            source=write_source,
            quality_score=quality,
            raw_text=normalized,
            content=content,
            reason="assistant_outcome",
            retention_policy=retention_policy,
            ttl_seconds=ttl_seconds,
            expires_at=expires_at,
            entities=self._extract_entities(normalized),
        )

    def _dedupe_candidates(self, candidates: list[MemoryCandidate]) -> list[MemoryCandidate]:
        seen: dict[tuple[str, str], MemoryCandidate] = {}
        for candidate in candidates:
            tier = str(candidate.get("tier") or "episode")
            content = self._normalize_sentence(str(candidate.get("content") or ""))
            if not content:
                continue
            key = (tier, content)
            previous = seen.get(key)
            if previous is None:
                seen[key] = candidate
                continue
            if float(candidate.get("quality_score") or 0.0) > float(previous.get("quality_score") or 0.0):
                seen[key] = candidate
        return list(seen.values())

    def _best_hit_for_candidate(
        self,
        content: str,
        fusion_hits: list[dict[str, Any]],
    ) -> tuple[dict[str, Any] | None, float]:
        best_hit: dict[str, Any] | None = None
        best_similarity = 0.0
        for hit in fusion_hits:
            hit_content = str(hit.get("content") or "").strip()
            if not hit_content:
                continue
            similarity = self._normalized_similarity(content, hit_content)
            if similarity > best_similarity:
                best_similarity = similarity
                best_hit = hit
        return best_hit, best_similarity

    @staticmethod
    def _tier_thresholds(tier: str) -> tuple[float, float, float, float]:
        normalized = tier.strip().lower()
        if normalized == "profile":
            return (0.95, 0.62, 0.82, 0.65)
        if normalized == "preference":
            return (0.93, 0.58, 0.78, 0.6)
        if normalized == "episode":
            return (0.9, 0.76, 0.72, 0.55)
        return (0.9, 0.75, 0.7, 0.5)

    @staticmethod
    def _normalize_sentence(text: str) -> str:
        return re.sub(r"\s+", " ", text).strip()

    @staticmethod
    def _extract_entities(text: str, limit: int = 8) -> list[str]:
        tokens = re.findall(r"[A-Za-z0-9_\-/+.]{2,}|[\u4e00-\u9fff]{2,}", text)
        out: list[str] = []
        for token in tokens:
            if token in out:
                continue
            out.append(token)
            if len(out) >= limit:
                break
        return out

    def _classify_user_text(self, text: str) -> tuple[str, float, str]:
        profile_markers = (
            "我叫",
            "我的名字",
            "姓名",
            "name is",
            "i am",
            "籍贯",
            "来自",
            "身份证",
            "证件号",
            "手机号",
            "电话",
            "邮箱",
            "住在",
            "定居",
        )
        preference_markers = (
            "喜欢",
            "不喜欢",
            "偏好",
            "习惯",
            "常用",
            "prefer",
            "favorite",
            "usually",
        )
        episode_markers = (
            "完成",
            "已完成",
            "买",
            "购买",
            "订",
            "预订",
            "下单",
            "排查",
            "修复",
            "提交",
            "部署",
            "处理",
            "遇到",
            "问题",
        )

        if self._contains_any(text, profile_markers):
            return ("profile", 0.95, "user_profile_fact")
        if self._contains_any(text, preference_markers):
            return ("preference", 0.84, "user_preference_fact")
        if self._contains_any(text, episode_markers):
            return ("episode", 0.74, "user_episode_signal")
        return ("trace", 0.38, "low_information_density")

    def _infer_tier(self, text: str) -> Literal["profile", "preference", "episode", "trace"]:
        tier, _, _ = self._classify_user_text(text)
        if tier in {"profile", "preference", "episode", "trace"}:
            return tier
        return "episode"

    def _looks_like_assistant_outcome(self, text: str) -> bool:
        markers = (
            "已完成",
            "已经完成",
            "处理完成",
            "已处理",
            "执行成功",
            "执行失败",
            "结果",
            "总结",
            "记住了",
            "已记录",
            "已保存",
            "completed",
            "done",
            "resolved",
        )
        if not self._contains_any(text, markers):
            return False
        if len(text) > 600:
            return False
        return True

    def _build_episode_card(self, text: str, when: str) -> str:
        entities = self._extract_entities(text, limit=6)
        task = self._truncate_sentence(text, 72)
        actions = self._truncate_sentence(text, 180)
        issue_resolution = self._extract_issue_resolution(text)
        outcome = self._extract_outcome(text)
        followup = self._extract_followup(text)
        entity_line = ", ".join(entities) if entities else "-"
        return (
            f"when: {when}\n"
            f"task: {task}\n"
            f"key_entities: {entity_line}\n"
            f"actions: {actions}\n"
            f"issue_resolution: {issue_resolution}\n"
            f"outcome: {outcome}\n"
            f"followup: {followup}"
        )

    @staticmethod
    def _truncate_sentence(text: str, limit: int) -> str:
        normalized = re.sub(r"\s+", " ", text).strip()
        if len(normalized) <= limit:
            return normalized
        return f"{normalized[: max(0, limit - 1)].rstrip()}…"

    def _extract_issue_resolution(self, text: str) -> str:
        lowered = text.lower()
        if any(keyword in lowered for keyword in ("报错", "错误", "failed", "error", "异常", "问题", "冲突")):
            return self._truncate_sentence(text, 120)
        return "-"

    def _extract_outcome(self, text: str) -> str:
        lowered = text.lower()
        if any(keyword in lowered for keyword in ("成功", "完成", "done", "resolved", "记住")):
            return "completed_or_recorded"
        if any(keyword in lowered for keyword in ("失败", "failed", "未完成")):
            return "failed_or_blocked"
        return "in_progress"

    @staticmethod
    def _extract_followup(text: str) -> str:
        lowered = text.lower()
        if any(keyword in lowered for keyword in ("下一步", "待办", "todo", "follow", "后续")):
            return "has_followup"
        return "-"

    def _retention_for_tier(
        self,
        tier: str,
        now: str,
    ) -> tuple[str, int | None, str | None]:
        now_dt = datetime.fromisoformat(now.replace("Z", "+00:00"))
        if tier == "profile":
            return ("long_term_locked", None, None)
        if tier == "preference":
            return ("long_term", None, None)
        if tier == "episode":
            ttl_seconds = 180 * 24 * 3600
            expires_at = (now_dt.timestamp() + ttl_seconds)
            return (
                "mid_term_180d",
                ttl_seconds,
                datetime.fromtimestamp(expires_at, tz=UTC).isoformat().replace("+00:00", "Z"),
            )
        ttl_seconds = 7 * 24 * 3600
        expires_at = (now_dt.timestamp() + ttl_seconds)
        return (
            "short_term_7d",
            ttl_seconds,
            datetime.fromtimestamp(expires_at, tz=UTC).isoformat().replace("+00:00", "Z"),
        )

    def _normalized_similarity(self, left: str, right: str) -> float:
        left_norm = self._normalize_sentence(left).lower()
        right_norm = self._normalize_sentence(right).lower()
        if not left_norm or not right_norm:
            return 0.0

        if left_norm == right_norm:
            return 1.0

        left_tokens = set(re.findall(r"[A-Za-z0-9\u4e00-\u9fff]+", left_norm))
        right_tokens = set(re.findall(r"[A-Za-z0-9\u4e00-\u9fff]+", right_norm))
        if not left_tokens or not right_tokens:
            token_jaccard = 0.0
        else:
            token_jaccard = len(left_tokens & right_tokens) / max(1, len(left_tokens | right_tokens))

        sequence_ratio = SequenceMatcher(None, left_norm, right_norm).ratio()
        containment = 0.9 if left_norm in right_norm or right_norm in left_norm else 0.0
        return max(containment, token_jaccard * 0.65 + sequence_ratio * 0.35)

    def _is_conflict(self, *, tier: str, incoming: str, existing: str) -> bool:
        if tier not in {"profile", "preference"}:
            return False
        incoming_norm = incoming.lower()
        existing_norm = existing.lower()
        if incoming_norm == existing_norm:
            return False
        contradictory_markers = ("不是", "并非", "不喜欢", "不叫", "not", "don't", "never")
        incoming_negative = any(marker in incoming_norm for marker in contradictory_markers)
        existing_negative = any(marker in existing_norm for marker in contradictory_markers)
        if incoming_negative != existing_negative:
            return True

        shared_keywords = ("我叫", "名字", "来自", "籍贯", "住在", "喜欢", "偏好", "prefer")
        has_shared_keyword = any(keyword in incoming_norm and keyword in existing_norm for keyword in shared_keywords)
        if has_shared_keyword and self._normalized_similarity(incoming_norm, existing_norm) < 0.5:
            return True
        return False
