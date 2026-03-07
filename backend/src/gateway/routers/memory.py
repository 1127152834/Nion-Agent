"""Memory API router for retrieving and managing global memory data."""

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from src.agents.memory.memory import (
    delete_memory_fact,
    get_memory_data,
    pin_memory_fact,
    reload_memory_data,
    update_memory_fact,
)
from src.config.memory_config import get_memory_config

router = APIRouter(prefix="/api", tags=["memory"])


class ContextSection(BaseModel):
    """Model for context sections (user and history)."""

    summary: str = Field(default="", description="Summary content")
    updatedAt: str = Field(default="", description="Last update timestamp")


class UserContext(BaseModel):
    """Model for user context."""

    workContext: ContextSection = Field(default_factory=ContextSection)
    personalContext: ContextSection = Field(default_factory=ContextSection)
    topOfMind: ContextSection = Field(default_factory=ContextSection)


class HistoryContext(BaseModel):
    """Model for history context."""

    recentMonths: ContextSection = Field(default_factory=ContextSection)
    earlierContext: ContextSection = Field(default_factory=ContextSection)
    longTermBackground: ContextSection = Field(default_factory=ContextSection)


class Fact(BaseModel):
    """Model for a memory fact."""

    id: str = Field(..., description="Unique identifier for the fact")
    content: str = Field(..., description="Fact content")
    category: str = Field(default="context", description="Fact category")
    confidence: float = Field(default=0.5, description="Confidence score (0-1)")
    createdAt: str = Field(default="", description="Creation timestamp")
    source: str = Field(default="unknown", description="Source thread ID")
    pinned: bool = Field(default=False, description="Whether this fact is pinned")
    inaccurate: bool = Field(default=False, description="Whether this fact is flagged inaccurate")


class FactUpdateRequest(BaseModel):
    """Request model for patching a memory fact."""

    content: str | None = Field(default=None, description="Updated fact content")
    category: str | None = Field(default=None, description="Updated fact category")
    confidence: float | None = Field(default=None, description="Updated confidence score (0-1)")
    pinned: bool | None = Field(default=None, description="Pinned state")
    inaccurate: bool | None = Field(default=None, description="Inaccurate marker")


class PinFactRequest(BaseModel):
    """Request model for pin/unpin operation."""

    pinned: bool | None = Field(default=None, description="When omitted, toggles pinned state")


class DeleteFactResponse(BaseModel):
    """Response model for fact deletion."""

    success: bool = Field(..., description="Whether deletion succeeded")
    id: str = Field(..., description="Deleted fact ID")


class MemoryResponse(BaseModel):
    """Response model for memory data."""

    version: str = Field(default="2.0", description="Memory schema version")
    lastUpdated: str = Field(default="", description="Last update timestamp")
    user: UserContext = Field(default_factory=UserContext)
    history: HistoryContext = Field(default_factory=HistoryContext)
    facts: list[Fact] = Field(default_factory=list)
    items: list[dict[str, Any]] = Field(default_factory=list, description="V2 item-layer memories")
    categories: dict[str, list[dict[str, Any]]] = Field(
        default_factory=dict,
        description="V2 category index",
    )
    resources: list[dict[str, Any]] = Field(default_factory=list, description="V2 raw resources")
    legacy: dict[str, Any] | None = Field(default=None, description="Legacy memory payload")


class MemoryConfigResponse(BaseModel):
    """Response model for memory configuration."""

    enabled: bool = Field(..., description="Whether memory is enabled")
    storage_path: str = Field(..., description="Path to memory storage file")
    debounce_seconds: int = Field(..., description="Debounce time for memory updates")
    max_facts: int = Field(..., description="Maximum number of facts to store")
    fact_confidence_threshold: float = Field(..., description="Minimum confidence threshold for facts")
    injection_enabled: bool = Field(..., description="Whether memory injection is enabled")
    max_injection_tokens: int = Field(..., description="Maximum tokens for memory injection")
    vector_weight: float = Field(..., description="Hybrid search vector score weight")
    bm25_weight: float = Field(..., description="Hybrid search BM25 score weight")
    bm25_k1: float = Field(..., description="BM25 k1 parameter")
    bm25_b: float = Field(..., description="BM25 b parameter")
    proactive_enabled: bool = Field(..., description="Whether dual-mode retriever is enabled")
    evolution_enabled: bool = Field(..., description="Whether self-evolving engine is enabled")
    compression_threshold: int = Field(..., description="Compression threshold for evolution")
    merge_similarity_threshold: float = Field(..., description="Merge similarity threshold")
    staleness_threshold_days: int = Field(..., description="Staleness threshold in days")
    max_items_before_compress: int = Field(..., description="Item count threshold for compression")
    redundancy_threshold: float = Field(..., description="Redundancy threshold for compression")
    min_category_usage: int = Field(..., description="Minimum category usage for optimization")


class MemoryStatusResponse(BaseModel):
    """Response model for memory status."""

    config: MemoryConfigResponse
    data: MemoryResponse


@router.get(
    "/memory",
    response_model=MemoryResponse,
    summary="Get Memory Data",
    description="Retrieve the current global memory data including user context, history, and facts.",
)
async def get_memory() -> MemoryResponse:
    """Get the current global memory data.

    Returns:
        The current memory data with user context, history, and facts.

    Example Response:
        ```json
        {
            "version": "1.0",
            "lastUpdated": "2024-01-15T10:30:00Z",
            "user": {
                "workContext": {"summary": "Working on Nion project", "updatedAt": "..."},
                "personalContext": {"summary": "Prefers concise responses", "updatedAt": "..."},
                "topOfMind": {"summary": "Building memory API", "updatedAt": "..."}
            },
            "history": {
                "recentMonths": {"summary": "Recent development activities", "updatedAt": "..."},
                "earlierContext": {"summary": "", "updatedAt": ""},
                "longTermBackground": {"summary": "", "updatedAt": ""}
            },
            "facts": [
                {
                    "id": "fact_abc123",
                    "content": "User prefers TypeScript over JavaScript",
                    "category": "preference",
                    "confidence": 0.9,
                    "createdAt": "2024-01-15T10:30:00Z",
                    "source": "thread_xyz"
                }
            ]
        }
        ```
    """
    memory_data = get_memory_data()
    return MemoryResponse(**memory_data)


