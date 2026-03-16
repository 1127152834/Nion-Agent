from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any, Literal

from fastapi import APIRouter, File, Form, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from src.retrieval_models import RetrievalModelsError, RetrievalModelsService

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/retrieval-models", tags=["retrieval-models"])


class RetrievalOperationResponse(BaseModel):
    status: Literal["ok", "degraded", "disabled"] = Field(default="ok")
    latency_ms: int = Field(default=0)
    error_code: str | None = Field(default=None)
    result: dict[str, Any] | None = Field(default=None)


class RetrievalEmbeddingTestRequest(BaseModel):
    text: str = Field(default="retrieval embedding test", min_length=1)
    profile: str | None = Field(default=None)


class RetrievalRerankTestRequest(BaseModel):
    query: str = Field(..., min_length=1)
    documents: list[str] = Field(default_factory=list)
    profile: str | None = Field(default=None)


class RetrievalSwitchProfileRequest(BaseModel):
    profile: str = Field(..., min_length=1)


class RetrievalSetActiveModelRequest(BaseModel):
    family: Literal["embedding", "rerank"] = Field(...)
    provider: Literal["local_onnx", "openai_compatible", "rerank_api"] = Field(...)
    model_id: str | None = Field(default=None)
    model: str | None = Field(default=None)


class RetrievalProviderConnectionTestRequest(BaseModel):
    family: Literal["embedding", "rerank"] = Field(...)
    provider: Literal["openai_compatible", "rerank_api"] = Field(...)
    model: str | None = Field(default=None)


class RetrievalSetActivePackRequest(BaseModel):
    pack_id: str = Field(..., min_length=1)


class RetrievalDownloadPackRequest(BaseModel):
    pack_id: str = Field(..., min_length=1)
    activate_after_download: bool = Field(default=False)


class RetrievalRemovePackRequest(BaseModel):
    pack_id: str = Field(..., min_length=1)


def _latency_ms(started_at: float) -> int:
    return max(0, int((time.perf_counter() - started_at) * 1000))


def _degraded_response(started_at: float, error: RetrievalModelsError) -> RetrievalOperationResponse:
    latency = _latency_ms(started_at)
    logger.warning("retrieval-models degraded latency_ms=%s error_code=%s", latency, error.error_code)
    return RetrievalOperationResponse(
        status="degraded",
        latency_ms=latency,
        error_code=error.error_code,
        result={"message": str(error)},
    )


@router.get(
    "/status",
    response_model=RetrievalOperationResponse,
    summary="Get retrieval models status",
)
async def retrieval_models_status() -> RetrievalOperationResponse:
    started_at = time.perf_counter()
    service = RetrievalModelsService()
    try:
        result = service.build_status()
    except RetrievalModelsError as error:
        return _degraded_response(started_at, error)

    status = "disabled" if result.get("enabled") is False else "ok"
    latency = _latency_ms(started_at)
    return RetrievalOperationResponse(
        status=status,
        latency_ms=latency,
        error_code=None,
        result=result,
    )


@router.post(
    "/test-embedding",
    response_model=RetrievalOperationResponse,
    summary="Test embedding provider",
)
async def test_embedding(request: RetrievalEmbeddingTestRequest) -> RetrievalOperationResponse:
    started_at = time.perf_counter()
    service = RetrievalModelsService()
    try:
        result = await service.test_embedding(text=request.text, profile=request.profile)
    except RetrievalModelsError as error:
        return _degraded_response(started_at, error)
    latency = _latency_ms(started_at)
    return RetrievalOperationResponse(
        status="ok",
        latency_ms=latency,
        error_code=None,
        result=result,
    )


@router.post(
    "/test-rerank",
    response_model=RetrievalOperationResponse,
    summary="Test rerank provider",
)
async def test_rerank(request: RetrievalRerankTestRequest) -> RetrievalOperationResponse:
    started_at = time.perf_counter()
    service = RetrievalModelsService()
    documents = request.documents or ["Nion retrieval rerank test document"]
    try:
        result = await service.test_rerank(
            query=request.query,
            documents=documents,
            profile=request.profile,
        )
    except RetrievalModelsError as error:
        return _degraded_response(started_at, error)
    latency = _latency_ms(started_at)
    return RetrievalOperationResponse(
        status="ok",
        latency_ms=latency,
        error_code=None,
        result=result,
    )


