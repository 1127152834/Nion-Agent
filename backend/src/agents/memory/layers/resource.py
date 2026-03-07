"""Layer 1: raw resource storage."""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime
from pathlib import Path
from threading import Lock
from typing import Any


class ResourceLayer:
    """Store and query raw resources by month."""

    def __init__(self, base_dir: str | Path | None = None) -> None:
        root = Path(base_dir) if base_dir is not None else Path.cwd()
        self._storage_dir = root / "memory_v2" / "resources"
        self._storage_dir.mkdir(parents=True, exist_ok=True)
        self._lock = Lock()

    def _normalize_datetime(self, value: datetime | str | None) -> datetime:
        if value is None:
            return datetime.now(UTC)
        if isinstance(value, datetime):
            return value
        return datetime.fromisoformat(value.replace("Z", "+00:00"))

    def _normalize_resource(self, resource: dict[str, Any]) -> dict[str, Any]:
        created_at_dt = self._normalize_datetime(resource.get("created_at"))
        created_at = created_at_dt.isoformat()
        metadata = resource.get("metadata")
        if not isinstance(metadata, dict):
            metadata = {}

        # Use full UUID to avoid collisions
        resource_id = resource.get("id")
        if not resource_id:
            resource_id = f"res_{uuid.uuid4().hex}"
        else:
            resource_id = str(resource_id)

        return {
            "id": resource_id,
            "type": str(resource.get("type") or "conversation"),
            "content": resource.get("content"),
            "metadata": metadata,
            "created_at": created_at,
        }

    def _monthly_file(self, created_at: datetime) -> Path:
        return self._storage_dir / f"{created_at.strftime('%Y-%m')}.jsonl"

    def store(self, resource: dict[str, Any]) -> dict[str, Any]:
        """Append one raw resource into month-partitioned storage with atomic write."""
        normalized = self._normalize_resource(resource)
        created_at = self._normalize_datetime(normalized["created_at"])
        target_file = self._monthly_file(created_at)

        line = json.dumps(normalized, ensure_ascii=False) + "\n"

        with self._lock:
            try:
                # Append with atomic write (open in append mode ensures atomicity on POSIX)
                with open(target_file, "a", encoding="utf-8") as f:
                    f.write(line)
                    f.flush()
                    import os
                    os.fsync(f.fileno())  # Ensure data is written to disk
            except Exception as e:
                import logging
                logging.error(f"Failed to store resource: {e}")
                raise

        return normalized

    def search(
        self,
        start_date: datetime | None = None,
        end_date: datetime | None = None,
        resource_type: str | None = None,
        limit: int | None = None,
    ) -> list[dict[str, Any]]:
        """Search resources by optional date window and type."""
        start_dt = self._normalize_datetime(start_date) if start_date else None
        end_dt = self._normalize_datetime(end_date) if end_date else None

        results: list[dict[str, Any]] = []
        with self._lock:
            files = sorted(self._storage_dir.glob("*.jsonl"))

        for file_path in files:
            parsed = self._read_jsonl_with_retry(file_path)
            for data in parsed:
                created_at = self._normalize_datetime(data.get("created_at"))
                if start_dt and created_at < start_dt:
                    continue
                if end_dt and created_at > end_dt:
                    continue
                if resource_type and data.get("type") != resource_type:
                    continue
                results.append(data)

        results.sort(
            key=lambda item: self._normalize_datetime(item.get("created_at")),
            reverse=True,
        )
        if limit is not None:
            return results[:limit]
        return results

    def _read_jsonl_with_retry(self, file_path: Path) -> list[dict[str, Any]]:
        """Read JSONL file with error handling and retry for truncated tail."""
        for attempt in range(2):
            try:
                with self._lock:
                    with open(file_path, encoding="utf-8") as f:
                        lines = f.readlines()
            except (OSError, IOError) as e:
                import logging
                logging.error(f"Failed to read resource file {file_path}: {e}")
                return []

            parsed: list[dict[str, Any]] = []
            truncated_tail = False

            for idx, raw_line in enumerate(lines):
                line = raw_line.strip()
                if not line:
                    continue
                try:
                    parsed.append(json.loads(line))
                except json.JSONDecodeError as e:
                    if idx == len(lines) - 1:
                        # Last line might be truncated, retry
                        truncated_tail = True
                        import logging
                        logging.warning(f"Truncated tail in {file_path}, line {idx}: {e}")
                        break
                    else:
                        # Mid-file corruption is serious
                        import logging
                        logging.error(f"JSON decode error in {file_path}, line {idx}: {e}")
                        # Skip corrupted line and continue
                        continue

            if truncated_tail and attempt == 0:
                continue
            return parsed

        return []


__all__ = ["ResourceLayer"]
