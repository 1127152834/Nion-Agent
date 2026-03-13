"""Per-agent tool governance policy."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field

from src.config.paths import get_paths

ToolTier = Literal["core", "extended"]


class AgentToolPolicy(BaseModel):
    tool_name: str
    enabled: bool = True
    tier: ToolTier = "core"
    priority: int = 100
    category: str = "general"
    source: str = "builtin"


def _normalize_agent_name(agent_name: str | None) -> str:
    value = (agent_name or "").strip().lower()
    return value or "_default"


def _policy_file(agent_name: str | None) -> Path:
    normalized = _normalize_agent_name(agent_name)
    path = get_paths().agent_dir(normalized) / "tools.policy.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def _default_tier(tool_name: str) -> ToolTier:
    normalized = tool_name.strip().lower()
    if normalized in {"task", "bash", "python", "python_repl", "mcp_manage"}:
        return "extended"
    if normalized.startswith("mcp"):
        return "extended"
    return "core"


def _default_category(tool_name: str) -> str:
    normalized = tool_name.strip().lower()
    if "memory" in normalized or normalized.startswith("ov_"):
        return "memory"
    if "scheduler" in normalized:
        return "scheduler"
    if normalized.startswith("mcp"):
        return "mcp"
    if normalized == "task":
        return "subagent"
    return "general"


def load_agent_tool_policy(agent_name: str | None) -> dict[str, AgentToolPolicy]:
    file_path = _policy_file(agent_name)
    if not file_path.exists():
        return {}
    try:
        raw = json.loads(file_path.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return {}
    if not isinstance(raw, list):
        return {}

    output: dict[str, AgentToolPolicy] = {}
    for item in raw:
        try:
            row = AgentToolPolicy.model_validate(item)
        except Exception:  # noqa: BLE001
            continue
        output[row.tool_name] = row
    return output


def save_agent_tool_policy(agent_name: str | None, policies: list[AgentToolPolicy]) -> list[AgentToolPolicy]:
    unique: dict[str, AgentToolPolicy] = {}
    for policy in policies:
        normalized_name = policy.tool_name.strip()
        if not normalized_name:
            continue
        unique[normalized_name] = policy.model_copy(update={"tool_name": normalized_name})

    ordered = sorted(unique.values(), key=lambda item: (item.priority, item.tool_name))
    payload = [item.model_dump(mode="json") for item in ordered]
    file_path = _policy_file(agent_name)
    temp_path = file_path.with_suffix(".tmp")
    temp_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    temp_path.replace(file_path)
    return ordered


def effective_policy_for_tools(agent_name: str | None, tool_names: list[str]) -> list[AgentToolPolicy]:
    current = load_agent_tool_policy(agent_name)
    output: list[AgentToolPolicy] = []
    for name in sorted(set(tool_names)):
        existing = current.get(name)
        if existing is not None:
            output.append(existing)
            continue
        tier = _default_tier(name)
        output.append(
            AgentToolPolicy(
                tool_name=name,
                enabled=(tier == "core"),
                tier=tier,
                priority=100,
                category=_default_category(name),
                source="builtin",
            )
        )
    return output


def is_tool_enabled(agent_name: str | None, tool_name: str) -> bool:
    policy = load_agent_tool_policy(agent_name)
    hit = policy.get(tool_name)
    if hit is not None:
        return hit.enabled
    return _default_tier(tool_name) == "core"


def filter_tools_by_policy(agent_name: str | None, tools: list[object]) -> list[object]:
    policy = load_agent_tool_policy(agent_name)
    output: list[object] = []
    for tool in tools:
        name = getattr(tool, "name", None)
        if not isinstance(name, str) or not name.strip():
            continue
        entry = policy.get(name)
        if entry is not None:
            if entry.enabled:
                output.append(tool)
            continue
        if _default_tier(name) == "core":
            output.append(tool)
    return output


class AgentToolPolicyUpdateRequest(BaseModel):
    tools: list[AgentToolPolicy] = Field(default_factory=list)

