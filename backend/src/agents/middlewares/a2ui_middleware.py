"""Middleware for intercepting A2UI tool calls and handling user actions.

Design goals:
- Align with the proven AG-UI `a2ui-middleware` semantics without adopting AG-UI
  as the transport layer.
- Treat A2UI as an interruptible, product-friendly UI surface in chat:
  `send_a2ui_json_to_client(...)` interrupts execution and the frontend renders
  an A2UI card.
- When the user interacts with the UI, the frontend resumes the run with a
  runtime context payload. This middleware converts that payload into a
  synthetic `log_a2ui_event` tool call + tool result pair, so the model can
  reliably consume the interaction as if it were a real tool event.
"""

from __future__ import annotations

import json
import uuid
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any, cast, override

from langchain_core.messages import AIMessage, ToolMessage
from langgraph.graph import END
from langgraph.prebuilt.tool_node import ToolCallRequest
from langgraph.runtime import Runtime
from langgraph.types import Command

from src.agents.middlewares.langchain_compat import AgentMiddleware, AgentState

_A2UI_SEND_TOOL_NAME = "send_a2ui_json_to_client"
_A2UI_EVENT_TOOL_NAME = "log_a2ui_event"
_A2UI_CONTEXT_KEY = "a2ui_action"

_A2UI_ALLOWED_OP_KEYS = (
    "beginRendering",
    "surfaceUpdate",
    "dataModelUpdate",
    "deleteSurface",
)


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


