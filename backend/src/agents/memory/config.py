"""Runtime config helpers for memory v2."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any


@dataclass
class MemoryRuntimeConfig:
    """Runtime-oriented memory config used by the v2 manager."""

    base_dir: Path
    fallback_to_v1: bool = True
    embedding_provider: str = "sentence-transformers"
    embedding_model: str = "all-MiniLM-L6-v2"
    embedding_api_key: str | None = None
    vector_store_path: str = ""
    vector_weight: float = 0.5
    bm25_weight: float = 0.5
    bm25_k1: float = 1.5
    bm25_b: float = 0.75
    proactive_enabled: bool = True
    fast_mode_threshold: float = 0.7
    deep_mode_threshold: float = 0.3
    evolution_enabled: bool = True
    evolution_interval_hours: int = 24
    compression_threshold: int = 10
    merge_similarity_threshold: float = 0.85
    staleness_threshold_days: int = 90
    max_items_before_compress: int = 200
    redundancy_threshold: float = 0.3
    min_category_usage: int = 3

    @classmethod
    def from_dict(
        cls,
        config: dict[str, Any] | None = None,
        base_dir: str | Path | None = None,
    ) -> MemoryRuntimeConfig:
        payload = config or {}
        resolved_base = Path(base_dir) if base_dir is not None else Path.cwd()

        return cls(
            base_dir=resolved_base,
            fallback_to_v1=bool(payload.get("fallback_to_v1", True)),
            embedding_provider=str(payload.get("embedding_provider", "sentence-transformers")),
            embedding_model=str(payload.get("embedding_model", "all-MiniLM-L6-v2")),
            embedding_api_key=payload.get("embedding_api_key"),
            vector_store_path=str(payload.get("vector_store_path", "")),
            vector_weight=float(payload.get("vector_weight", 0.5)),
            bm25_weight=float(payload.get("bm25_weight", 0.5)),
            bm25_k1=float(payload.get("bm25_k1", 1.5)),
            bm25_b=float(payload.get("bm25_b", 0.75)),
            proactive_enabled=bool(payload.get("proactive_enabled", True)),
            fast_mode_threshold=float(payload.get("fast_mode_threshold", 0.7)),
            deep_mode_threshold=float(payload.get("deep_mode_threshold", 0.3)),
            evolution_enabled=bool(payload.get("evolution_enabled", True)),
            evolution_interval_hours=int(payload.get("evolution_interval_hours", 24)),
            compression_threshold=int(payload.get("compression_threshold", 10)),
            merge_similarity_threshold=float(payload.get("merge_similarity_threshold", 0.85)),
            staleness_threshold_days=int(payload.get("staleness_threshold_days", 90)),
            max_items_before_compress=int(payload.get("max_items_before_compress", 200)),
            redundancy_threshold=float(payload.get("redundancy_threshold", 0.3)),
            min_category_usage=int(payload.get("min_category_usage", 3)),
        )

    def to_dict(self) -> dict[str, Any]:
        data = asdict(self)
        data["base_dir"] = str(self.base_dir)
        return data


__all__ = ["MemoryRuntimeConfig"]
