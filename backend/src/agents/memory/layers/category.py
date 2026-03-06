"""Layer 3: memory category management."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from threading import Lock
from typing import Any

DEFAULT_CATEGORIES = [
    "preference",
    "knowledge",
    "context",
    "behavior",
    "goal",
    "project",
]


class CategoryLayer:
    """Manage memory categories and render category markdown."""

    def __init__(self, base_dir: str | Path | None = None) -> None:
        root = Path(base_dir) if base_dir is not None else Path.cwd()
        self._categories_dir = root / "memory_v2" / "categories"
        self._categories_dir.mkdir(parents=True, exist_ok=True)
        self._index_file = self._categories_dir / "categories.json"
        self._lock = Lock()
        self._data = self._load()

    def _load(self) -> dict[str, list[dict[str, Any]]]:
        if self._index_file.exists():
            with open(self._index_file, encoding="utf-8") as f:
                loaded = json.load(f)
        else:
            loaded = {}

        normalized: dict[str, list[dict[str, Any]]] = {
            category: list(loaded.get(category, []))
            for category in DEFAULT_CATEGORIES
        }

        # Keep custom categories if present
        for category, items in loaded.items():
            if category not in normalized:
                normalized[category] = list(items)
        return normalized

    def _save(self) -> None:
        with open(self._index_file, "w", encoding="utf-8") as f:
            json.dump(self._data, f, indent=2, ensure_ascii=False)

    def _normalize_category(self, category: str | None) -> str:
        if not category:
            return "context"
        return str(category).lower()

    def _normalize_item(self, item: dict[str, Any]) -> dict[str, Any]:
        return {
            "id": str(item.get("id")),
            "content": str(item.get("content", "")),
            "category": self._normalize_category(str(item.get("category", "context"))),
            "confidence": float(item.get("confidence", 0.0)),
            "updated_at": datetime.now(UTC).isoformat(),
        }

    def add_item(self, item: dict[str, Any]) -> dict[str, Any]:
        """Add or replace one item in a category."""
        normalized = self._normalize_item(item)
        category = normalized["category"]

        with self._lock:
            # Keep one canonical location per item id across all categories.
            for existing_category, existing_bucket in list(self._data.items()):
                self._data[existing_category] = [
                    entry for entry in existing_bucket if entry.get("id") != normalized["id"]
                ]

            bucket = self._data.setdefault(category, [])
            bucket.append(normalized)
            self._data[category] = bucket
            self._save()
        return normalized

    def remove_item(self, category: str, item_id: str) -> bool:
        """Remove one item by category and id."""
        key = self._normalize_category(category)
        with self._lock:
            bucket = self._data.get(key, [])
            original_len = len(bucket)
            filtered = [entry for entry in bucket if entry.get("id") != item_id]
            if len(filtered) == original_len:
                return False
            self._data[key] = filtered
            self._save()
            return True

    def remove_item_globally(self, item_id: str) -> bool:
        """Remove one item id from all categories."""
        removed = False
        with self._lock:
            for category, bucket in list(self._data.items()):
                filtered = [entry for entry in bucket if entry.get("id") != item_id]
                if len(filtered) != len(bucket):
                    removed = True
                    self._data[category] = filtered
            if removed:
                self._save()
        return removed

    def get_items(self, category: str) -> list[dict[str, Any]]:
        """Return all items of one category."""
        key = self._normalize_category(category)
        return list(self._data.get(key, []))

    def render_markdown(self, category: str) -> str:
        """Render one category as LLM-readable markdown."""
        key = self._normalize_category(category)
        items = self.get_items(key)

        lines = [f"# Memory Category: {key}", ""]
        if not items:
            lines.append("_No memory items._")
            return "\n".join(lines)

        for item in items:
            content = item.get("content", "")
            item_id = item.get("id", "")
            confidence = item.get("confidence", 0.0)
            lines.append(f"- [{item_id}] ({confidence:.2f}) {content}")

        return "\n".join(lines)


__all__ = ["CategoryLayer", "DEFAULT_CATEGORIES"]
