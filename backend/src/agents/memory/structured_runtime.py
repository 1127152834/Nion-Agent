"""Structured filesystem runtime for memory storage (scope-aware V3)."""

from __future__ import annotations

import copy
import json
import re
import tempfile
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from src.agents.memory.core import MemoryReadRequest, MemoryWriteRequest
from src.agents.memory.structured_models import (
    AgentDirectoryCard,
    MemoryEntryV3,
    MemoryManifestV3,
    PromotionDecision,
    RelationEdge,
)
from src.config.paths import get_paths


def _utcnow_iso_z() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


class StructuredFsRuntime:
    """Structured filesystem runtime for memory storage."""

    def __init__(self):
        self._paths = get_paths()
        self._cache: dict[str, dict[str, Any]] = {}

    # ------------------------------------------------------------------
    # Scope and path helpers
    # ------------------------------------------------------------------

    def _scope_from_agent(self, agent_name: str | None) -> str:
        if agent_name:
            return f"agent:{agent_name.lower()}"
        return "global"

    def _scope_root(self, scope: str) -> Path:
        if scope == "global":
            return self._paths.structured_memory_root
        if scope.startswith("agent:"):
            agent_name = scope.split(":", 1)[1]
            return self._paths.agent_dir(agent_name) / "memory"
        raise ValueError(f"Unsupported memory scope: {scope}")

    def _scope_manifest_file(self, scope: str) -> Path:
        return self._scope_root(scope) / "index" / "manifest.json"

    def _scope_overview_file(self, scope: str) -> Path:
        return self._scope_root(scope) / "MEMORY.md"

    def _scope_day_file(self, scope: str, date: str) -> Path:
        return self._scope_root(scope) / "memory" / f"{date}.md"

    def _scope_graph_file(self, scope: str) -> Path:
        return self._scope_root(scope) / "index" / "graph.json"

    def _ensure_scope_dirs(self, scope: str) -> None:
        root = self._scope_root(scope)
        (root / "index").mkdir(parents=True, exist_ok=True)
        (root / "memory").mkdir(parents=True, exist_ok=True)
        (root / "snapshots").mkdir(parents=True, exist_ok=True)

    # ------------------------------------------------------------------
    # Protocol methods
    # ------------------------------------------------------------------

    def get_memory_data(self, request: MemoryReadRequest) -> dict:
        """Read memory from scope-specific structured storage."""
        scope = self._scope_from_agent(request.agent_name)
        cached = self._cache.get(scope)
        if cached is not None:
            return copy.deepcopy(cached)

        manifest = self._read_manifest(scope)
        memory_data = self._manifest_to_memory_data(manifest)
        self._cache[scope] = memory_data
        return copy.deepcopy(memory_data)

    def reload_memory_data(self, request: MemoryReadRequest) -> dict:
        """Force reload from disk."""
        scope = self._scope_from_agent(request.agent_name)
        self._cache.pop(scope, None)
        return self.get_memory_data(request)

    def queue_update(self, request: MemoryWriteRequest) -> None:
        """Queue memory update via existing queue."""
        from src.agents.memory.queue import get_memory_queue

        get_memory_queue().add(
            thread_id=request.thread_id,
            messages=request.messages,
            agent_name=request.agent_name,
        )

    # ------------------------------------------------------------------
    # Save/read helpers for updater and API
    # ------------------------------------------------------------------

    def save_memory_data(
        self,
        memory_data: dict[str, Any],
        *,
        agent_name: str | None = None,
        thread_id: str | None = None,
    ) -> bool:
        """Persist normalized memory payload into structured scope files."""
        scope = self._scope_from_agent(agent_name)
        manifest = self._read_manifest(scope)
        now = _utcnow_iso_z()

        manifest.user = self._normalize_user(memory_data.get("user"))
        manifest.history = self._normalize_history(memory_data.get("history"))
        manifest.last_updated = now

        previous_non_fact = [entry for entry in manifest.entries if entry.entry_type != "fact"]
        existing_fact_map = {
            entry.memory_id: entry
            for entry in manifest.entries
            if entry.entry_type == "fact"
        }

        fact_entries: list[MemoryEntryV3] = []
        for fact in memory_data.get("facts", []) or []:
            content = str(fact.get("content", "")).strip()
            if not content:
                continue

            fact_id = str(fact.get("id", "")).strip() or f"fact_{uuid.uuid4().hex[:8]}"
            category = str(fact.get("category", "context")).strip() or "context"
            confidence = float(fact.get("confidence", 0.5) or 0.5)
            created_at = str(fact.get("createdAt", now) or now)
            updated_at = now
            source_thread_id = str(fact.get("source", thread_id or "")).strip() or thread_id
            status = str(fact.get("status", "active") or "active")

            existing = existing_fact_map.get(fact_id)
            entity_refs = self._extract_entities(content)
            relations = self._build_relations(entity_refs, fact.get("relations"))
            source_refs = [str(source_thread_id)] if source_thread_id else []

            if existing is not None:
                existing.summary = content
                existing.tags = [category]
                existing.confidence = confidence
                existing.updated_at = updated_at
                existing.last_used_at = updated_at
                existing.use_count = max(existing.use_count, 1)
                existing.source_thread_id = source_thread_id
                existing.source_refs = sorted(set(existing.source_refs + source_refs))
                existing.entity_refs = entity_refs
                existing.relations = relations
                existing.status = status
                existing.scope = scope
                existing.day_file = f"{datetime.now().strftime('%Y-%m-%d')}.md"
                fact_entries.append(existing)
                continue

            fact_entries.append(
                MemoryEntryV3(
                    memory_id=fact_id,
                    entry_type="fact",
                    scope=scope,
                    source_thread_id=source_thread_id,
                    summary=content,
                    tags=[category],
                    entity_refs=entity_refs,
                    relations=relations,
                    source_refs=source_refs,
                    confidence=confidence,
                    status=status,
                    created_at=created_at,
                    updated_at=updated_at,
                    last_used_at=updated_at,
                    use_count=1,
                    day_file=f"{datetime.now().strftime('%Y-%m-%d')}.md",
                )
            )

        manifest.entries = previous_non_fact + fact_entries
        self._write_manifest(manifest, scope)
        self._write_overview(scope, manifest)
        self._append_day_record(scope, thread_id=thread_id, entries=fact_entries)
        self._write_graph_index(scope, manifest)
        self._cache[scope] = self._manifest_to_memory_data(manifest)

        if agent_name:
            self._promote_agent_entries(
                agent_name=agent_name,
                entries=fact_entries,
                timestamp=now,
            )

        return True

    def get_memory_items(self, *, scope: str, agent_name: str | None = None) -> list[dict[str, Any]]:
        resolved_scope = self._resolve_scope_arg(scope=scope, agent_name=agent_name)
        manifest = self._read_manifest(resolved_scope)
        return [entry.to_dict() for entry in manifest.entries]

    def get_agent_catalog(self) -> list[dict[str, Any]]:
        manifest = self._read_manifest("global")
        return [card.to_dict() for card in manifest.agent_catalog]

    def set_agent_catalog(self, cards: list[AgentDirectoryCard]) -> None:
        manifest = self._read_manifest("global")
        manifest.agent_catalog = cards
        manifest.last_updated = _utcnow_iso_z()
        self._write_manifest(manifest, "global")
        self._write_overview("global", manifest)
        self._cache.pop("global", None)

    def get_agent_catalog_view(self, requesting_agent: str | None = None) -> list[dict[str, Any]]:
        cards = self.get_agent_catalog()
        if not requesting_agent:
            return cards

        view: list[dict[str, Any]] = []
        for card in cards:
            if card.get("agent_name") == requesting_agent:
                view.append(card)
                continue

            view.append(
                {
                    "agent_name": card.get("agent_name", ""),
                    "role": card.get("role", "assistant"),
                    "capability_summary": card.get("capability_summary", ""),
                    "style_hint": card.get("style_hint", ""),
                    "persona_summary": "",
                    "updated_at": card.get("updated_at", ""),
                }
            )
        return view

    def get_governance_status(self) -> dict[str, Any]:
        manifest = self._read_manifest("global")
        pending = [item for item in manifest.governance_queue if item.get("status", "pending") == "pending"]
        contested = [entry for entry in manifest.entries if entry.status == "contested"]
        last_run = ""
        if manifest.decisions:
            last_run = manifest.decisions[-1].decided_at

        return {
            "pending_count": len(pending),
            "contested_count": len(contested),
            "last_run_at": last_run,
            "queue": manifest.governance_queue,
        }

    def run_governance(self) -> dict[str, Any]:
        manifest = self._read_manifest("global")
        promoted = 0
        rejected = 0

        for item in manifest.governance_queue:
            if item.get("status", "pending") != "pending":
                continue

            candidate = item.get("candidate") if isinstance(item.get("candidate"), dict) else {}
            confidence = float(candidate.get("confidence", 0.0) or 0.0)
            decision_id = str(item.get("decision_id", ""))

            if confidence >= 0.7 and candidate:
                entry = MemoryEntryV3.from_dict(candidate)
                entry.scope = "global"
                entry.status = "active"
                if not any(existing.memory_id == entry.memory_id for existing in manifest.entries):
                    manifest.entries.append(entry)
                item["status"] = "promoted"
                item["decided_at"] = _utcnow_iso_z()
                manifest.decisions.append(
                    PromotionDecision(
                        decision_id=decision_id,
                        source_scope=str(item.get("source_scope", "global")),
                        entry_id=entry.memory_id,
                        action="promote",
                        reason="governance_batch",
                        decided_by="system",
                        decided_at=item["decided_at"],
                    )
                )
                promoted += 1
                continue

            item["status"] = "rejected"
            item["decided_at"] = _utcnow_iso_z()
            manifest.decisions.append(
                PromotionDecision(
                    decision_id=decision_id,
                    source_scope=str(item.get("source_scope", "global")),
                    entry_id=str(candidate.get("memory_id", "")),
                    action="reject",
                    reason="confidence_below_threshold",
                    decided_by="system",
                    decided_at=item["decided_at"],
                )
            )
            rejected += 1

        manifest.last_updated = _utcnow_iso_z()
        self._write_manifest(manifest, "global")
        self._write_overview("global", manifest)
        self._write_graph_index("global", manifest)
        self._cache.pop("global", None)

        status = self.get_governance_status()
        return {
            "promoted": promoted,
            "rejected": rejected,
            "pending_count": status["pending_count"],
            "contested_count": status["contested_count"],
        }

    def apply_governance_decision(
        self,
        *,
        decision_id: str,
        action: str,
        override_summary: str | None = None,
        decided_by: str = "user",
    ) -> dict[str, Any]:
        manifest = self._read_manifest("global")
        target = next((item for item in manifest.governance_queue if str(item.get("decision_id", "")) == decision_id), None)
        if target is None:
            return {"updated": False, "reason": "decision_not_found"}

        candidate = target.get("candidate") if isinstance(target.get("candidate"), dict) else {}
        candidate_entry_id = str(candidate.get("memory_id", ""))
        decided_at = _utcnow_iso_z()

        if action == "override" and override_summary and candidate_entry_id:
            found = next((entry for entry in manifest.entries if entry.memory_id == candidate_entry_id), None)
            if found is not None:
                found.summary = override_summary
                found.status = "active"
                found.updated_at = decided_at
            else:
                entry = MemoryEntryV3.from_dict(candidate)
                entry.summary = override_summary
                entry.scope = "global"
                entry.status = "active"
                entry.updated_at = decided_at
                if not entry.created_at:
                    entry.created_at = decided_at
                manifest.entries.append(entry)
            action_value = "override"
            target["status"] = "overridden"
        elif action == "promote":
            entry = MemoryEntryV3.from_dict(candidate)
            entry.scope = "global"
            entry.status = "active"
            entry.updated_at = decided_at
            if not entry.created_at:
                entry.created_at = decided_at
            if not any(existing.memory_id == entry.memory_id for existing in manifest.entries):
                manifest.entries.append(entry)
            action_value = "promote"
            target["status"] = "promoted"
        else:
            action_value = "reject"
            target["status"] = "rejected"

        target["decided_at"] = decided_at
        manifest.decisions.append(
            PromotionDecision(
                decision_id=decision_id,
                source_scope=str(target.get("source_scope", "global")),
                entry_id=candidate_entry_id,
                action=action_value,
                reason="manual_override" if action_value == "override" else "manual_decision",
                decided_by=decided_by,
                decided_at=decided_at,
                override_summary=override_summary,
            )
        )

        manifest.last_updated = decided_at
        self._write_manifest(manifest, "global")
        self._write_overview("global", manifest)
        self._write_graph_index("global", manifest)
        self._cache.pop("global", None)

        return {
            "updated": True,
            "decision_id": decision_id,
            "action": action_value,
            "decided_at": decided_at,
        }

    # ------------------------------------------------------------------
    # Manifest IO
    # ------------------------------------------------------------------

    def _read_manifest(self, scope: str = "global") -> MemoryManifestV3:
        """Read scope manifest.json."""
        self._ensure_scope_dirs(scope)
        manifest_file = self._scope_manifest_file(scope)
        if not manifest_file.exists():
            return MemoryManifestV3(
                scope=scope,
                last_updated=_utcnow_iso_z(),
                user=self._default_user_context(),
                history=self._default_history_context(),
                entries=[],
                governance_queue=[],
                decisions=[],
                agent_catalog=[],
            )

        with open(manifest_file, encoding="utf-8") as file:
            data = json.load(file)
        manifest = MemoryManifestV3.from_dict(data if isinstance(data, dict) else {})
        if not manifest.scope:
            manifest.scope = scope
        if not manifest.user:
            manifest.user = self._default_user_context()
        if not manifest.history:
            manifest.history = self._default_history_context()
        return manifest

    def _write_manifest(self, manifest: MemoryManifestV3, scope: str = "global") -> None:
        """Write scope manifest.json atomically."""
        self._ensure_scope_dirs(scope)
        manifest_file = self._scope_manifest_file(scope)

        with tempfile.NamedTemporaryFile(
            mode="w",
            dir=manifest_file.parent,
            delete=False,
            encoding="utf-8",
        ) as tmp:
            json.dump(manifest.to_dict(), tmp, indent=2, ensure_ascii=False)
            tmp_path = tmp.name

        Path(tmp_path).replace(manifest_file)

    def _write_overview(self, scope: str, manifest: MemoryManifestV3) -> None:
        overview_file = self._scope_overview_file(scope)
        self._ensure_scope_dirs(scope)

        active_entries = [entry for entry in manifest.entries if entry.entry_type == "fact" and entry.status == "active"]
        active_entries.sort(key=lambda item: item.updated_at or item.created_at, reverse=True)

        lines = [
            f"# Memory Overview ({scope})",
            "",
            f"- Last Updated: {manifest.last_updated or _utcnow_iso_z()}",
            f"- Active Facts: {len(active_entries)}",
            "",
            "## User Context",
            f"- Work: {manifest.user.get('workContext', {}).get('summary', '')}",
            f"- Personal: {manifest.user.get('personalContext', {}).get('summary', '')}",
            f"- Top of Mind: {manifest.user.get('topOfMind', {}).get('summary', '')}",
            "",
            "## History",
            f"- Recent Months: {manifest.history.get('recentMonths', {}).get('summary', '')}",
            f"- Earlier Context: {manifest.history.get('earlierContext', {}).get('summary', '')}",
            f"- Long-Term Background: {manifest.history.get('longTermBackground', {}).get('summary', '')}",
            "",
            "## Key Facts",
        ]

        if not active_entries:
            lines.append("- (empty)")
        else:
            for entry in active_entries[:20]:
                category = entry.tags[0] if entry.tags else "context"
                lines.append(f"- [{category}] {entry.summary}")

        if scope == "global" and manifest.agent_catalog:
            lines.extend(["", "## Agent Catalog"])
            for card in manifest.agent_catalog:
                lines.append(f"- {card.agent_name}: {card.capability_summary}")

        overview_file.write_text("\n".join(lines) + "\n", encoding="utf-8")

    def _append_day_record(self, scope: str, *, thread_id: str | None, entries: list[MemoryEntryV3]) -> None:
        day_file = self._scope_day_file(scope, datetime.now().strftime("%Y-%m-%d"))
        day_file.parent.mkdir(parents=True, exist_ok=True)
        lines = [
            f"## {datetime.now().strftime('%H:%M:%S')} thread={thread_id or 'unknown'}",
        ]
        if entries:
            for entry in entries[:20]:
                category = entry.tags[0] if entry.tags else "context"
                lines.append(f"- [{category}] {entry.summary}")
        else:
            lines.append("- (no active entries)")

        payload = "\n".join(lines) + "\n\n"
        with open(day_file, "a", encoding="utf-8") as file:
            file.write(payload)

    def _write_graph_index(self, scope: str, manifest: MemoryManifestV3) -> None:
        graph_file = self._scope_graph_file(scope)
        graph_file.parent.mkdir(parents=True, exist_ok=True)

        nodes: dict[str, dict[str, Any]] = {}
        edges: list[dict[str, Any]] = []

        for entry in manifest.entries:
            if entry.entry_type != "fact":
                continue
            for entity in entry.entity_refs:
                nodes[entity] = {"id": entity, "label": entity}
            for relation in entry.relations:
                edges.append(
                    {
                        "from": entry.memory_id,
                        "to": relation.target_id,
                        "type": relation.type,
                        "weight": relation.weight,
                        "evidence": relation.evidence,
                    }
                )

        graph_payload = {
            "scope": scope,
            "updated_at": _utcnow_iso_z(),
            "nodes": list(nodes.values()),
            "edges": edges,
        }
        graph_file.write_text(json.dumps(graph_payload, ensure_ascii=False, indent=2), encoding="utf-8")

    # ------------------------------------------------------------------
    # Conversion helpers
    # ------------------------------------------------------------------

    def _manifest_to_memory_data(self, manifest: MemoryManifestV3) -> dict[str, Any]:
        facts: list[dict[str, Any]] = []
        for entry in manifest.entries:
            if entry.entry_type != "fact":
                continue
            if entry.status not in {"active", "contested"}:
                continue
            facts.append(
                {
                    "id": entry.memory_id,
                    "content": entry.summary,
                    "category": entry.tags[0] if entry.tags else "context",
                    "confidence": entry.confidence,
                    "createdAt": entry.created_at,
                    "source": entry.source_thread_id or "",
                    "status": entry.status,
                    "entity_refs": entry.entity_refs,
                    "relations": [relation.to_dict() for relation in entry.relations],
                    "source_refs": entry.source_refs,
                }
            )

        payload = {
            "version": manifest.version,
            "scope": manifest.scope,
            "storage_layout": "structured-fs",
            "lastUpdated": manifest.last_updated or _utcnow_iso_z(),
            "user": self._normalize_user(manifest.user),
            "history": self._normalize_history(manifest.history),
            "facts": facts,
        }
        if manifest.scope == "global":
            payload["agent_catalog"] = [card.to_dict() for card in manifest.agent_catalog]
        return payload

    def _default_user_context(self) -> dict[str, Any]:
        return {
            "workContext": {"summary": "", "updatedAt": ""},
            "personalContext": {"summary": "", "updatedAt": ""},
            "topOfMind": {"summary": "", "updatedAt": ""},
        }

    def _default_history_context(self) -> dict[str, Any]:
        return {
            "recentMonths": {"summary": "", "updatedAt": ""},
            "earlierContext": {"summary": "", "updatedAt": ""},
            "longTermBackground": {"summary": "", "updatedAt": ""},
        }

    def _normalize_user(self, payload: Any) -> dict[str, Any]:
        data = copy.deepcopy(self._default_user_context())
        if isinstance(payload, dict):
            for key in data:
                section = payload.get(key)
                if isinstance(section, dict):
                    data[key]["summary"] = str(section.get("summary", data[key]["summary"]))
                    data[key]["updatedAt"] = str(section.get("updatedAt", data[key]["updatedAt"]))
        return data

    def _normalize_history(self, payload: Any) -> dict[str, Any]:
        data = copy.deepcopy(self._default_history_context())
        if isinstance(payload, dict):
            for key in data:
                section = payload.get(key)
                if isinstance(section, dict):
                    data[key]["summary"] = str(section.get("summary", data[key]["summary"]))
                    data[key]["updatedAt"] = str(section.get("updatedAt", data[key]["updatedAt"]))
        return data

    def _extract_entities(self, text: str) -> list[str]:
        # Keep extraction intentionally lightweight; this is graph pre-embedding, not full NER.
        tokens = re.findall(r"[A-Za-z][A-Za-z0-9_\-/+.]{2,}|[\u4e00-\u9fff]{2,}", text)
        unique: list[str] = []
        for token in tokens:
            if token not in unique:
                unique.append(token)
            if len(unique) >= 8:
                break
        return unique

    def _build_relations(self, entity_refs: list[str], raw_relations: Any) -> list[RelationEdge]:
        if isinstance(raw_relations, list) and raw_relations:
            relations: list[RelationEdge] = []
            for relation in raw_relations:
                if isinstance(relation, dict):
                    relations.append(RelationEdge.from_dict(relation))
            if relations:
                return relations

        if len(entity_refs) <= 1:
            return []

        primary = entity_refs[0]
        edges: list[RelationEdge] = []
        for target in entity_refs[1:]:
            edges.append(RelationEdge(type="related_to", target_id=target, weight=0.6, evidence=primary))
        return edges

    def _resolve_scope_arg(self, *, scope: str, agent_name: str | None) -> str:
        normalized = (scope or "global").strip().lower()
        if normalized == "global":
            return "global"
        if normalized == "agent":
            if not agent_name:
                raise ValueError("agent_name is required when scope=agent")
            return self._scope_from_agent(agent_name)
        if normalized.startswith("agent:"):
            name = normalized.split(":", 1)[1]
            if not name:
                raise ValueError("invalid agent scope")
            return f"agent:{name}"
        raise ValueError(f"Unsupported scope: {scope}")

    # ------------------------------------------------------------------
    # Promotion and governance queue helpers
    # ------------------------------------------------------------------

    def _promote_agent_entries(self, *, agent_name: str, entries: list[MemoryEntryV3], timestamp: str) -> None:
        global_manifest = self._read_manifest("global")

        existing_active = [entry for entry in global_manifest.entries if entry.entry_type == "fact" and entry.status == "active"]
        existing_by_content = {self._normalize_content(entry.summary): entry for entry in existing_active}

        for entry in entries:
            if entry.entry_type != "fact" or entry.status != "active":
                continue

            normalized_content = self._normalize_content(entry.summary)
            decision_id = f"decision_{uuid.uuid4().hex[:10]}"

            if entry.confidence >= 0.85:
                duplicate = existing_by_content.get(normalized_content)
                if duplicate is not None:
                    continue

                conflict_target = self._find_conflict_target(existing_active, entry)
                if conflict_target is not None:
                    conflict_target.status = "contested"
                    contested_entry = MemoryEntryV3.from_dict(entry.to_dict())
                    contested_entry.scope = "global"
                    contested_entry.status = "contested"
                    contested_entry.updated_at = timestamp
                    contested_entry.source_refs = sorted(set(contested_entry.source_refs + [f"agent:{agent_name}"]))
                    if not any(item.memory_id == contested_entry.memory_id for item in global_manifest.entries):
                        global_manifest.entries.append(contested_entry)
                    global_manifest.governance_queue.append(
                        {
                            "decision_id": decision_id,
                            "source_scope": f"agent:{agent_name}",
                            "candidate": contested_entry.to_dict(),
                            "status": "contested",
                            "reason": "entity_conflict",
                            "created_at": timestamp,
                        }
                    )
                    continue

                promoted = MemoryEntryV3.from_dict(entry.to_dict())
                promoted.scope = "global"
                promoted.updated_at = timestamp
                promoted.source_refs = sorted(set(promoted.source_refs + [f"agent:{agent_name}"]))
                if not any(item.memory_id == promoted.memory_id for item in global_manifest.entries):
                    global_manifest.entries.append(promoted)
                global_manifest.decisions.append(
                    PromotionDecision(
                        decision_id=decision_id,
                        source_scope=f"agent:{agent_name}",
                        entry_id=promoted.memory_id,
                        action="promote",
                        reason="high_confidence_realtime",
                        decided_by="system",
                        decided_at=timestamp,
                    )
                )
                continue

            global_manifest.governance_queue.append(
                {
                    "decision_id": decision_id,
                    "source_scope": f"agent:{agent_name}",
                    "candidate": entry.to_dict(),
                    "status": "pending",
                    "reason": "below_realtime_threshold",
                    "created_at": timestamp,
                }
            )

        global_manifest.last_updated = timestamp
        self._write_manifest(global_manifest, "global")
        self._write_overview("global", global_manifest)
        self._write_graph_index("global", global_manifest)
        self._cache.pop("global", None)

    def _normalize_content(self, content: str) -> str:
        return " ".join(content.strip().lower().split())

    def _find_conflict_target(self, existing_active: list[MemoryEntryV3], candidate: MemoryEntryV3) -> MemoryEntryV3 | None:
        if not candidate.entity_refs:
            return None
        candidate_entity = candidate.entity_refs[0]
        candidate_norm = self._normalize_content(candidate.summary)
        for existing in existing_active:
            if existing.entity_refs and existing.entity_refs[0] == candidate_entity:
                if self._normalize_content(existing.summary) != candidate_norm:
                    return existing
        return None
