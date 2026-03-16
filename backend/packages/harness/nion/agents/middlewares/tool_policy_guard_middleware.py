"""Tool governance guard (runs before ToolNode execution)."""

from __future__ import annotations

import logging
from typing import override

try:
    from langchain.agents import AgentState
except Exception:  # noqa: BLE001

    class AgentState(dict):  # type: ignore[no-redef]
        pass


try:
    from langchain.agents.middleware import AgentMiddleware
except Exception:  # noqa: BLE001

    class AgentMiddleware:  # type: ignore[no-redef]
        @classmethod
        def __class_getitem__(cls, item):
            return cls

        def __init__(self, *args, **kwargs):
            _ = args, kwargs


from langgraph.runtime import Runtime

from nion.tools.policy import is_tool_enabled

logger = logging.getLogger(__name__)


class ToolPolicyGuardMiddleware(AgentMiddleware[AgentState]):
    """Drop disallowed tool calls from model output before ToolNode."""

    def __init__(self, agent_name: str | None = None):
        super().__init__()
        self._agent_name = agent_name

    def _guard_tool_calls(self, state: AgentState, runtime: Runtime) -> dict | None:
        messages = state.get("messages", [])
        if not messages:
            return None

        last_msg = messages[-1]
        if getattr(last_msg, "type", None) != "ai":
            return None

        tool_calls = getattr(last_msg, "tool_calls", None)
        if not tool_calls:
            return None

        agent_name = self._agent_name
        if not agent_name:
            runtime_agent = runtime.context.get("agent_name") if isinstance(runtime.context, dict) else None
            if isinstance(runtime_agent, str) and runtime_agent.strip():
                agent_name = runtime_agent.strip()

        kept = []
        dropped_names: list[str] = []
        for call in tool_calls:
            name = str(call.get("name") or "").strip()
            if not name:
                continue
            if is_tool_enabled(agent_name, name):
                kept.append(call)
            else:
                dropped_names.append(name)

        if not dropped_names:
            return None

        logger.warning(
            "ToolPolicyGuard dropped %d tool call(s) for agent=%s: %s",
            len(dropped_names),
            agent_name or "_default",
            ", ".join(dropped_names),
        )
        updated = last_msg.model_copy(update={"tool_calls": kept})
        return {"messages": [updated]}

    @override
    def after_model(self, state: AgentState, runtime: Runtime) -> dict | None:
        return self._guard_tool_calls(state, runtime)

    @override
    async def aafter_model(self, state: AgentState, runtime: Runtime) -> dict | None:
        return self._guard_tool_calls(state, runtime)
