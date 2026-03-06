"""Snapshot storage manager for memory data."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


class StorageManager:
    """Persist and load memory snapshots."""

    def __init__(self, base_dir: str | Path | None = None) -> None:
        root = Path(base_dir) if base_dir is not None else Path.cwd()
        self.snapshots_dir = root / "memory_v2" / "snapshots"
        self.snapshots_dir.mkdir(parents=True, exist_ok=True)

    def save_snapshot(self, payload: dict[str, Any], name: str = "snapshot") -> Path:
        """Save one json snapshot and return file path."""
        timestamp = datetime.now(UTC).strftime("%Y%m%d%H%M%S")
        file_path = self.snapshots_dir / f"{name}-{timestamp}.json"
        with open(file_path, "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2, ensure_ascii=False)
        return file_path

    def load_snapshot(self, snapshot_path: str | Path) -> dict[str, Any]:
        """Load one json snapshot."""
        path = Path(snapshot_path)
        with open(path, encoding="utf-8") as f:
            return json.load(f)

    def list_snapshots(self, limit: int | None = None) -> list[Path]:
        """List snapshot files sorted by newest first."""
        snapshots = sorted(self.snapshots_dir.glob("*.json"), reverse=True)
        if limit is not None:
            return snapshots[:limit]
        return snapshots


__all__ = ["StorageManager"]
