"""Memory system data types."""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any


class MemoryCategory(Enum):
    """Memory categories used by memory items."""

    PREFERENCE = "preference"
    KNOWLEDGE = "knowledge"
    CONTEXT = "context"
    BEHAVIOR = "behavior"
    GOAL = "goal"
    PROJECT = "project"


@dataclass
class Entity:
    """Entity extracted from a memory item."""

    name: str
    type: str
    mentions: int = 1


@dataclass
class Relation:
    """Relation extracted from a memory item."""

    type: str
    target: str
    confidence: float = 1.0


@dataclass
class RawResource:
    """Raw memory resource before structuring."""

    id: str = field(default_factory=lambda: f"res_{uuid.uuid4().hex[:8]}")
    type: str = "conversation"
    content: Any = None
    metadata: dict[str, Any] = field(default_factory=dict)
    created_at: datetime = field(default_factory=datetime.utcnow)


@dataclass
class MemoryItem:
    """Structured memory item used for retrieval."""

    id: str = field(default_factory=lambda: f"item_{uuid.uuid4().hex[:8]}")
    content: str = ""
    category: MemoryCategory = MemoryCategory.CONTEXT
    confidence: float = 0.5
    entities: list[Entity] = field(default_factory=list)
    relations: list[Relation] = field(default_factory=list)
    created_at: datetime = field(default_factory=datetime.utcnow)
    last_accessed: datetime = field(default_factory=datetime.utcnow)
    access_count: int = 0


__all__ = [
    "MemoryCategory",
    "Entity",
    "Relation",
    "RawResource",
    "MemoryItem",
]
