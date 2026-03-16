"""Unified memory APIs (hard-cut LangGraph write path)."""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from nion.agents.memory.registry import get_default_memory_provider
from nion.agents.memory.scope import resolve_agent_for_memory_scope

router = APIRouter(prefix="/api/memory", tags=["memory"])


class MemoryWriteRequest(BaseModel):
    thread_id: str = Field(..., min_length=1)
    messages: list[dict[str, Any]] = Field(default_factory=list)
    scope: Literal["global", "agent", "auto"] = "auto"
    agent_name: str | None = None
    trace_id: str | None = None
    chat_id: str | None = None


class MemoryWriteResponse(BaseModel):
    trace_id: str
    chat_id: str
    actions: list[dict[str, Any]]
    applied_results: list[dict[str, Any]]
    manifest_revision: int
    route_taken: str
    fallback_reason: str


class MemoryQueryExplainResponse(BaseModel):
    query: str
    route_taken: str
    dense_hits: list[dict[str, Any]]
    sparse_hits: list[dict[str, Any]]
    fusion_hits: list[dict[str, Any]]
    fallback_reason: str
    recent_actions: list[dict[str, Any]]


class MemoryRebuildRequest(BaseModel):
    scope: Literal["global", "agent", "auto"] = "auto"
    agent_name: str | None = None


def _get_provider():
    provider = get_default_memory_provider()
    if getattr(provider, "name", "") != "openviking":
        raise HTTPException(status_code=500, detail="Default memory provider is not openviking")
    return provider


def _resolve_agent_by_scope(scope: str, agent_name: str | None) -> str | None:
    try:
        return resolve_agent_for_memory_scope(scope=scope, agent_name=agent_name)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/write", response_model=MemoryWriteResponse, summary="Write memory via structured action graph")
async def write_memory(payload: MemoryWriteRequest) -> MemoryWriteResponse:
    provider = _get_provider()
    if not hasattr(provider, "write_conversation_update"):
        raise HTTPException(status_code=501, detail="Provider does not support memory write graph")

    resolved_agent = _resolve_agent_by_scope(payload.scope, payload.agent_name)
    try:
        result = provider.write_conversation_update(  # type: ignore[attr-defined]
            thread_id=payload.thread_id,
            messages=payload.messages,
            agent_name=resolved_agent,
            trace_id=payload.trace_id,
            chat_id=payload.chat_id,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Memory write failed: {exc}") from exc
    return MemoryWriteResponse(**result)


@router.get("/query/explain", response_model=MemoryQueryExplainResponse, summary="Query memory with route explain")
async def explain_memory_query(
    query: str,
    limit: int = Query(default=8, ge=1, le=50),
    scope: Literal["global", "agent", "auto"] = "auto",
    agent_name: str | None = None,
) -> MemoryQueryExplainResponse:
    provider = _get_provider()
    if not hasattr(provider, "explain_query"):
        raise HTTPException(status_code=501, detail="Provider does not support query explain")

    resolved_agent = _resolve_agent_by_scope(scope, agent_name)
    try:
        payload = provider.explain_query(query=query, limit=limit, agent_name=resolved_agent)  # type: ignore[attr-defined]
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Memory query explain failed: {exc}") from exc
    payload["query"] = query
    return MemoryQueryExplainResponse(**payload)


@router.post("/rebuild", summary="Rebuild dense/sparse/graph indexes from manifest")
async def rebuild_memory(payload: MemoryRebuildRequest) -> dict[str, Any]:
    provider = _get_provider()
    if not hasattr(provider, "rebuild_from_manifest"):
        raise HTTPException(status_code=501, detail="Provider does not support manifest rebuild")
    resolved_agent = _resolve_agent_by_scope(payload.scope, payload.agent_name)
    try:
        result = provider.rebuild_from_manifest(agent_name=resolved_agent)  # type: ignore[attr-defined]
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Memory rebuild failed: {exc}") from exc
    return result
