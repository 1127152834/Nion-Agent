"""Embedding models API router."""

from __future__ import annotations

import logging
import time
from typing import Any, Literal

from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.embedding_models import EmbeddingModelsError, EmbeddingModelsService

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/embedding-models", tags=["embedding-models"])


class EmbeddingOperationResponse(BaseModel):
    """Response for embedding operations."""

    status: Literal["ok", "degraded", "disabled"] = Field(default="ok")
    latency_ms: int = Field(default=0)
    error_code: str | None = Field(default=None)
    result: dict[str, Any] | None = Field(default=None)


class EmbeddingTestRequest(BaseModel):
    """Request for testing embedding."""

    text: str = Field(default="test embedding", min_length=1)


class SetActiveModelRequest(BaseModel):
    """Request for setting active model."""

    provider: Literal["local", "openai", "custom"] = Field(...)
    model: str = Field(...)
    api_key: str | None = Field(default=None)
    api_base: str | None = Field(default=None)
    dimension: int | None = Field(default=None)
    device: str | None = Field(default=None)


def _latency_ms(started_at: float) -> int:
    return max(0, int((time.perf_counter() - started_at) * 1000))


def _degraded_response(started_at: float, error: EmbeddingModelsError) -> EmbeddingOperationResponse:
    latency = _latency_ms(started_at)
    logger.warning("embedding-models degraded latency_ms=%s error_code=%s", latency, error.error_code)
    return EmbeddingOperationResponse(
        status="degraded",
        latency_ms=latency,
        error_code=error.error_code,
        result={"message": str(error)},
    )


@router.get(
    "/status",
    response_model=EmbeddingOperationResponse,
    summary="Get embedding models status",
)
async def get_status() -> EmbeddingOperationResponse:
    """Get current embedding models status."""
    started_at = time.perf_counter()
    service = EmbeddingModelsService()
    try:
        result = service.get_status()
    except EmbeddingModelsError as error:
        return _degraded_response(started_at, error)

    status = "disabled" if result.get("enabled") is False else "ok"
    latency = _latency_ms(started_at)
    return EmbeddingOperationResponse(
        status=status,
        latency_ms=latency,
        error_code=None,
        result=result,
    )


@router.get(
    "/presets",
    response_model=EmbeddingOperationResponse,
    summary="Get preset models list",
)
async def get_presets() -> EmbeddingOperationResponse:
    """Get preset embedding models."""
    started_at = time.perf_counter()
    service = EmbeddingModelsService()
    try:
        result = service.get_presets()
    except EmbeddingModelsError as error:
        return _degraded_response(started_at, error)

    latency = _latency_ms(started_at)
    return EmbeddingOperationResponse(
        status="ok",
        latency_ms=latency,
        error_code=None,
        result=result,
    )


@router.post(
    "/test",
    response_model=EmbeddingOperationResponse,
    summary="Test embedding configuration",
)
async def test_embedding(request: EmbeddingTestRequest) -> EmbeddingOperationResponse:
    """Test current embedding configuration."""
    started_at = time.perf_counter()
    service = EmbeddingModelsService()
    try:
        result = await service.test_embedding(text=request.text)
    except EmbeddingModelsError as error:
        return _degraded_response(started_at, error)

    latency = _latency_ms(started_at)
    return EmbeddingOperationResponse(
        status="ok",
        latency_ms=latency,
        error_code=None,
        result=result,
    )


@router.post(
    "/set-active",
    response_model=EmbeddingOperationResponse,
    summary="Set active embedding model",
)
async def set_active_model(request: SetActiveModelRequest) -> EmbeddingOperationResponse:
    """Set active embedding model."""
    started_at = time.perf_counter()
    service = EmbeddingModelsService()
    try:
        result = service.set_active_model(
            provider=request.provider,
            model=request.model,
            api_key=request.api_key,
            api_base=request.api_base,
            dimension=request.dimension,
            device=request.device,
        )
    except EmbeddingModelsError as error:
        return _degraded_response(started_at, error)

    latency = _latency_ms(started_at)
    return EmbeddingOperationResponse(
        status="ok",
        latency_ms=latency,
        error_code=None,
        result=result,
    )
