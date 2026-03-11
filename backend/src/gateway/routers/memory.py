"""Memory API router for structured-fs memory views and governance."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from src.agents.memory.governor import get_memory_governor
from src.agents.memory.core import MemoryReadRequest
from src.agents.memory.registry import get_default_memory_provider
from src.config.memory_config import get_memory_config

router = APIRouter(prefix="/api", tags=["memory"])


class ContextSection(BaseModel):
    summary: str = Field(default="", description="Summary content")
    updatedAt: str = Field(default="", description="Last update timestamp")


class UserContext(BaseModel):
    workContext: ContextSection = Field(default_factory=ContextSection)
    personalContext: ContextSection = Field(default_factory=ContextSection)
    topOfMind: ContextSection = Field(default_factory=ContextSection)


class HistoryContext(BaseModel):
    recentMonths: ContextSection = Field(default_factory=ContextSection)
    earlierContext: ContextSection = Field(default_factory=ContextSection)
    longTermBackground: ContextSection = Field(default_factory=ContextSection)


class RelationEdgeResponse(BaseModel):
    type: str = Field(default="related_to")
    target_id: str = Field(default="")
    weight: float = Field(default=1.0)
    evidence: str = Field(default="")


class Fact(BaseModel):
    id: str = Field(..., description="Unique identifier for the fact")
    content: str = Field(..., description="Fact content")
    category: str = Field(default="context", description="Fact category")
    confidence: float = Field(default=0.5, description="Confidence score (0-1)")
    createdAt: str = Field(default="", description="Creation timestamp")
    source: str = Field(default="unknown", description="Source thread ID")
    status: str = Field(default="active", description="Governance status")
    entity_refs: list[str] = Field(default_factory=list)
    relations: list[RelationEdgeResponse] = Field(default_factory=list)
    source_refs: list[str] = Field(default_factory=list)


class MemoryResponse(BaseModel):
    version: str = Field(default="3.0", description="Memory schema version")
    scope: str = Field(default="global", description="Memory scope")
    storage_layout: str = Field(default="structured-fs")
    lastUpdated: str = Field(default="", description="Last update timestamp")
    user: UserContext = Field(default_factory=UserContext)
    history: HistoryContext = Field(default_factory=HistoryContext)
    facts: list[Fact] = Field(default_factory=list)
    agent_catalog: list[dict] = Field(default_factory=list)


class MemoryConfigResponse(BaseModel):
    enabled: bool
    storage_layout: str
    provider: str
    legacy_json_removed: bool
    graph_preembedded: bool
    debounce_seconds: int
    max_facts: int
    fact_confidence_threshold: float
    injection_enabled: bool
    max_injection_tokens: int


class MemoryStatusResponse(BaseModel):
    config: MemoryConfigResponse
    data: MemoryResponse


class MemoryItemsResponse(BaseModel):
    scope: str
    items: list[dict]


class MemoryCatalogResponse(BaseModel):
    items: list[dict]


class GovernanceStatusResponse(BaseModel):
    pending_count: int = 0
    contested_count: int = 0
    last_run_at: str = ""
    queue: list[dict] = Field(default_factory=list)


class GovernanceRunResponse(BaseModel):
    promoted: int = 0
    rejected: int = 0
    pending_count: int = 0
    contested_count: int = 0
    catalog_size: int = 0


class GovernanceDecisionRequest(BaseModel):
    decision_id: str
    action: Literal["promote", "reject", "override"] = "reject"
    override_summary: str | None = None
    decided_by: str = "user"


SYSTEM_MANAGED_GOVERNANCE_DETAIL = "Memory governance is system-managed; manual operations are disabled."


def _get_runtime():
    provider = get_default_memory_provider()
    runtime = getattr(provider, "_runtime", None)
    if runtime is None:
        raise HTTPException(status_code=500, detail="Structured memory runtime unavailable")
    return runtime


def _resolve_scope(scope: str, agent_name: str | None) -> tuple[str, str | None]:
    normalized_scope = (scope or "global").strip().lower()
    if normalized_scope == "global":
        return "global", None
    if normalized_scope == "agent":
        if not agent_name:
            raise HTTPException(status_code=422, detail="agent_name is required when scope=agent")
        return "agent", agent_name
    raise HTTPException(status_code=422, detail=f"Unsupported scope: {scope}")


@router.get(
    "/memory",
    response_model=MemoryResponse,
    summary="Get Memory Data",
    description="Compatibility endpoint that returns the global memory view.",
)
async def get_memory() -> MemoryResponse:
    memory_data = get_default_memory_provider().get_memory_data(MemoryReadRequest(agent_name=None))
    return MemoryResponse(**memory_data)


@router.get(
    "/memory/view",
    response_model=MemoryResponse,
    summary="Get Memory View By Scope",
    description="Read memory by scope: global or per-agent.",
)
async def get_memory_view(
    scope: Literal["global", "agent"] = "global",
    agent_name: str | None = None,
) -> MemoryResponse:
    _, resolved_agent = _resolve_scope(scope, agent_name)
    memory_data = get_default_memory_provider().get_memory_data(MemoryReadRequest(agent_name=resolved_agent))
    return MemoryResponse(**memory_data)


@router.post(
    "/memory/reload",
    response_model=MemoryResponse,
    summary="Reload Memory Data",
    description="Reload memory data by scope from structured storage.",
)
async def reload_memory(
    scope: Literal["global", "agent"] = "global",
    agent_name: str | None = None,
) -> MemoryResponse:
    _, resolved_agent = _resolve_scope(scope, agent_name)
    memory_data = get_default_memory_provider().reload_memory_data(MemoryReadRequest(agent_name=resolved_agent))
    return MemoryResponse(**memory_data)


@router.get(
    "/memory/items",
    response_model=MemoryItemsResponse,
    summary="List Memory Entries",
    description="Return entry-level records with relation metadata and governance status.",
)
async def list_memory_items(
    scope: Literal["global", "agent"] = "global",
    agent_name: str | None = None,
) -> MemoryItemsResponse:
    runtime = _get_runtime()
    try:
        items = runtime.get_memory_items(scope=scope, agent_name=agent_name)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    resolved_scope = "global" if scope == "global" else f"agent:{agent_name}"
    return MemoryItemsResponse(scope=resolved_scope, items=items)


@router.get(
    "/memory/catalog",
    response_model=MemoryCatalogResponse,
    summary="Get Agent Catalog",
    description="Return the global shared agent directory with persona/style summaries.",
)
async def get_memory_catalog() -> MemoryCatalogResponse:
    governor = get_memory_governor()
    items = governor.refresh_agent_catalog()
    return MemoryCatalogResponse(items=items)


@router.get(
    "/memory/governance/status",
    response_model=GovernanceStatusResponse,
    summary="Get Governance Status",
    description="Return governance queue status and contested counts.",
)
async def get_governance_status() -> GovernanceStatusResponse:
    governor = get_memory_governor()
    return GovernanceStatusResponse(**governor.status())


@router.post(
    "/memory/governance/run",
    response_model=GovernanceRunResponse,
    summary="Run Memory Governance",
    description="Run governance queue evaluation and apply promotion/reject decisions.",
    include_in_schema=False,
)
async def run_governance() -> GovernanceRunResponse:
    raise HTTPException(status_code=403, detail=SYSTEM_MANAGED_GOVERNANCE_DETAIL)


@router.post(
    "/memory/governance/decide",
    summary="Apply Governance Decision",
    description="Apply manual user override decision for a queued governance item.",
    include_in_schema=False,
)
async def decide_governance(_request: GovernanceDecisionRequest) -> dict:
    raise HTTPException(status_code=403, detail=SYSTEM_MANAGED_GOVERNANCE_DETAIL)


@router.get(
    "/memory/config",
    response_model=MemoryConfigResponse,
    summary="Get Memory Configuration",
    description="Retrieve structured-fs memory runtime configuration.",
)
async def get_memory_config_endpoint() -> MemoryConfigResponse:
    config = get_memory_config()
    return MemoryConfigResponse(
        enabled=config.enabled,
        storage_layout="structured-fs",
        provider=config.provider,
        legacy_json_removed=True,
        graph_preembedded=True,
        debounce_seconds=config.debounce_seconds,
        max_facts=config.max_facts,
        fact_confidence_threshold=config.fact_confidence_threshold,
        injection_enabled=config.injection_enabled,
        max_injection_tokens=config.max_injection_tokens,
    )


@router.get(
    "/memory/status",
    response_model=MemoryStatusResponse,
    summary="Get Memory Status",
    description="Retrieve memory runtime configuration and the global memory snapshot.",
)
async def get_memory_status() -> MemoryStatusResponse:
    config = await get_memory_config_endpoint()
    data = await get_memory()
    return MemoryStatusResponse(config=config, data=data)


@router.get(
    "/memory/usage",
    summary="Get Memory Usage Statistics",
    description="Get usage statistics for structured memory storage.",
)
async def get_memory_usage(scope: Literal["global", "agent"] = "global", agent_name: str | None = None) -> dict:
    provider = get_default_memory_provider()
    if hasattr(provider, "_runtime") and hasattr(provider._runtime, "_read_manifest"):
        from src.agents.memory.maintenance import get_usage_stats

        return get_usage_stats(provider._runtime, scope=scope, agent_name=agent_name)
    return {"error": "Usage stats not available for current provider"}


@router.post(
    "/memory/compact",
    summary="Compact Memory Storage",
    description="Remove archived entries to reduce storage size.",
)
async def compact_memory(scope: Literal["global", "agent"] = "global", agent_name: str | None = None) -> dict:
    provider = get_default_memory_provider()
    if hasattr(provider, "_runtime") and hasattr(provider._runtime, "_write_manifest"):
        from src.agents.memory.maintenance import compact_memory

        return compact_memory(provider._runtime, scope=scope, agent_name=agent_name)
    return {"error": "Compact not available for current provider"}


@router.post(
    "/memory/rebuild",
    summary="Rebuild Memory Manifest",
    description="Rebuild memory manifest from day files.",
)
async def rebuild_memory(scope: Literal["global", "agent"] = "global", agent_name: str | None = None) -> dict:
    provider = get_default_memory_provider()
    if hasattr(provider, "_runtime") and hasattr(provider._runtime, "_write_manifest"):
        from src.agents.memory.maintenance import rebuild_memory

        return rebuild_memory(provider._runtime, scope=scope, agent_name=agent_name)
    return {"error": "Rebuild not available for current provider"}
