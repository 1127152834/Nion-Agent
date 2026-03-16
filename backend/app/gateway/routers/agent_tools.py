"""Per-agent tool governance APIs."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from nion.config.agents_config import load_agent_config
from nion.tools import get_available_tools
from nion.tools.policy import (
    AgentToolPolicy,
    AgentToolPolicyUpdateRequest,
    effective_policy_for_tools,
    save_agent_tool_policy,
)

router = APIRouter(prefix="/api/agents", tags=["tools"])


class AgentToolsResponse(BaseModel):
    agent: str
    tools: list[AgentToolPolicy] = Field(default_factory=list)


def _resolve_agent_groups(agent_name: str) -> list[str] | None:
    normalized = agent_name.strip().lower()
    if normalized == "_default":
        return None
    try:
        config = load_agent_config(normalized)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=f"Agent '{normalized}' not found") from exc
    return config.tool_groups


@router.get("/{agent_name}/tools", response_model=AgentToolsResponse)
async def get_agent_tools(agent_name: str) -> AgentToolsResponse:
    normalized = agent_name.strip().lower()
    groups = _resolve_agent_groups(normalized)
    tool_names = [tool.name for tool in get_available_tools(groups=groups, agent_name=None)]
    policies = effective_policy_for_tools(normalized, tool_names)
    return AgentToolsResponse(agent=normalized, tools=policies)


@router.put("/{agent_name}/tools", response_model=AgentToolsResponse)
async def update_agent_tools(agent_name: str, payload: AgentToolPolicyUpdateRequest) -> AgentToolsResponse:
    normalized = agent_name.strip().lower()
    _resolve_agent_groups(normalized)
    saved = save_agent_tool_policy(normalized, payload.tools)
    return AgentToolsResponse(agent=normalized, tools=saved)