@router.post(
    "/memory/reload",
    response_model=MemoryResponse,
    summary="Reload Memory Data",
    description="Reload memory data from the storage file, refreshing the in-memory cache.",
)
async def reload_memory() -> MemoryResponse:
    """Reload memory data from file.

    This forces a reload of the memory data from the storage file,
    useful when the file has been modified externally.

    Returns:
        The reloaded memory data.
    """
    memory_data = reload_memory_data()
    return MemoryResponse(**memory_data)


@router.get(
    "/memory/config",
    response_model=MemoryConfigResponse,
    summary="Get Memory Configuration",
    description="Retrieve the current memory system configuration.",
)
async def get_memory_config_endpoint() -> MemoryConfigResponse:
    """Get the memory system configuration.

    Returns:
        The current memory configuration settings.

    Example Response:
        ```json
        {
            "enabled": true,
            "storage_path": ".nion/memory.json",
            "debounce_seconds": 30,
            "max_facts": 100,
            "fact_confidence_threshold": 0.7,
            "injection_enabled": true,
            "max_injection_tokens": 2000
        }
        ```
    """
    config = get_memory_config()
    return MemoryConfigResponse(
        enabled=config.enabled,
        storage_path=config.storage_path,
        debounce_seconds=config.debounce_seconds,
        max_facts=config.max_facts,
        fact_confidence_threshold=config.fact_confidence_threshold,
        injection_enabled=config.injection_enabled,
        max_injection_tokens=config.max_injection_tokens,
        vector_weight=config.vector_weight,
        bm25_weight=config.bm25_weight,
        bm25_k1=config.bm25_k1,
        bm25_b=config.bm25_b,
        proactive_enabled=config.proactive_enabled,
        evolution_enabled=config.evolution_enabled,
        compression_threshold=config.compression_threshold,
        merge_similarity_threshold=config.merge_similarity_threshold,
        staleness_threshold_days=config.staleness_threshold_days,
        max_items_before_compress=config.max_items_before_compress,
        redundancy_threshold=config.redundancy_threshold,
        min_category_usage=config.min_category_usage,
    )


@router.get(
    "/memory/status",
    response_model=MemoryStatusResponse,
    summary="Get Memory Status",
    description="Retrieve both memory configuration and current data in a single request.",
)
async def get_memory_status() -> MemoryStatusResponse:
    """Get the memory system status including configuration and data.

    Returns:
        Combined memory configuration and current data.
    """
    config = get_memory_config()
    memory_data = get_memory_data()

    return MemoryStatusResponse(
        config=MemoryConfigResponse(
            enabled=config.enabled,
            storage_path=config.storage_path,
            debounce_seconds=config.debounce_seconds,
            max_facts=config.max_facts,
            fact_confidence_threshold=config.fact_confidence_threshold,
            injection_enabled=config.injection_enabled,
            max_injection_tokens=config.max_injection_tokens,
            vector_weight=config.vector_weight,
            bm25_weight=config.bm25_weight,
            bm25_k1=config.bm25_k1,
            bm25_b=config.bm25_b,
            proactive_enabled=config.proactive_enabled,
            evolution_enabled=config.evolution_enabled,
            compression_threshold=config.compression_threshold,
            merge_similarity_threshold=config.merge_similarity_threshold,
            staleness_threshold_days=config.staleness_threshold_days,
            max_items_before_compress=config.max_items_before_compress,
            redundancy_threshold=config.redundancy_threshold,
            min_category_usage=config.min_category_usage,
        ),
        data=MemoryResponse(**memory_data),
    )


@router.patch(
    "/memory/facts/{fact_id}",
    response_model=Fact,
    summary="Patch Memory Fact",
    description="Update one memory fact field(s), such as content/category/confidence/inaccurate.",
)
async def patch_memory_fact(fact_id: str, request: FactUpdateRequest) -> Fact:
    payload = request.model_dump(exclude_none=True)
    if not payload:
        raise HTTPException(status_code=400, detail="No fact fields provided for update.")

    updated = update_memory_fact(fact_id=fact_id, updates=payload)
    if updated is None:
        raise HTTPException(status_code=404, detail=f"Fact not found: {fact_id}")
    return Fact(**updated)


@router.post(
    "/memory/facts/{fact_id}/pin",
    response_model=Fact,
    summary="Pin or Unpin Memory Fact",
    description="Set or toggle the pinned state of one memory fact.",
)
async def toggle_memory_fact_pin(fact_id: str, request: PinFactRequest) -> Fact:
    updated = pin_memory_fact(fact_id=fact_id, pinned=request.pinned)
    if updated is None:
        raise HTTPException(status_code=404, detail=f"Fact not found: {fact_id}")
    return Fact(**updated)


@router.delete(
    "/memory/facts/{fact_id}",
    response_model=DeleteFactResponse,
    summary="Delete Memory Fact",
    description="Delete one memory fact by ID.",
)
async def remove_memory_fact(fact_id: str) -> DeleteFactResponse:
    success = delete_memory_fact(fact_id=fact_id)
    if not success:
        raise HTTPException(status_code=404, detail=f"Fact not found: {fact_id}")
    return DeleteFactResponse(success=True, id=fact_id)
