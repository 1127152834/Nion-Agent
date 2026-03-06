"""Layer 2: structured memory items."""

from __future__ import annotations

import hashlib
import importlib.util
import json
import sys
import uuid
from datetime import UTC, datetime
from pathlib import Path
from threading import Lock
from typing import Any


def _load_local_module(module_path: Path, module_name: str) -> Any:
    loaded = sys.modules.get(module_name)
    if loaded is not None:
        return loaded

    spec = importlib.util.spec_from_file_location(module_name, module_path)
    if spec is None or spec.loader is None:
        raise ImportError(f"Cannot load module: {module_path}")

    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


class ItemLayer:
    """Manage memory items with hybrid retrieval."""

    def __init__(
        self,
        base_dir: str | Path | None = None,
        embedding_provider: Any = None,
        vector_store: Any = None,
        bm25: Any = None,
        hybrid_search: Any = None,
        bm25_k1: float = 1.5,
        bm25_b: float = 0.75,
        vector_weight: float = 0.5,
        bm25_weight: float = 0.5,
    ) -> None:
        root = Path(base_dir) if base_dir is not None else Path.cwd()
        self._storage_dir = root / "memory_v2"
        self._storage_dir.mkdir(parents=True, exist_ok=True)
        self._items_file = self._storage_dir / "items.json"
        self._vector_db_path = self._storage_dir / "vectors.db"

        self._embedding_provider = embedding_provider
        self._lock = Lock()
        self._items: dict[str, dict[str, Any]] = self._load_items()
        self._doc_ids: list[str] = []

        if vector_store is None or bm25 is None or hybrid_search is None:
            search_dir = Path(__file__).resolve().parents[1] / "search"
            bm25_module = _load_local_module(search_dir / "bm25.py", "memory_v2_search_bm25")
            vector_module = _load_local_module(
                search_dir / "vector_store.py",
                "memory_v2_search_vector_store",
            )
            hybrid_module = _load_local_module(search_dir / "hybrid.py", "memory_v2_search_hybrid")

            bm25_cls = bm25_module.BM25
            vector_cls = vector_module.VectorStore
            hybrid_cls = hybrid_module.HybridSearch
        else:
            bm25_cls = None
            vector_cls = None
            hybrid_cls = None

        self._vector_store = vector_store or vector_cls(str(self._vector_db_path))
        self._bm25 = bm25 or bm25_cls(k1=bm25_k1, b=bm25_b)
        self._hybrid_search = hybrid_search or hybrid_cls(
            self._vector_store,
            self._bm25,
            vector_weight=vector_weight,
            bm25_weight=bm25_weight,
        )

        self._rebuild_bm25_index()

    def _fallback_embedding(self, text: str, dim: int = 16) -> list[float]:
        # Deterministic fallback embedding for environments without model providers.
        digest = hashlib.sha256(text.encode("utf-8")).digest()
        values: list[float] = []
        for index in range(dim):
            start = (index * 2) % len(digest)
            chunk = digest[start : start + 2]
            if len(chunk) < 2:
                chunk = (chunk + digest)[:2]
            number = int.from_bytes(chunk, byteorder="big")
            values.append(number / 65535.0)
        return values

    def _normalize_datetime(self, value: datetime | str | None) -> datetime:
        if value is None:
            return datetime.now(UTC)
        if isinstance(value, datetime):
            return value
        return datetime.fromisoformat(value.replace("Z", "+00:00"))

    def _normalize_category(self, category: Any) -> str:
        if category is None:
            return "context"
        if hasattr(category, "value"):
            return str(category.value)
        return str(category).lower()

    def _normalize_item(self, item: dict[str, Any] | Any) -> dict[str, Any]:
        if isinstance(item, dict):
            raw = dict(item)
        else:
            raw = {
                "id": getattr(item, "id", None),
                "content": getattr(item, "content", ""),
                "category": getattr(item, "category", "context"),
                "confidence": getattr(item, "confidence", 0.5),
                "entities": getattr(item, "entities", []),
                "relations": getattr(item, "relations", []),
                "created_at": getattr(item, "created_at", None),
                "last_accessed": getattr(item, "last_accessed", None),
                "access_count": getattr(item, "access_count", 0),
            }

        created_at = self._normalize_datetime(raw.get("created_at"))
        last_accessed = self._normalize_datetime(raw.get("last_accessed"))

        entities = raw.get("entities")
        if not isinstance(entities, list):
            entities = []
        relations = raw.get("relations")
        if not isinstance(relations, list):
            relations = []

        return {
            "id": str(raw.get("id") or f"item_{uuid.uuid4().hex[:8]}"),
            "content": str(raw.get("content", "")),
            "category": self._normalize_category(raw.get("category")),
            "confidence": float(raw.get("confidence", 0.5)),
            "entities": entities,
            "relations": relations,
            "created_at": created_at.isoformat(),
            "last_accessed": last_accessed.isoformat(),
            "access_count": int(raw.get("access_count", 0)),
        }

    def _load_items(self) -> dict[str, dict[str, Any]]:
        if not self._items_file.exists():
            return {}

        with open(self._items_file, encoding="utf-8") as f:
            items = json.load(f)
        return {item["id"]: item for item in items}

    def _save_items(self) -> None:
        ordered = sorted(
            self._items.values(),
            key=lambda item: item.get("created_at", ""),
            reverse=True,
        )
        with open(self._items_file, "w", encoding="utf-8") as f:
            json.dump(ordered, f, indent=2, ensure_ascii=False)

    def _rebuild_bm25_index(self) -> None:
        docs: list[str] = []
        self._doc_ids = []
        for item_id, item in self._items.items():
            docs.append(item.get("content", ""))
            self._doc_ids.append(item_id)
        self._bm25.fit(docs)

    def _embed_text(self, text: str) -> list[float]:
        if self._embedding_provider is None:
            return self._fallback_embedding(text)
        return self._embedding_provider.embed(text)

    def store(self, item: dict[str, Any] | Any) -> dict[str, Any]:
        """Store one structured memory item and its embedding."""
        normalized = self._normalize_item(item)
        embedding = self._embed_text(normalized["content"])

        with self._lock:
            self._items[normalized["id"]] = normalized
            self._vector_store.add_vector(
                id=normalized["id"],
                content=normalized["content"],
                embedding=embedding,
                category=normalized["category"],
                metadata={"confidence": normalized["confidence"]},
            )
            self._save_items()
            self._rebuild_bm25_index()

        return normalized

    def get(self, item_id: str) -> dict[str, Any] | None:
        """Get one item by id."""
        with self._lock:
            item = self._items.get(item_id)
        if item is None:
            return None
        return dict(item)

    def list_items(self) -> list[dict[str, Any]]:
        """List all stored items."""
        with self._lock:
            return [dict(item) for item in self._items.values()]

    def search(
        self,
        query: str,
        top_k: int = 5,
        query_embedding: list[float] | None = None,
    ) -> list[dict[str, Any]]:
        """Search stored memory items using hybrid retrieval."""
        if not query.strip():
            return []
        with self._lock:
            if not self._items:
                return []
            items_snapshot = {
                item_id: dict(item) for item_id, item in self._items.items()
            }
            doc_ids_snapshot = list(self._doc_ids)

        embedding = query_embedding or self._embed_text(query)
        try:
            results = self._hybrid_search.search(
                query,
                embedding,
                top_k=top_k,
                bm25_doc_ids=doc_ids_snapshot,
            )
        except TypeError:
            results = self._hybrid_search.search(query, embedding, top_k=top_k)

        enriched: list[dict[str, Any]] = []
        for result in results:
            item_id = result.get("id")
            if item_id is None:
                continue

            item = items_snapshot.get(str(item_id))
            if item is None:
                continue

            enriched_item = dict(item)
            enriched_item["bm25_score"] = result.get("bm25_score", 0.0)
            enriched_item["vector_score"] = result.get("vector_score", 0.0)
            enriched_item["fused_score"] = result.get("fused_score", 0.0)
            enriched.append(enriched_item)
        return enriched

    def delete(self, item_id: str) -> bool:
        """Delete one item and keep indexes/stores in sync."""
        with self._lock:
            if item_id not in self._items:
                return False

            self._items.pop(item_id, None)
            if hasattr(self._vector_store, "delete_vector"):
                self._vector_store.delete_vector(item_id)
            self._save_items()
            self._rebuild_bm25_index()
            return True

    def update_access(self, item_id: str) -> bool:
        """Update access counters for one item."""
        with self._lock:
            item = self._items.get(item_id)
            if item is None:
                return False

            item["access_count"] = int(item.get("access_count", 0)) + 1
            item["last_accessed"] = datetime.now(UTC).isoformat()
            self._save_items()
            self._vector_store.update_access(item_id)
            return True

    def close(self) -> None:
        """Close underlying resources."""
        self._vector_store.close()


__all__ = ["ItemLayer"]
