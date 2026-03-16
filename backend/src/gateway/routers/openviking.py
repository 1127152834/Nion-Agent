"""OpenViking memory API router (single-stack)."""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Body, HTTPException
from pydantic import BaseModel, Field

from src.agents.memory.actions import (
    compact_memory_action,
    forget_memory_action,
    query_memory_action,
    store_memory_action,
)
from src.agents.memory.registry import get_default_memory_provider
from src.agents.memory.scope import resolve_agent_for_memory_scope
from src.config.memory_config import get_memory_config

router = APIRouter(prefix="/api/openviking", tags=["openviking"])


class MemoryPolicyPayload(BaseModel):
    session_mode: Literal["normal", "temporary_chat"] | None = None
    memory_read: bool | None = None
    memory_write: bool | None = None


class OpenVikingQueryRequest(MemoryPolicyPayload):
    query: str = Field(..., min_length=1)
    limit: int = Field(default=8, ge=1, le=50)
    scope: Literal["global", "agent", "auto"] = "auto"
    agent_name: str | None = None


class OpenVikingStoreRequest(MemoryPolicyPayload):
    content: str = Field(..., min_length=1)
    confidence: float = Field(default=0.9, ge=0.0, le=1.0)
    source: str | None = None
    scope: Literal["global", "agent", "auto"] = "auto"
    agent_name: str | None = None
    thread_id: str | None = None
    metadata: dict[str, Any] | None = None


class OpenVikingForgetRequest(MemoryPolicyPayload):
    memory_id: str = Field(..., min_length=1)
    scope: Literal["global", "agent", "auto"] = "auto"
    agent_name: str | None = None


class OpenVikingCompactRequest(MemoryPolicyPayload):
    ratio: float = Field(default=0.8, gt=0.0, le=1.0)
    scope: Literal["global", "agent", "auto"] = "auto"
    agent_name: str | None = None


class OpenVikingGraphQueryRequest(BaseModel):
    mode: Literal["neighbors", "path", "memories"]
    scope: Literal["global", "agent", "auto"] = "auto"
    agent_name: str | None = None
    entity: str | None = None
    start_entity: str | None = None
    end_entity: str | None = None
    depth: int = Field(default=2, ge=1, le=6)
    limit: int = Field(default=20, ge=1, le=200)


class OpenVikingReindexRequest(BaseModel):
    include_agents: bool = True


class OpenVikingSessionCommitRequest(BaseModel):
    thread_id: str = Field(..., min_length=1)
    messages: list[dict[str, Any]] = Field(default_factory=list)
    scope: Literal["global", "agent", "auto"] = "auto"
    agent_name: str | None = None


class OpenVikingGovernanceDecideRequest(BaseModel):
    decision_id: str = Field(..., min_length=1)
    action: Literal["promote", "reject", "override"]
    override_summary: str | None = None
    decided_by: str = "user"


class OpenVikingItemsResponse(BaseModel):
    scope: str
    items: list[dict[str, Any]]


class OpenVikingConfigResponse(BaseModel):
    enabled: bool
    provider: str
    storage_layout: str
    debounce_seconds: int
    max_facts: int
    fact_confidence_threshold: float
    injection_enabled: bool
    max_injection_tokens: int
    retrieval_mode: str
    rerank_mode: str
    graph_enabled: bool
    openviking_context_enabled: bool
    openviking_context_limit: int
    openviking_session_commit_enabled: bool


class OpenVikingStatusResponse(BaseModel):
    config: OpenVikingConfigResponse
    retrieval: dict[str, Any]
    governance: dict[str, Any]


def _policy_dict(payload: MemoryPolicyPayload) -> dict[str, Any]:
    return {
        "session_mode": payload.session_mode,
        "memory_read": payload.memory_read,
        "memory_write": payload.memory_write,
    }


def _resolve_agent_by_scope(scope: str, agent_name: str | None) -> str | None:
    try:
        return resolve_agent_for_memory_scope(scope=scope, agent_name=agent_name)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


