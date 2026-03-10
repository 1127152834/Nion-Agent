"""Structured filesystem runtime for memory storage."""

from __future__ import annotations

import json
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Any

from src.agents.memory.core import MemoryReadRequest, MemoryWriteRequest
from src.agents.memory.structured_models import MemoryEntry, MemoryManifest
from src.config.paths import get_paths


class StructuredFsRuntime:
    """Structured filesystem runtime for memory storage."""

    def __init__(self):
        self._paths = get_paths()
        self._cache: dict[str, Any] | None = None

    def get_memory_data(self, request: MemoryReadRequest) -> dict:
        """Read from structured storage."""
        if self._cache is not None:
            return self._cache

        manifest = self._read_manifest()

        # Convert to V2 compatible format
        memory_data = {
            "version": "2.0",
            "lastUpdated": datetime.now().isoformat() + "Z",
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
            "facts": [],
        }

        # Convert entries to facts
        for entry in manifest.entries:
            if entry.status == "active":
                memory_data["facts"].append({
                    "id": entry.memory_id,
                    "content": entry.summary,
                    "category": entry.tags[0] if entry.tags else "general",
                    "confidence": 0.8,
                    "createdAt": entry.created_at,
                    "source": entry.source_thread_id or "",
                })

        self._cache = memory_data
        return memory_data

    def reload_memory_data(self, request: MemoryReadRequest) -> dict:
        """Force reload from disk."""
        self._cache = None
        return self.get_memory_data(request)

    def queue_update(self, request: MemoryWriteRequest) -> None:
        """Queue memory update."""
        from src.agents.memory.queue import get_memory_queue

        get_memory_queue().add(
            thread_id=request.thread_id,
            messages=request.messages,
            agent_name=request.agent_name,
        )

    def _read_manifest(self) -> MemoryManifest:
        """Read manifest.json."""
        manifest_file = self._paths.memory_manifest_file
        if not manifest_file.exists():
            return MemoryManifest(version="1.0", entries=[])

        with open(manifest_file, "r", encoding="utf-8") as f:
            data = json.load(f)

        return MemoryManifest(
            version=data["version"],
            entries=[MemoryEntry(**e) for e in data["entries"]],
        )

    def _write_manifest(self, manifest: MemoryManifest) -> None:
        """Write manifest.json atomically."""
        manifest_file = self._paths.memory_manifest_file
        manifest_file.parent.mkdir(parents=True, exist_ok=True)

        # Atomic write
        with tempfile.NamedTemporaryFile(
            mode="w",
            dir=manifest_file.parent,
            delete=False,
            encoding="utf-8",
        ) as tmp:
            json.dump(
                {
                    "version": manifest.version,
                    "entries": [vars(e) for e in manifest.entries],
                },
                tmp,
                indent=2,
                ensure_ascii=False,
            )
            tmp_path = tmp.name

        Path(tmp_path).replace(manifest_file)

    def _read_day_file(self, date: str) -> str:
        """Read a day file."""
        day_file = self._paths.memory_day_file(date)
        if not day_file.exists():
            return ""
        return day_file.read_text(encoding="utf-8")

    def _write_day_file(self, date: str, content: str) -> None:
        """Write a day file."""
        day_file = self._paths.memory_day_file(date)
        day_file.parent.mkdir(parents=True, exist_ok=True)
        day_file.write_text(content, encoding="utf-8")
