"""Data models for structured memory storage (V3)."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

MemoryScope = str
MemoryEntryType = Literal["fact", "summary", "catalog", "governance"]
MemoryEntryStatus = Literal["active", "archived", "contested", "pending"]


@dataclass(slots=True)
class RelationEdge:
    """Lightweight relationship edge pre-embedded for future graph projection."""

    type: str
    target_id: str
    weight: float = 1.0
    evidence: str = ""

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "RelationEdge":
        return cls(
            type=str(payload.get("type", "related_to")),
            target_id=str(payload.get("target_id", "")),
            weight=float(payload.get("weight", 1.0)),
            evidence=str(payload.get("evidence", "")),
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "type": self.type,
            "target_id": self.target_id,
            "weight": self.weight,
            "evidence": self.evidence,
        }


@dataclass(slots=True)
class MemoryEntryV3:
    """A structured memory entry with scope and graph-ready metadata."""

    memory_id: str
    entry_type: MemoryEntryType = "fact"
    scope: MemoryScope = "global"
    source_thread_id: str | None = None
    summary: str = ""
    tags: list[str] = field(default_factory=list)
    entity_refs: list[str] = field(default_factory=list)
    relations: list[RelationEdge] = field(default_factory=list)
    source_refs: list[str] = field(default_factory=list)
    confidence: float = 0.8
    status: MemoryEntryStatus = "active"
    created_at: str = ""
    updated_at: str = ""
    last_used_at: str = ""
    use_count: int = 0
    day_file: str = ""

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "MemoryEntryV3":
        return cls(
            memory_id=str(payload.get("memory_id", "")),
            entry_type=str(payload.get("entry_type", "fact")),
            scope=str(payload.get("scope", "global")),
            source_thread_id=payload.get("source_thread_id"),
            summary=str(payload.get("summary", "")),
            tags=[str(item) for item in payload.get("tags", []) if isinstance(item, (str, int, float))],
            entity_refs=[str(item) for item in payload.get("entity_refs", []) if isinstance(item, (str, int, float))],
            relations=[RelationEdge.from_dict(item) for item in payload.get("relations", []) if isinstance(item, dict)],
            source_refs=[str(item) for item in payload.get("source_refs", []) if isinstance(item, (str, int, float))],
            confidence=float(payload.get("confidence", 0.8)),
            status=str(payload.get("status", "active")),
            created_at=str(payload.get("created_at", "")),
            updated_at=str(payload.get("updated_at", "")),
            last_used_at=str(payload.get("last_used_at", "")),
            use_count=int(payload.get("use_count", 0)),
            day_file=str(payload.get("day_file", "")),
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "memory_id": self.memory_id,
            "entry_type": self.entry_type,
            "scope": self.scope,
            "source_thread_id": self.source_thread_id,
            "summary": self.summary,
            "tags": self.tags,
            "entity_refs": self.entity_refs,
            "relations": [edge.to_dict() for edge in self.relations],
            "source_refs": self.source_refs,
            "confidence": self.confidence,
            "status": self.status,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "last_used_at": self.last_used_at,
            "use_count": self.use_count,
            "day_file": self.day_file,
        }


@dataclass(slots=True)
class AgentDirectoryCard:
    """Agent catalog card stored in global memory governance layer."""

    agent_name: str
    role: str = "assistant"
    capability_summary: str = ""
    persona_summary: str = ""
    style_hint: str = ""
    updated_at: str = ""

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "AgentDirectoryCard":
        return cls(
            agent_name=str(payload.get("agent_name", "")),
            role=str(payload.get("role", "assistant")),
            capability_summary=str(payload.get("capability_summary", "")),
            persona_summary=str(payload.get("persona_summary", "")),
            style_hint=str(payload.get("style_hint", "")),
            updated_at=str(payload.get("updated_at", "")),
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "agent_name": self.agent_name,
            "role": self.role,
            "capability_summary": self.capability_summary,
            "persona_summary": self.persona_summary,
            "style_hint": self.style_hint,
            "updated_at": self.updated_at,
        }


@dataclass(slots=True)
class PromotionDecision:
    """Governance decision for candidate promotion or conflict resolution."""

    decision_id: str
    source_scope: MemoryScope
    entry_id: str
    action: Literal["promote", "reject", "contested", "override"]
    reason: str = ""
    decided_by: str = "system"
    decided_at: str = ""
    override_summary: str | None = None

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "PromotionDecision":
        return cls(
            decision_id=str(payload.get("decision_id", "")),
            source_scope=str(payload.get("source_scope", "global")),
            entry_id=str(payload.get("entry_id", "")),
            action=str(payload.get("action", "reject")),
            reason=str(payload.get("reason", "")),
            decided_by=str(payload.get("decided_by", "system")),
            decided_at=str(payload.get("decided_at", "")),
            override_summary=payload.get("override_summary"),
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "decision_id": self.decision_id,
            "source_scope": self.source_scope,
            "entry_id": self.entry_id,
            "action": self.action,
            "reason": self.reason,
            "decided_by": self.decided_by,
            "decided_at": self.decided_at,
            "override_summary": self.override_summary,
        }


@dataclass(slots=True)
class MemoryManifestV3:
    """Manifest file containing scope state, entries, governance, and catalog."""

    version: str = "3.0"
    scope: MemoryScope = "global"
    last_updated: str = ""
    user: dict[str, Any] = field(default_factory=dict)
    history: dict[str, Any] = field(default_factory=dict)
    entries: list[MemoryEntryV3] = field(default_factory=list)
    governance_queue: list[dict[str, Any]] = field(default_factory=list)
    decisions: list[PromotionDecision] = field(default_factory=list)
    agent_catalog: list[AgentDirectoryCard] = field(default_factory=list)

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "MemoryManifestV3":
        return cls(
            version=str(payload.get("version", "3.0")),
            scope=str(payload.get("scope", "global")),
            last_updated=str(payload.get("last_updated", "")),
            user=payload.get("user") if isinstance(payload.get("user"), dict) else {},
            history=payload.get("history") if isinstance(payload.get("history"), dict) else {},
            entries=[MemoryEntryV3.from_dict(item) for item in payload.get("entries", []) if isinstance(item, dict)],
            governance_queue=[item for item in payload.get("governance_queue", []) if isinstance(item, dict)],
            decisions=[PromotionDecision.from_dict(item) for item in payload.get("decisions", []) if isinstance(item, dict)],
            agent_catalog=[AgentDirectoryCard.from_dict(item) for item in payload.get("agent_catalog", []) if isinstance(item, dict)],
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "version": self.version,
            "scope": self.scope,
            "last_updated": self.last_updated,
            "user": self.user,
            "history": self.history,
            "entries": [entry.to_dict() for entry in self.entries],
            "governance_queue": self.governance_queue,
            "decisions": [decision.to_dict() for decision in self.decisions],
            "agent_catalog": [card.to_dict() for card in self.agent_catalog],
        }
