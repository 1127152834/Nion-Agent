"""Hybrid retrieval combining BM25 and vector similarity."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from typing import Any


class HybridSearch:
    """Fuse BM25 and vector retrieval scores."""

    def __init__(
        self,
        vector_store: Any,
        bm25: Any,
        vector_weight: float = 0.5,
        bm25_weight: float = 0.5,
    ) -> None:
        self.vector_store = vector_store
        self.bm25 = bm25
        self.vector_weight = vector_weight
        self.bm25_weight = bm25_weight

    def _normalize(self, value: float, max_value: float) -> float:
        if max_value <= 0:
            return 0.0
        return value / max_value

    def _resolve_bm25_item_id(
        self,
        bm25_item: dict[str, Any],
        bm25_doc_ids: list[str] | None,
    ) -> str | None:
        if "id" in bm25_item and bm25_item.get("id") is not None:
            return str(bm25_item["id"])

        idx = bm25_item.get("idx")
        if idx is None or bm25_doc_ids is None:
            return None

        try:
            pos = int(idx)
        except (TypeError, ValueError):
            return None

        if pos < 0 or pos >= len(bm25_doc_ids):
            return None
        return str(bm25_doc_ids[pos])

    def search(
        self,
        query: str,
        query_embedding: list[float],
        top_k: int = 5,
        bm25_doc_ids: list[str] | None = None,
    ) -> list[dict[str, Any]]:
        """Run BM25 + vector search in parallel and return fused ranking."""
        if top_k <= 0:
            return []

        with ThreadPoolExecutor(max_workers=2) as executor:
            bm25_future = executor.submit(self.bm25.search, query, top_k * 2)
            vector_future = executor.submit(self.vector_store.search_similar, query_embedding, top_k * 2)
            bm25_results = bm25_future.result()
            vector_results = vector_future.result()

        bm25_by_id: dict[str, dict[str, Any]] = {}
        for item in bm25_results:
            item_id = self._resolve_bm25_item_id(item, bm25_doc_ids)
            if item_id is None:
                continue
            bm25_by_id[item_id] = item

        vector_by_id: dict[str, dict[str, Any]] = {}
        for item in vector_results:
            item_id = item.get("id")
            if item_id is None:
                continue
            vector_by_id[str(item_id)] = item

        bm25_max = max((float(item["score"]) for item in bm25_by_id.values()), default=0.0)
        vector_max = max((float(item["similarity"]) for item in vector_by_id.values()), default=0.0)

        merged_ids = set(bm25_by_id) | set(vector_by_id)
        fused: list[dict[str, Any]] = []

        for item_id in merged_ids:
            bm25_item = bm25_by_id.get(item_id, {})
            vector_item = vector_by_id.get(item_id, {})
            bm25_score = self._normalize(float(bm25_item.get("score", 0.0)), bm25_max)
            vector_score = self._normalize(float(vector_item.get("similarity", 0.0)), vector_max)
            fused_score = self.vector_weight * vector_score + self.bm25_weight * bm25_score

            fused.append(
                {
                    "id": item_id,
                    "content": vector_item.get("content") or bm25_item.get("document", ""),
                    "category": vector_item.get("category"),
                    "bm25_score": bm25_score,
                    "vector_score": vector_score,
                    "fused_score": fused_score,
                    "access_count": vector_item.get("access_count", 0),
                }
            )

        fused.sort(key=lambda item: item["fused_score"], reverse=True)
        return fused[:top_k]


__all__ = ["HybridSearch"]
