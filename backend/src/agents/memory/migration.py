"""Migration tools for structured memory storage."""

from __future__ import annotations

import shutil
from datetime import datetime
from pathlib import Path

from src.agents.memory.structured_models import MemoryEntry, MemoryManifest
from src.config.paths import get_paths


def import_from_v2(memory_data: dict) -> MemoryManifest:
    """Import from V2 memory.json format.

    Args:
        memory_data: V2 format memory data

    Returns:
        MemoryManifest with converted entries
    """
    entries = []
    now = datetime.now().isoformat()
    today = datetime.now().strftime("%Y-%m-%d")

    # Convert user context
    user = memory_data.get("user", {})

    # Work context
    work_context = user.get("workContext", {})
    if work_context.get("summary"):
        entries.append(
            MemoryEntry(
                memory_id=f"user-work-{now}",
                scope="user",
                source_thread_id=None,
                summary=work_context["summary"],
                tags=["work", "context"],
                created_at=work_context.get("updatedAt", now),
                updated_at=work_context.get("updatedAt", now),
                last_used_at=now,
                use_count=1,
                day_file=f"{today}.md",
                status="active",
            )
        )

    # Personal context
    personal_context = user.get("personalContext", {})
    if personal_context.get("summary"):
        entries.append(
            MemoryEntry(
                memory_id=f"user-personal-{now}",
                scope="user",
                source_thread_id=None,
                summary=personal_context["summary"],
                tags=["personal", "context"],
                created_at=personal_context.get("updatedAt", now),
                updated_at=personal_context.get("updatedAt", now),
                last_used_at=now,
                use_count=1,
                day_file=f"{today}.md",
                status="active",
            )
        )

    # Top of mind
    top_of_mind = user.get("topOfMind", {})
    if top_of_mind.get("summary"):
        entries.append(
            MemoryEntry(
                memory_id=f"user-topofmind-{now}",
                scope="user",
                source_thread_id=None,
                summary=top_of_mind["summary"],
                tags=["topofmind", "context"],
                created_at=top_of_mind.get("updatedAt", now),
                updated_at=top_of_mind.get("updatedAt", now),
                last_used_at=now,
                use_count=1,
                day_file=f"{today}.md",
                status="active",
            )
        )

    # Convert facts
    for fact in memory_data.get("facts", []):
        entries.append(
            MemoryEntry(
                memory_id=fact.get("id", f"fact-{now}"),
                scope="user",
                source_thread_id=fact.get("source"),
                summary=fact.get("content", ""),
                tags=[fact.get("category", "general")],
                created_at=fact.get("createdAt", now),
                updated_at=fact.get("createdAt", now),
                last_used_at=now,
                use_count=1,
                day_file=f"{today}.md",
                status="active",
            )
        )

    return MemoryManifest(version="1.0", entries=entries)


def create_snapshot(source_file: Path, snapshot_dir: Path) -> None:
    """Create a snapshot of V2 memory.json.

    Args:
        source_file: Path to memory.json
        snapshot_dir: Directory to store snapshot
    """
    snapshot_dir.mkdir(parents=True, exist_ok=True)
    if source_file.exists():
        shutil.copy2(source_file, snapshot_dir / "memory.json")


def rollback_from_snapshot(snapshot_dir: Path, target_file: Path) -> None:
    """Rollback from a snapshot.

    Args:
        snapshot_dir: Directory containing snapshot
        target_file: Target file to restore to

    Raises:
        FileNotFoundError: If snapshot not found
    """
    snapshot_file = snapshot_dir / "memory.json"
    if not snapshot_file.exists():
        raise FileNotFoundError(f"Snapshot not found: {snapshot_file}")

    target_file.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(snapshot_file, target_file)