@router.post(
    "/switch-profile",
    response_model=RetrievalOperationResponse,
    summary="Switch active retrieval profile",
    deprecated=True,
)
async def switch_profile(request: RetrievalSwitchProfileRequest) -> RetrievalOperationResponse:
    started_at = time.perf_counter()
    service = RetrievalModelsService()
    try:
        result = service.switch_profile(request.profile)
    except RetrievalModelsError as error:
        return _degraded_response(started_at, error)
    latency = _latency_ms(started_at)
    return RetrievalOperationResponse(
        status="ok",
        latency_ms=latency,
        error_code=None,
        result=result,
    )


@router.post(
    "/set-active-model",
    response_model=RetrievalOperationResponse,
    summary="Set active retrieval model for embedding/rerank",
)
async def set_active_model(request: RetrievalSetActiveModelRequest) -> RetrievalOperationResponse:
    started_at = time.perf_counter()
    service = RetrievalModelsService()
    try:
        result = service.set_active_model(
            family=request.family,
            provider=request.provider,
            model_id=request.model_id,
            model=request.model,
        )
    except RetrievalModelsError as error:
        return _degraded_response(started_at, error)
    latency = _latency_ms(started_at)
    return RetrievalOperationResponse(
        status="ok",
        latency_ms=latency,
        error_code=None,
        result=result,
    )


@router.post(
    "/set-active-pack",
    response_model=RetrievalOperationResponse,
    summary="Set active local retrieval pack",
)
async def set_active_pack(request: RetrievalSetActivePackRequest) -> RetrievalOperationResponse:
    started_at = time.perf_counter()
    service = RetrievalModelsService()
    try:
        result = service.set_active_pack(request.pack_id)
    except RetrievalModelsError as error:
        return _degraded_response(started_at, error)
    except Exception as error:  # noqa: BLE001
        logger.exception("set-active-pack failed unexpectedly")
        return _degraded_response(
            started_at,
            RetrievalModelsError(str(error), error_code="retrieval_models_error"),
        )
    latency = _latency_ms(started_at)
    return RetrievalOperationResponse(
        status="ok",
        latency_ms=latency,
        error_code=None,
        result=result,
    )


@router.post(
    "/test-provider-connection",
    response_model=RetrievalOperationResponse,
    summary="Test third-party retrieval provider connection",
)
async def test_provider_connection(request: RetrievalProviderConnectionTestRequest) -> RetrievalOperationResponse:
    started_at = time.perf_counter()
    service = RetrievalModelsService()
    try:
        result = await service.test_provider_connection(
            family=request.family,
            provider=request.provider,
            model=request.model,
        )
    except RetrievalModelsError as error:
        return _degraded_response(started_at, error)
    latency = _latency_ms(started_at)
    return RetrievalOperationResponse(
        status="ok",
        latency_ms=latency,
        error_code=None,
        result=result,
    )


class RetrievalDownloadModelRequest(BaseModel):
    model_id: str = Field(..., min_length=1)


class RetrievalRemoveModelRequest(BaseModel):
    model_id: str = Field(..., min_length=1)


class RetrievalImportModelRequest(BaseModel):
    model_id: str = Field(..., min_length=1)


@router.post(
    "/download-pack",
    response_model=RetrievalOperationResponse,
    summary="Download a retrieval pack",
)
async def download_pack(request: RetrievalDownloadPackRequest) -> RetrievalOperationResponse:
    started_at = time.perf_counter()
    service = RetrievalModelsService()
    try:
        result = await service.download_pack(
            pack_id=request.pack_id,
            activate_after_download=request.activate_after_download,
        )
    except RetrievalModelsError as error:
        return _degraded_response(started_at, error)
    except Exception as error:  # noqa: BLE001
        logger.exception("download-pack failed unexpectedly")
        return _degraded_response(
            started_at,
            RetrievalModelsError(str(error), error_code="retrieval_models_error"),
        )
    latency = _latency_ms(started_at)
    return RetrievalOperationResponse(
        status="ok",
        latency_ms=latency,
        error_code=None,
        result=result,
    )


@router.post(
    "/remove-pack",
    response_model=RetrievalOperationResponse,
    summary="Delete downloaded models in a retrieval pack",
)
async def remove_pack(request: RetrievalRemovePackRequest) -> RetrievalOperationResponse:
    started_at = time.perf_counter()
    service = RetrievalModelsService()
    try:
        result = await service.remove_pack(pack_id=request.pack_id)
    except RetrievalModelsError as error:
        return _degraded_response(started_at, error)
    except Exception as error:  # noqa: BLE001
        logger.exception("remove-pack failed unexpectedly")
        return _degraded_response(
            started_at,
            RetrievalModelsError(str(error), error_code="retrieval_models_error"),
        )
    latency = _latency_ms(started_at)
    return RetrievalOperationResponse(
        status="ok",
        latency_ms=latency,
        error_code=None,
        result=result,
    )