def _normalize_surface_id(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


def _get_operation_surface_id(operation: dict[str, Any]) -> str | None:
    for key in _A2UI_ALLOWED_OP_KEYS:
        payload = operation.get(key)
        if not isinstance(payload, dict):
            continue
        surface_id = payload.get("surfaceId") or payload.get("surface_id")
        normalized = _normalize_surface_id(surface_id)
        if normalized:
            return normalized
    return None


def _has_begin_rendering(operations: list[dict[str, Any]]) -> bool:
    for op in operations:
        if isinstance(op.get("beginRendering"), dict):
            return True
    return False


def _has_surface_update(operations: list[dict[str, Any]]) -> bool:
    for op in operations:
        if isinstance(op.get("surfaceUpdate"), dict):
            return True
    return False


def _parse_a2ui_operations(raw: object) -> list[dict[str, Any]] | None:
    """Parse tool argument payload into a list of A2UI operations.

    We accept either:
    - A JSON string of the operations array (preferred for stable tool schemas)
    - A structured list/dict (in case the model uses structured output)
    """
    value = raw
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        try:
            value = json.loads(text)
        except Exception:  # noqa: BLE001
            return None

    if isinstance(value, dict):
        return [value]

    if not isinstance(value, list):
        return None

    operations: list[dict[str, Any]] = []
    for item in value:
        if isinstance(item, dict):
            operations.append(item)
    return operations or None


def _format_user_action_result(action: dict[str, Any]) -> str:
    name = action.get("name")
    surface_id = action.get("surfaceId") or action.get("surface_id")
    source_component_id = action.get("sourceComponentId") or action.get("source_component_id")
    context = action.get("context")

    action_name = str(name).strip() if isinstance(name, str) and name.strip() else "unknown_action"
    surface = str(surface_id).strip() if isinstance(surface_id, str) and surface_id.strip() else "unknown_surface"

    message = f'User performed action "{action_name}" on surface "{surface}"'
    if isinstance(source_component_id, str) and source_component_id.strip():
        message += f" (component: {source_component_id.strip()})"
    if isinstance(context, dict):
        try:
            message += f". Context: {json.dumps(context, ensure_ascii=False)}"
        except Exception:  # noqa: BLE001
            message += ". Context: {}"
    else:
        message += ". Context: {}"
    return message


class A2UIMiddleware(AgentMiddleware[AgentState]):
    """Intercept `send_a2ui_json_to_client` tool calls and handle A2UI user actions."""

    @override
    def before_agent(self, state: AgentState, runtime: Runtime) -> dict | None:
        """If runtime context contains an A2UI user action, synthesize tool messages.

        The frontend resumes the run with:
            context.a2ui_action.user_action = { ... }

        We turn that into:
        - AIMessage(tool_calls=[log_a2ui_event(...)])  (internal)
        - ToolMessage(name=log_a2ui_event, content=...) (internal)
        """
        ctx = runtime.context if isinstance(runtime.context, dict) else {}
        raw = ctx.get(_A2UI_CONTEXT_KEY)
        if not isinstance(raw, dict):
            return None

        user_action = raw.get("user_action") or raw.get("userAction")
        if not isinstance(user_action, dict):
            return None

        tool_call_id = str(uuid.uuid4())

        assistant_msg = AIMessage(
            content="",
            tool_calls=[
                {
                    "id": tool_call_id,
                    "name": _A2UI_EVENT_TOOL_NAME,
                    "args": user_action,
                }
            ],
            additional_kwargs={
                "internal": True,
                "a2ui_event": user_action,
            },
        )

        tool_msg = ToolMessage(
            content=_format_user_action_result(user_action),
            tool_call_id=tool_call_id,
            name=_A2UI_EVENT_TOOL_NAME,
            additional_kwargs={
                "internal": True,
                "a2ui_event": user_action,
            },
        )

        return {"messages": [assistant_msg, tool_msg]}

    def _handle_send_a2ui(
        self,
        request: ToolCallRequest,
        handler: Callable[[ToolCallRequest], ToolMessage | Command],
    ) -> ToolMessage | Command:
        args = request.tool_call.get("args", {})
        if not isinstance(args, dict):
            args = {}

        operations = _parse_a2ui_operations(args.get("a2ui_json"))
        if not operations:
            # Invalid payload: let the tool execute normally so the agent can fall back to text.
            return handler(request)

        # Minimal renderability validation (v0.8):
        # - An initial render must include surfaceUpdate + beginRendering in the same call.
        if not _has_surface_update(operations) or not _has_begin_rendering(operations):
            return handler(request)

        # Compute a best-effort primary surfaceId (for debugging / client-side grouping).
        surface_id = None
        for op in operations:
            surface_id = _get_operation_surface_id(op)
            if surface_id:
                break

        tool_call_id = cast(str | None, request.tool_call.get("id"))
        payload = {
            "status": "awaiting_user",
            "surface_id": surface_id,
            "catalog_id": None,
            "operations": operations,
            "tool_call_id": tool_call_id,
            "asked_at": _now_iso(),
            "resolved_at": None,
            "resolved_by_message_id": None,
        }

        tool_message = ToolMessage(
            content="A2UI surface ready.",
            tool_call_id=tool_call_id or "",
            name=_A2UI_SEND_TOOL_NAME,
            additional_kwargs={"a2ui": payload},
        )

        return Command(update={"messages": [tool_message]}, goto=END)

    async def _ahandle_send_a2ui(
        self,
        request: ToolCallRequest,
        handler: Callable[[ToolCallRequest], ToolMessage | Command],
    ) -> ToolMessage | Command:
        args = request.tool_call.get("args", {})
        if not isinstance(args, dict):
            args = {}

        operations = _parse_a2ui_operations(args.get("a2ui_json"))
        if not operations:
            return await handler(request)

        if not _has_surface_update(operations) or not _has_begin_rendering(operations):
            return await handler(request)

        surface_id = None
        for op in operations:
            surface_id = _get_operation_surface_id(op)
            if surface_id:
                break

        tool_call_id = cast(str | None, request.tool_call.get("id"))
        payload = {
            "status": "awaiting_user",
            "surface_id": surface_id,
            "catalog_id": None,
            "operations": operations,
            "tool_call_id": tool_call_id,
            "asked_at": _now_iso(),
            "resolved_at": None,
            "resolved_by_message_id": None,
        }

        tool_message = ToolMessage(
            content="A2UI surface ready.",
            tool_call_id=tool_call_id or "",
            name=_A2UI_SEND_TOOL_NAME,
            additional_kwargs={"a2ui": payload},
        )

        return Command(update={"messages": [tool_message]}, goto=END)

    @override
    def wrap_tool_call(
        self,
        request: ToolCallRequest,
        handler: Callable[[ToolCallRequest], ToolMessage | Command],
    ) -> ToolMessage | Command:
        if request.tool_call.get("name") != _A2UI_SEND_TOOL_NAME:
            return handler(request)

        return self._handle_send_a2ui(request, handler)

    @override
    async def awrap_tool_call(
        self,
        request: ToolCallRequest,
        handler: Callable[[ToolCallRequest], ToolMessage | Command],
    ) -> ToolMessage | Command:
        if request.tool_call.get("name") != _A2UI_SEND_TOOL_NAME:
            return await handler(request)

        return await self._ahandle_send_a2ui(request, handler)