def _get_openviking_provider():
    provider = get_default_memory_provider()
    if getattr(provider, "name", "") != "openviking":
        raise HTTPException(status_code=500, detail="Default memory provider is not openviking")
    return provider


@router.post("/query", summary="Query OpenViking memory")
async def query_openviking(payload: OpenVikingQueryRequest) -> dict[str, Any]:
    try:
        return query_memory_action(
            query=payload.query,
            limit=payload.limit,
            scope=payload.scope,
            agent_name=payload.agent_name,
            policy_runtime_context=_policy_dict(payload),
        )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"OpenViking query failed: {exc}") from exc


@router.post("/store", summary="Store OpenViking memory")
async def store_openviking(payload: OpenVikingStoreRequest) -> dict[str, Any]:
    try:
        return store_memory_action(
            content=payload.content,
            confidence=payload.confidence,
            source=payload.source,
            scope=payload.scope,
            agent_name=payload.agent_name,
            thread_id=payload.thread_id,
            metadata=payload.metadata,
            policy_runtime_context=_policy_dict(payload),
        )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"OpenViking store failed: {exc}") from exc


@router.get("/items", response_model=OpenVikingItemsResponse, summary="List OpenViking memory items")
async def list_openviking_items(
    scope: Literal["global", "agent", "auto"] = "auto",
    agent_name: str | None = None,
) -> OpenVikingItemsResponse:
    provider = _get_openviking_provider()
    if not hasattr(provider, "get_memory_items"):
        raise HTTPException(status_code=501, detail="Provider does not expose get_memory_items")
    resolved_agent = _resolve_agent_by_scope(scope, agent_name)
    normalized_scope = "global" if resolved_agent is None else f"agent:{resolved_agent}"
    try:
        items = provider.get_memory_items(scope="global" if resolved_agent is None else "agent", agent_name=resolved_agent)  # type: ignore[attr-defined]
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return OpenVikingItemsResponse(scope=normalized_scope, items=items)


@router.post("/forget", summary="Hard-delete one OpenViking memory item")
async def forget_openviking(payload: OpenVikingForgetRequest) -> dict[str, Any]:
    try:
        return forget_memory_action(
            memory_id=payload.memory_id,
            scope=payload.scope,
            agent_name=payload.agent_name,
            policy_runtime_context=_policy_dict(payload),
        )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"OpenViking forget failed: {exc}") from exc


@router.post("/compact", summary="Hard-delete OpenViking memory by retention ratio")
async def compact_openviking(payload: OpenVikingCompactRequest) -> dict[str, Any]:
    try:
        return compact_memory_action(
            ratio=payload.ratio,
            scope=payload.scope,
            agent_name=payload.agent_name,
            policy_runtime_context=_policy_dict(payload),
        )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"OpenViking compact failed: {exc}") from exc


@router.get("/governance/status", summary="Get OpenViking governance status")
async def get_openviking_governance_status() -> dict[str, Any]:
    provider = _get_openviking_provider()
    if not hasattr(provider, "get_governance_status"):
        raise HTTPException(status_code=501, detail="Provider does not expose governance status")
    return provider.get_governance_status(agent_name=None)  # type: ignore[attr-defined]


@router.post("/governance/run", summary="Run OpenViking governance")
async def run_openviking_governance() -> dict[str, Any]:
    provider = _get_openviking_provider()
    if not hasattr(provider, "run_governance"):
        raise HTTPException(status_code=501, detail="Provider does not expose governance run")
    try:
        return provider.run_governance(agent_name=None)  # type: ignore[attr-defined]
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"OpenViking governance run failed: {exc}") from exc


@router.post("/governance/decide", summary="Apply governance decision")
async def decide_openviking_governance(payload: OpenVikingGovernanceDecideRequest) -> dict[str, Any]:
    provider = _get_openviking_provider()
    if not hasattr(provider, "apply_governance_decision"):
        raise HTTPException(status_code=501, detail="Provider does not expose governance decide")
    try:
        return provider.apply_governance_decision(  # type: ignore[attr-defined]
            decision_id=payload.decision_id,
            action=payload.action,
            override_summary=payload.override_summary,
            decided_by=payload.decided_by,
            agent_name=None,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"OpenViking governance decide failed: {exc}") from exc