@router.post(
    "/download",
    response_model=RetrievalOperationResponse,
    summary="Download a retrieval model",
)
async def download_model(request: RetrievalDownloadModelRequest) -> RetrievalOperationResponse:
    started_at = time.perf_counter()
    service = RetrievalModelsService()
    try:
        result = await service.download_model(model_id=request.model_id)
    except RetrievalModelsError as error:
        return _degraded_response(started_at, error)
    latency = _latency_ms(started_at)
    return RetrievalOperationResponse(
        status="ok",
        latency_ms=latency,
        error_code=None,
        result=result,
    )


@router.post(
    "/remove",
    response_model=RetrievalOperationResponse,
    summary="Remove a retrieval model",
)
async def remove_model(request: RetrievalRemoveModelRequest) -> RetrievalOperationResponse:
    started_at = time.perf_counter()
    service = RetrievalModelsService()
    try:
        result = await service.remove_model(model_id=request.model_id)
    except RetrievalModelsError as error:
        return _degraded_response(started_at, error)
    latency = _latency_ms(started_at)
    return RetrievalOperationResponse(
        status="ok",
        latency_ms=latency,
        error_code=None,
        result=result,
    )


@router.get(
    "/download-stream/{model_id}",
    summary="Download a retrieval model with progress streaming (SSE)",
)
async def download_model_stream(model_id: str):
    """Stream download progress via Server-Sent Events."""

    async def event_generator():
        service = RetrievalModelsService()
        started_at = time.perf_counter()
        progress_queue: asyncio.Queue = asyncio.Queue()

        try:
            # Send start event
            yield f"data: {json.dumps({'type': 'start', 'model_id': model_id})}\n\n"

            # Progress callback that puts data into queue
            async def progress_callback(downloaded: int, total: int | None):
                await progress_queue.put(
                    {
                        "type": "progress",
                        "downloaded": downloaded,
                        "total": total,
                        "percentage": round((downloaded / total * 100), 2) if total else None,
                    }
                )

            # Start download in background task
            download_task = asyncio.create_task(service.download_model_with_progress(model_id=model_id, progress_callback=progress_callback))

            # Stream progress events
            while not download_task.done():
                try:
                    progress_data = await asyncio.wait_for(progress_queue.get(), timeout=0.1)
                    yield f"data: {json.dumps(progress_data)}\n\n"
                except TimeoutError:
                    continue

            # Drain remaining progress events
            while not progress_queue.empty():
                progress_data = await progress_queue.get()
                yield f"data: {json.dumps(progress_data)}\n\n"

            # Get download result
            result = await download_task

            # Send completion event
            latency = _latency_ms(started_at)
            completion_data = {
                "type": "complete",
                "latency_ms": latency,
                "result": result,
            }
            yield f"data: {json.dumps(completion_data)}\n\n"

        except RetrievalModelsError as error:
            # Send error event
            error_data = {
                "type": "error",
                "error_code": error.error_code,
                "message": str(error),
            }
            yield f"data: {json.dumps(error_data)}\n\n"

        except Exception as error:
            # Send unexpected error event
            logger.exception("Unexpected error in download_model_stream")
            error_data = {
                "type": "error",
                "error_code": "unexpected_error",
                "message": str(error),
            }
            yield f"data: {json.dumps(error_data)}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post(
    "/import",
    response_model=RetrievalOperationResponse,
    summary="Import a retrieval model from file",
)
async def import_model(
    model_id: str = Form(...),
    file: UploadFile = File(...),
) -> RetrievalOperationResponse:
    started_at = time.perf_counter()
    service = RetrievalModelsService()

    # Validate file extension
    if not file.filename or not file.filename.endswith(".onnx"):
        return RetrievalOperationResponse(
            status="degraded",
            latency_ms=_latency_ms(started_at),
            error_code="invalid_file_type",
            result={"message": "Only .onnx files are supported"},
        )

    try:
        # Read file content
        file_content = await file.read()

        # Import model
        result = await service.import_model(model_id=model_id, file_content=file_content)
    except RetrievalModelsError as error:
        return _degraded_response(started_at, error)

    latency = _latency_ms(started_at)
    return RetrievalOperationResponse(
        status="ok",
        latency_ms=latency,
        error_code=None,
        result=result,
    )
