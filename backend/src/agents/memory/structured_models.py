"""Data models for structured memory storage."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal


@dataclass
class MemoryEntry:
    """A single memory entry in the structured storage."""

    memory_id: str
    scope: Literal["user", "agent", "thread"]
    source_thread_id: str | None
    summary: str
    tags: list[str]
    created_at: str
    updated_at: str
    last_used_at: str
    use_count: int
    day_file: str
    status: Literal["active", "archived"]


@dataclass
class MemoryManifest:
    """Manifest file containing all memory entries."""

    version: str
    entries: list[MemoryEntry]