@router.get("/retrieval/status", summary="Get OpenViking retrieval runtime status")
async def get_openviking_retrieval_status(
    scope: Literal["global", "agent", "auto"] = "auto",
    agent_name: str | None = None,
) -> dict[str, Any]:
    provider = _get_openviking_provider()
    if not hasattr(provider, "get_retrieval_status"):
        raise HTTPException(status_code=501, detail="Provider does not expose retrieval status")
    resolved_agent = _resolve_agent_by_scope(scope, agent_name)
    return provider.get_retrieval_status(agent_name=resolved_agent)  # type: ignore[attr-defined]


@router.post("/reindex-vectors", summary="Rebuild OpenViking vector index")
async def reindex_openviking_vectors(payload: OpenVikingReindexRequest | None = Body(default=None)) -> dict[str, Any]:
    request = payload or OpenVikingReindexRequest()
    provider = _get_openviking_provider()
    if not hasattr(provider, "reindex_vectors"):
        raise HTTPException(status_code=501, detail="Provider does not support vector reindex")
    try:
        return provider.reindex_vectors(include_agents=request.include_agents)  # type: ignore[attr-defined]
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"OpenViking vector reindex failed: {exc}") from exc


@router.post("/graph/query", summary="Query OpenViking memory graph")
async def query_openviking_graph(payload: OpenVikingGraphQueryRequest) -> dict[str, Any]:
    provider = _get_openviking_provider()
    if not hasattr(provider, "query_memory_graph"):
        raise HTTPException(status_code=501, detail="Provider does not support graph query")
    resolved_agent = _resolve_agent_by_scope(payload.scope, payload.agent_name)
    try:
        return provider.query_memory_graph(  # type: ignore[attr-defined]
            mode=payload.mode,
            agent_name=resolved_agent,
            entity=payload.entity,
            start_entity=payload.start_entity,
            end_entity=payload.end_entity,
            depth=payload.depth,
            limit=payload.limit,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"OpenViking graph query failed: {exc}") from exc


@router.post("/session/commit", summary="Commit one session batch to OpenViking")
async def commit_openviking_session(payload: OpenVikingSessionCommitRequest) -> dict[str, Any]:
    _ = payload
    raise HTTPException(
        status_code=410,
        detail=(
            "session_commit has been removed. "
            "Use POST /api/memory/write (Extract -> Decide -> Action hard-cut pipeline)."
        ),
    )


@router.get("/config", response_model=OpenVikingConfigResponse, summary="Get OpenViking memory config")
async def get_openviking_config_endpoint() -> OpenVikingConfigResponse:
    config = get_memory_config()
    return OpenVikingConfigResponse(
        enabled=config.enabled,
        provider="openviking",
        storage_layout="openviking",
        debounce_seconds=config.debounce_seconds,
        max_facts=config.max_facts,
        fact_confidence_threshold=config.fact_confidence_threshold,
        injection_enabled=config.injection_enabled,
        max_injection_tokens=config.max_injection_tokens,
        retrieval_mode=config.retrieval_mode,
        rerank_mode=config.rerank_mode,
        graph_enabled=config.graph_enabled,
        openviking_context_enabled=config.openviking_context_enabled,
        openviking_context_limit=config.openviking_context_limit,
        openviking_session_commit_enabled=config.openviking_session_commit_enabled,
    )


@router.get("/status", response_model=OpenVikingStatusResponse, summary="Get OpenViking runtime status")
async def get_openviking_status() -> OpenVikingStatusResponse:
    retrieval = await get_openviking_retrieval_status(scope="global", agent_name=None)
    governance = await get_openviking_governance_status()
    config = await get_openviking_config_endpoint()
    return OpenVikingStatusResponse(config=config, retrieval=retrieval, governance=governance)
