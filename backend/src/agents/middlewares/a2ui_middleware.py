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

# Some models may emit camelCase tool args even when the tool schema uses snake_case.
# Keep this list small and intentional to avoid accidentally parsing unrelated args.
_A2UI_ARGS_CANDIDATE_KEYS = (
    "a2ui_json",
    "a2uiJson",
    "a2ui",
    "operations",
    "messages",
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


def _extract_raw_a2ui_json_from_args(raw_args: object) -> object:
    """Extract the most likely A2UI payload from a tool-call args object.

    Why this exists:
    - The canonical argument name is `a2ui_json`.
    - Some LLMs still emit `a2uiJson` or wrap the payload under generic keys.
    - In rare cases, the model may pass the operations array directly as `args`
      (non-dict). We treat that as the payload itself.

    This function is intentionally conservative: it only checks a small, known set
    of candidate keys, and otherwise returns the original args unchanged.
    """
    if not isinstance(raw_args, dict):
        return raw_args

    for key in _A2UI_ARGS_CANDIDATE_KEYS:
        if key in raw_args and raw_args[key] is not None:
            return raw_args[key]

    # As a last resort, if the model mistakenly wrapped the payload under `payload`,
    # attempt a single level unwrap.
    payload = raw_args.get("payload")
    if isinstance(payload, dict):
        for key in _A2UI_ARGS_CANDIDATE_KEYS:
            if key in payload and payload[key] is not None:
                return payload[key]

    return raw_args.get("a2ui_json")


def _parse_json_if_string(value: object) -> object:
    if not isinstance(value, str):
        return value
    text = value.strip()
    if not text:
        return value
    try:
        return json.loads(text)
    except Exception:  # noqa: BLE001
        return value


def _object_to_data_entries(value: dict[str, Any]) -> list[dict[str, Any]]:
    """Best-effort conversion from a plain object to A2UI DataEntry[].

    A2UI v0.8 DataEntry supports:
    - { key, valueString }
    - { key, valueNumber }
    - { key, valueBoolean }
    - { key, valueMap: DataEntry[] }

    Arrays and nulls are ignored (no stable encoding in DataEntry).
    """
    entries: list[dict[str, Any]] = []
    for k, v in value.items():
        key = _normalize_surface_id(k)
        if not key:
            continue

        if isinstance(v, str):
            entries.append({"key": key, "valueString": v})
            continue
        if isinstance(v, bool):
            entries.append({"key": key, "valueBoolean": v})
            continue
        if isinstance(v, int | float) and not isinstance(v, bool):
            entries.append({"key": key, "valueNumber": v})
            continue
        if isinstance(v, dict):
            entries.append({"key": key, "valueMap": _object_to_data_entries(v)})
            continue

    return entries


def _coerce_data_model_contents(raw: object) -> list[dict[str, Any]] | None:
    value = _parse_json_if_string(raw)

    if isinstance(value, dict):
        entries = _object_to_data_entries(value)
        return entries or None

    if not isinstance(value, list):
        return None

    contents: list[dict[str, Any]] = []
    for item in value:
        if isinstance(item, dict):
            # Minimal shape check: key must be present and non-empty.
            key = item.get("key")
            if isinstance(key, str) and key.strip():
                contents.append(item)
    return contents or None


def _coerce_components(raw: object) -> list[dict[str, Any]] | None:
    value = _parse_json_if_string(raw)

    if isinstance(value, dict):
        # Common model mistake: emit a dict keyed by component id.
        components: list[dict[str, Any]] = []
        for cid, comp in value.items():
            if not isinstance(comp, dict):
                continue
            component_id = comp.get("id")
            if not isinstance(component_id, str) or not component_id.strip():
                component_id = cid if isinstance(cid, str) else None
            if not isinstance(component_id, str) or not component_id.strip():
                continue
            merged = {"id": component_id, **comp}
            components.append(merged)
        return components or None

    if not isinstance(value, list):
        return None

    components: list[dict[str, Any]] = []
    for item in value:
        if isinstance(item, dict):
            component_id = item.get("id")
            if isinstance(component_id, str) and component_id.strip():
                components.append(item)
    return components or None


def _normalize_a2ui_operation(operation: dict[str, Any]) -> dict[str, Any] | None:
    """Normalize a single A2UI operation to the @a2ui-sdk/react v0.8 shape.

    Why:
    - The renderer expects strict field names (`surfaceId`, `components`, `contents`).
    - Malformed payloads can crash the frontend (e.g., dataModelUpdate.contents not being an array).
    """

    begin = operation.get("beginRendering")
    if isinstance(begin, dict):
        surface_id = begin.get("surfaceId") or begin.get("surface_id")
        root = begin.get("root")
        normalized_surface_id = _normalize_surface_id(surface_id)
        normalized_root = _normalize_surface_id(root) if isinstance(root, str) else None
        if not normalized_surface_id or not normalized_root:
            return None
        payload: dict[str, Any] = {
            "surfaceId": normalized_surface_id,
            "root": normalized_root,
        }
        catalog_id = begin.get("catalogId") or begin.get("catalog_id")
        if isinstance(catalog_id, str) and catalog_id.strip():
            payload["catalogId"] = catalog_id.strip()
        styles = begin.get("styles")
        if isinstance(styles, dict):
            payload["styles"] = styles
        return {"beginRendering": payload}

    surface = operation.get("surfaceUpdate")
    if isinstance(surface, dict):
        surface_id = surface.get("surfaceId") or surface.get("surface_id")
        normalized_surface_id = _normalize_surface_id(surface_id)
        if not normalized_surface_id:
            return None

        raw_components = surface.get("components")
        if raw_components is None:
            raw_components = surface.get("contents")
        components = _coerce_components(raw_components)
        if not components:
            return None

        return {
            "surfaceUpdate": {
                "surfaceId": normalized_surface_id,
                "components": components,
            }
        }

    data = operation.get("dataModelUpdate")
    if isinstance(data, dict):
        surface_id = data.get("surfaceId") or data.get("surface_id")
        normalized_surface_id = _normalize_surface_id(surface_id)
        if not normalized_surface_id:
            return None

        raw_contents = data.get("contents")
        if raw_contents is None:
            raw_contents = data.get("content")
        contents = _coerce_data_model_contents(raw_contents)
        if not contents:
            # dataModelUpdate is optional; drop malformed ones to avoid crashing the client.
            return None

        payload: dict[str, Any] = {
            "surfaceId": normalized_surface_id,
            "contents": contents,
        }
        path = data.get("path")
        if isinstance(path, str) and path.strip():
            payload["path"] = path.strip()
        return {"dataModelUpdate": payload}

    delete = operation.get("deleteSurface")
    if isinstance(delete, dict):
        surface_id = delete.get("surfaceId") or delete.get("surface_id")
        normalized_surface_id = _normalize_surface_id(surface_id)
        if not normalized_surface_id:
            return None
        return {"deleteSurface": {"surfaceId": normalized_surface_id}}

    return None


def _normalize_a2ui_operations(operations: list[dict[str, Any]]) -> list[dict[str, Any]] | None:
    normalized: list[dict[str, Any]] = []
    has_begin = False
    has_surface = False

    for op in operations:
        normalized_op = _normalize_a2ui_operation(op)
        if not normalized_op:
            continue
        if "beginRendering" in normalized_op:
            has_begin = True
        if "surfaceUpdate" in normalized_op:
            has_surface = True
        normalized.append(normalized_op)

    if not normalized or not has_begin or not has_surface:
        return None
    return normalized


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


def _safe_json_value(value: object) -> object:
    """Best-effort normalize a value into a JSON-serializable shape.

    Notes:
    - Tool call args come from upstream HTTP JSON, so they *should* already be JSON.
    - Still, defensive conversion avoids hard failures when we embed raw payloads
      into `additional_kwargs` for UI debugging.
    """
    try:
        json.dumps(value, ensure_ascii=False)
        return value
    except TypeError:
        return str(value)


def _build_error_tool_message(
    *,
    tool_call_id: str | None,
    raw_a2ui_json: object,
    error: str,
) -> ToolMessage:
    """Return an A2UI-shaped ToolMessage that the frontend can render safely.

    Why:
    - We must never crash the run due to tool arg validation or malformed A2UI.
    - We still want the user (and the model) to see a product-friendly failure
      surface, and keep enough raw payload for debugging/regeneration.
    """
    debug_payload = _safe_json_value(raw_a2ui_json)
    operations: list[dict[str, Any]] = [{"_a2ui_error": error, "_raw_a2ui_json": debug_payload}]

    payload = {
        "status": "error",
        "surface_id": None,
        "catalog_id": None,
        "operations": operations,
        "tool_call_id": tool_call_id,
        "asked_at": _now_iso(),
        "resolved_at": _now_iso(),
        "resolved_by_message_id": None,
        "error": error,
    }

    return ToolMessage(
        content=error,
        tool_call_id=tool_call_id or "",
        name=_A2UI_SEND_TOOL_NAME,
        additional_kwargs={"a2ui": payload},
    )


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
        raw_args = request.tool_call.get("args", {})

        tool_call_id = cast(str | None, request.tool_call.get("id"))
        raw_a2ui_json = _extract_raw_a2ui_json_from_args(raw_args)

        operations = _parse_a2ui_operations(raw_a2ui_json)
        if not operations:
            # Never execute the real tool for malformed calls: missing args/type
            # mismatches can raise validation errors and break the whole run.
            return _build_error_tool_message(
                tool_call_id=tool_call_id,
                raw_a2ui_json=raw_a2ui_json,
                error=(
                    "A2UI payload 无法解析：请在 send_a2ui_json_to_client(a2ui_json=...) 中传入一个 JSON 数组，"
                    "并确保包含 surfaceUpdate + beginRendering（同一数组内）。"
                ),
            )

        normalized_operations = _normalize_a2ui_operations(operations)
        if not normalized_operations:
            return _build_error_tool_message(
                tool_call_id=tool_call_id,
                raw_a2ui_json=operations,
                error=(
                    "A2UI payload 不符合 v0.8 协议（必须包含 surfaceUpdate + beginRendering，且字段名需正确）。"
                    "已降级展示 raw payload，便于你修正后重新发送。"
                ),
            )

        # Compute a best-effort primary surfaceId (for debugging / client-side grouping).
        surface_id = None
        for op in normalized_operations:
            surface_id = _get_operation_surface_id(op)
            if surface_id:
                break

        payload = {
            "status": "awaiting_user",
            "surface_id": surface_id,
            "catalog_id": None,
            "operations": normalized_operations,
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
        raw_args = request.tool_call.get("args", {})

        tool_call_id = cast(str | None, request.tool_call.get("id"))
        raw_a2ui_json = _extract_raw_a2ui_json_from_args(raw_args)

        operations = _parse_a2ui_operations(raw_a2ui_json)
        if not operations:
            return _build_error_tool_message(
                tool_call_id=tool_call_id,
                raw_a2ui_json=raw_a2ui_json,
                error=(
                    "A2UI payload 无法解析：请在 send_a2ui_json_to_client(a2ui_json=...) 中传入一个 JSON 数组，"
                    "并确保包含 surfaceUpdate + beginRendering（同一数组内）。"
                ),
            )

        normalized_operations = _normalize_a2ui_operations(operations)
        if not normalized_operations:
            return _build_error_tool_message(
                tool_call_id=tool_call_id,
                raw_a2ui_json=operations,
                error=(
                    "A2UI payload 不符合 v0.8 协议（必须包含 surfaceUpdate + beginRendering，且字段名需正确）。"
                    "已降级展示 raw payload，便于你修正后重新发送。"
                ),
            )

        surface_id = None
        for op in normalized_operations:
            surface_id = _get_operation_surface_id(op)
            if surface_id:
                break

        payload = {
            "status": "awaiting_user",
            "surface_id": surface_id,
            "catalog_id": None,
            "operations": normalized_operations,
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
