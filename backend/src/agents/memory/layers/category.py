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
        # Performance optimization: maintain item_id -> category index
        self._item_to_category: dict[str, str] = self._build_index()

    def _load(self) -> dict[str, list[dict[str, Any]]]:
        """Load categories from file with error handling."""
        if not self._index_file.exists():
            return {category: [] for category in DEFAULT_CATEGORIES}

        try:
            with open(self._index_file, encoding="utf-8") as f:
                loaded = json.load(f)

            if not isinstance(loaded, dict):
                import logging
                logging.error(f"Invalid categories file format: expected dict, got {type(loaded)}")
                return {category: [] for category in DEFAULT_CATEGORIES}
        except (json.JSONDecodeError, OSError) as e:
            import logging
            logging.error(f"Failed to load categories: {e}")
            return {category: [] for category in DEFAULT_CATEGORIES}

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
        """Save categories to file with atomic write to prevent corruption."""
        import tempfile
        import os

        # Write to temporary file first
        fd, temp_path = tempfile.mkstemp(
            dir=self._categories_dir,
            prefix='.categories_',
            suffix='.json.tmp'
        )
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(self._data, f, indent=2, ensure_ascii=False)
                f.flush()
                os.fsync(f.fileno())  # Ensure data is written to disk

            # Atomic rename
            os.replace(temp_path, self._index_file)
        except Exception:
            # Clean up temp file on error
            try:
                os.unlink(temp_path)
            except OSError:
                pass
            raise

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

    def _build_index(self) -> dict[str, str]:
        """Build item_id -> category index for fast lookups."""
        index: dict[str, str] = {}
        for category, items in self._data.items():
            for item in items:
                item_id = item.get("id")
                if item_id:
                    index[str(item_id)] = category
        return index

    def add_item(self, item: dict[str, Any]) -> dict[str, Any]:
        """Add or replace one item in a category."""
        normalized = self._normalize_item(item)
        category = normalized["category"]
        item_id = normalized["id"]

        with self._lock:
            # Use index for fast lookup of existing category
            old_category = self._item_to_category.get(item_id)

            if old_category and old_category != category:
                # Remove from old category
                old_bucket = self._data.get(old_category, [])
                self._data[old_category] = [
                    entry for entry in old_bucket if entry.get("id") != item_id
                ]

            # Add to new category
            bucket = self._data.setdefault(category, [])

            # Remove existing entry in same category (if any)
            bucket = [entry for entry in bucket if entry.get("id") != item_id]
            bucket.append(normalized)
            self._data[category] = bucket

            # Update index
            self._item_to_category[item_id] = category

            # Save to disk
            try:
                self._save()
            except Exception as e:
                # Rollback on save failure
                if old_category and old_category != category:
                    # Restore to old category
                    self._data[old_category].append(normalized)
                    self._data[category] = [
                        entry for entry in self._data[category] if entry.get("id") != item_id
                    ]
                    self._item_to_category[item_id] = old_category
                else:
                    # Remove from new category
                    self._data[category] = [
                        entry for entry in self._data[category] if entry.get("id") != item_id
                    ]
                    self._item_to_category.pop(item_id, None)
                raise

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

            # Backup for rollback
            backup = bucket.copy()

            self._data[key] = filtered
            self._item_to_category.pop(item_id, None)

            try:
                self._save()
            except Exception:
                # Rollback on save failure
                self._data[key] = backup
                self._item_to_category[item_id] = key
                raise

            return True

    def remove_item_globally(self, item_id: str) -> bool:
        """Remove one item id from all categories."""
        with self._lock:
            # Use index for fast lookup
            category = self._item_to_category.get(item_id)
            if not category:
                return False

            # Backup for rollback
            bucket = self._data.get(category, [])
            backup = bucket.copy()

            # Remove from category
            filtered = [entry for entry in bucket if entry.get("id") != item_id]
            self._data[category] = filtered
            self._item_to_category.pop(item_id, None)

            try:
                self._save()
            except Exception:
                # Rollback on save failure
                self._data[category] = backup
                self._item_to_category[item_id] = category
                raise

            return True

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
