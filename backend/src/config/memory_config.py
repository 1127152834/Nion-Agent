"""Configuration for OpenViking memory mechanism."""

from pydantic import BaseModel, Field


class MemoryConfig(BaseModel):
    """Configuration for global memory mechanism."""

    version: str = Field(
        default="4.0",
        description="Memory system version identifier.",
    )
    enabled: bool = Field(
        default=True,
        description="Whether to enable memory mechanism",
    )
    debounce_seconds: int = Field(
        default=30,
        ge=1,
        le=300,
        description="Seconds to wait before processing queued updates (debounce)",
    )
    model_name: str | None = Field(
        default=None,
        description="Model name to use for memory updates (None = use default model)",
    )
    embedding_provider: str = Field(
        default="",
        description="Embedding backend: sentence-transformers | openai (empty = disabled)",
    )
    embedding_model: str = Field(
        default="",
        description="Embedding model name (empty = disabled).",
    )
    embedding_api_key: str | None = Field(
        default=None,
        description="Optional API key for embedding providers requiring credentials.",
    )
    vector_store_path: str = Field(
        default="",
        description=("Path to vector storage. This field is retained for compatibility with retrieval settings."),
    )
    vector_weight: float = Field(
        default=0.5,
        ge=0.0,
        le=1.0,
        description="Fusion weight for vector similarity scores.",
    )
    bm25_weight: float = Field(
        default=0.5,
        ge=0.0,
        le=1.0,
        description="Fusion weight for BM25 scores.",
    )
    bm25_k1: float = Field(
        default=1.5,
        ge=0.0,
        le=3.0,
        description="BM25 k1 parameter.",
    )
    bm25_b: float = Field(
        default=0.75,
        ge=0.0,
        le=1.0,
        description="BM25 b parameter.",
    )
    proactive_enabled: bool = Field(
        default=True,
        description="Whether to enable dual-mode proactive retrieval.",
    )
    fast_mode_threshold: float = Field(
        default=0.7,
        ge=0.0,
        le=1.0,
        description="Confidence threshold to keep retrieval in fast mode.",
    )
    deep_mode_threshold: float = Field(
        default=0.3,
        ge=0.0,
        le=1.0,
        description="Confidence threshold to trigger deep reasoning mode.",
    )
    evolution_enabled: bool = Field(
        default=True,
        description="Whether to enable the self-evolving memory engine.",
    )
    evolution_interval_hours: int = Field(
        default=24,
        ge=1,
        le=168,
        description="Interval for scheduled memory evolution.",
    )
    compression_threshold: int = Field(
        default=10,
        ge=2,
        le=1000,
        description="Minimum group size used by compression logic.",
    )
    merge_similarity_threshold: float = Field(
        default=0.85,
        ge=0.0,
        le=1.0,
        description="Similarity threshold for automatic merge.",
    )
    staleness_threshold_days: int = Field(
        default=90,
        ge=1,
        le=3650,
        description="Days after which rarely used memories are considered stale.",
    )
    max_items_before_compress: int = Field(
        default=200,
        ge=10,
        le=100000,
        description="Item-count threshold to trigger compression.",
    )
    redundancy_threshold: float = Field(
        default=0.3,
        ge=0.0,
        le=1.0,
        description="Redundancy threshold to trigger compression.",
    )
    min_category_usage: int = Field(
        default=3,
        ge=1,
        le=1000,
        description="Minimum usage count to keep category untouched during optimization.",
    )
    max_facts: int = Field(
        default=200,
        ge=10,
        le=1000,
        description="Maximum number of facts to cache in compatibility views",
    )
    fact_confidence_threshold: float = Field(
        default=0.7,
        ge=0.0,
        le=1.0,
        description="Minimum confidence threshold for storing facts",
    )
    injection_enabled: bool = Field(
        default=True,
        description="Whether to inject memory into system prompt",
    )
    max_injection_tokens: int = Field(
        default=2000,
        ge=100,
        le=8000,
        description="Maximum tokens to use for memory injection",
    )
    provider: str = Field(
        default="openviking",
        description="Memory provider (fixed to openviking).",
    )
    openviking_context_enabled: bool = Field(
        default=True,
        description="Whether to inject OpenViking lightweight context before model calls.",
    )
    openviking_context_limit: int = Field(
        default=3,
        ge=1,
        le=20,
        description="Max OpenViking context hits used for prompt injection.",
    )
    openviking_session_commit_enabled: bool = Field(
        default=True,
        description="Whether to commit session to OpenViking after each chat round.",
    )
    retrieval_mode: str = Field(
        default="find",
        description="Retrieval routing mode: find | vector_auto | vector_forced",
    )
    rerank_mode: str = Field(
        default="auto",
        description="Rerank mode: off | auto | forced",
    )
    graph_enabled: bool = Field(
        default=True,
        description="Whether to enable SQLite memory graph indexing and querying.",
    )


# Global configuration instance
_memory_config: MemoryConfig = MemoryConfig()


def get_memory_config() -> MemoryConfig:
    """Get the current memory configuration."""
    return _memory_config


def set_memory_config(config: MemoryConfig) -> None:
    """Set the memory configuration."""
    global _memory_config
    _memory_config = config


def load_memory_config_from_dict(config_dict: dict) -> None:
    """Load memory configuration from a dictionary."""
    global _memory_config
    normalized = dict(config_dict)

    # OpenViking hard-cut: provider is always fixed.
    normalized["provider"] = "openviking"

    retrieval_mode = str(normalized.get("retrieval_mode", "find")).strip().lower()
    if retrieval_mode not in {"find", "vector_auto", "vector_forced"}:
        retrieval_mode = "find"
    normalized["retrieval_mode"] = retrieval_mode

    rerank_mode = str(normalized.get("rerank_mode", "auto")).strip().lower()
    if rerank_mode not in {"off", "auto", "forced"}:
        rerank_mode = "auto"
    normalized["rerank_mode"] = rerank_mode

    _memory_config = MemoryConfig(**normalized)
