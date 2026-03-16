"""Global tool safety guard for host mode."""

from __future__ import annotations

import hashlib
import json
import os
import re
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, NotRequired, TypedDict, cast, override

from langchain_core.messages import HumanMessage, ToolMessage
from langgraph.graph import END
from langgraph.prebuilt.tool_node import ToolCallRequest
from langgraph.runtime import Runtime
from langgraph.types import Command

from src.agents.middlewares.langchain_compat import AgentMiddleware, AgentState
from src.config.app_config import ensure_latest_app_config

DEFAULT_DANGEROUS_PATTERNS = [
    r"\brm\s+-rf\b",
    r"\bshutdown\b",
    r"\breboot\b",
    r"\bpoweroff\b",
    r"\bkill\s+-9\s+-1\b",
    r"\bmkfs\b",
    r"\bdiskutil\s+eraseDisk\b",
    r"curl\s+[^|]*\|\s*(?:bash|sh)\b",
    r"wget\s+[^|]*\|\s*(?:bash|sh)\b",
    r":\(\)\s*\{\s*:\|\:&\s*;\s*\}",
]

DEFAULT_DENY_PATTERNS = [
    r"\brm\s+-rf\s+/(?:\s|$)",
    r"\bdd\s+if=/dev/zero\b",
    r"\bmkfs\b",
]

DEFAULT_PROTECTED_PATHS = [
    "/System",
    "/bin",
    "/usr",
    "/etc",
    "/private",
    "C:\\Windows",
    "C:\\Program Files",
]

DEFAULT_CONFIRM_TTL_SECONDS = 300

WRITE_LIKE_TOOLS = {"bash", "write_file", "str_replace"}
ABSOLUTE_PATH_PATTERN = re.compile(r"(?:[A-Za-z]:[\\/][^\s\"']+|/[^\s\"']+)")
YES_KEYWORDS = {"确认", "确认执行", "同意", "允许", "yes", "y", "ok", "确认继续"}


class ToolSafetyState(TypedDict):
    pending_signature: NotRequired[str | None]
    pending_summary: NotRequired[str | None]
    allow_once_signature: NotRequired[str | None]
    asked_at: NotRequired[str | None]
    resolved_at: NotRequired[str | None]


class HostModePolicy(TypedDict):
    dangerous_patterns: list[str]
    deny_patterns: list[str]
    protected_paths: list[str]
    confirm_ttl_seconds: int


class ToolSafetyGuardState(AgentState):
    execution_mode: NotRequired[str | None]
    clarification: NotRequired[dict | None]
    tool_safety: NotRequired[ToolSafetyState | None]


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


def _parse_iso(value: object) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        return datetime.fromisoformat(value.strip())
    except ValueError:
        return None


def _extract_text(message: HumanMessage) -> str:
    content = message.content
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for block in content:
            if isinstance(block, dict) and block.get("type") == "text":
                text = block.get("text")
                if isinstance(text, str):
                    parts.append(text)
        return "\n".join(parts)
    return ""


def _collect_strings(value: Any) -> list[str]:
    if isinstance(value, str):
        return [value]
    if isinstance(value, dict):
        result: list[str] = []
        for item in value.values():
            result.extend(_collect_strings(item))
        return result
    if isinstance(value, list):
        result: list[str] = []
        for item in value:
            result.extend(_collect_strings(item))
        return result
    return []


def _normalize_pattern_list(raw: Any, fallback: list[str]) -> list[str]:
    if not isinstance(raw, list):
        return fallback
    result = [item.strip() for item in raw if isinstance(item, str) and item.strip()]
    return result or fallback


def _normalize_path_list(raw: Any, fallback: list[str]) -> list[str]:
    if not isinstance(raw, list):
        return fallback
    result = [item.strip() for item in raw if isinstance(item, str) and item.strip()]
    return result or fallback


def _normalize_ttl(raw: Any, fallback: int) -> int:
    try:
        value = int(raw)
    except (TypeError, ValueError):
        return fallback
    if value <= 0:
        return fallback
    return min(value, 24 * 60 * 60)


def _normalize_abs_path(path_value: str) -> str:
    path = Path(path_value).expanduser().resolve(strict=False)
    return os.path.normcase(str(path))


def _path_within(path_value: str, prefix_value: str) -> bool:
    try:
        path_norm = _normalize_abs_path(path_value)
        prefix_norm = _normalize_abs_path(prefix_value)
    except Exception:
        return False
    if prefix_norm in {"/", "\\"}:
        return path_norm.startswith(prefix_norm)
    return path_norm == prefix_norm or path_norm.startswith(prefix_norm + os.sep)


class ToolSafetyGuardMiddleware(AgentMiddleware[ToolSafetyGuardState]):
    """Guard dangerous host-mode operations with deny/allow/ask policy."""

    state_schema = ToolSafetyGuardState

    @staticmethod
    def _load_policy() -> HostModePolicy:
        app_config = ensure_latest_app_config(process_name="langgraph")
        payload = app_config.model_dump()
        host_mode = payload.get("host_mode", {})
        if not isinstance(host_mode, dict):
            host_mode = {}

        return HostModePolicy(
            dangerous_patterns=_normalize_pattern_list(host_mode.get("dangerous_patterns"), DEFAULT_DANGEROUS_PATTERNS),
            deny_patterns=_normalize_pattern_list(host_mode.get("deny_patterns"), DEFAULT_DENY_PATTERNS),
            protected_paths=_normalize_path_list(host_mode.get("protected_paths"), DEFAULT_PROTECTED_PATHS),
            confirm_ttl_seconds=_normalize_ttl(host_mode.get("confirm_ttl_seconds"), DEFAULT_CONFIRM_TTL_SECONDS),
        )

    @staticmethod
    def _signature(tool_name: str, args: dict[str, Any]) -> str:
        raw = f"{tool_name}:{json.dumps(args, ensure_ascii=False, sort_keys=True)}"
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:20]

    @staticmethod
    def _match_regex(patterns: list[str], values: list[str]) -> str | None:
        for pattern in patterns:
            try:
                regex = re.compile(pattern, re.IGNORECASE)
            except re.error:
                continue
            for value in values:
                if regex.search(value):
                    return pattern
        return None

    @staticmethod
    def _collect_absolute_paths(values: list[str]) -> list[str]:
        paths: list[str] = []
        for value in values:
            paths.extend(match.group(0) for match in ABSOLUTE_PATH_PATTERN.finditer(value))
        return paths

    def _evaluate(self, tool_name: str, args: dict[str, Any]) -> tuple[str, str]:
        values = _collect_strings(args)
        policy = self._load_policy()

        deny_hit = self._match_regex(policy["deny_patterns"], values)
        if deny_hit:
            return "deny", f"命中拒绝规则: {deny_hit}"

        dangerous_hit = self._match_regex(policy["dangerous_patterns"], values)
        if dangerous_hit:
            return "ask", f"命中危险规则: {dangerous_hit}"

        if tool_name in WRITE_LIKE_TOOLS:
            requested_paths = self._collect_absolute_paths(values)
            for requested in requested_paths:
                if any(_path_within(requested, protected) for protected in policy["protected_paths"]):
                    return "ask", f"命中受保护路径: {requested}"

        return "allow", "安全策略放行"

    def _build_clarification_payload(
        self,
        summary: str,
        tool_call_id: str | None,
    ) -> dict[str, Any]:
        return {
            "status": "awaiting_user",
            "question": f"检测到高风险主机操作（{summary}）。回复“确认执行”继续，回复其他内容将取消。",
            "clarification_type": "risk_confirmation",
            "context": "ToolSafetyGuard",
            "options": ["确认执行", "取消"],
            "requires_choice": True,
            "tool_call_id": tool_call_id,
            "asked_at": _now_iso(),
            "resolved_at": None,
            "resolved_by_message_id": None,
        }

    @override
    def before_agent(self, state: ToolSafetyGuardState, runtime: Runtime) -> dict | None:
        _ = runtime
        safety = state.get("tool_safety")
        if not isinstance(safety, dict):
            return None

        pending_signature = safety.get("pending_signature")
        if not isinstance(pending_signature, str) or not pending_signature:
            return None

        messages = state.get("messages", [])
        if not messages:
            return None
        last_message = messages[-1]
        if not isinstance(last_message, HumanMessage):
            return None

        text = _extract_text(last_message).strip().lower()
        approved = text in YES_KEYWORDS
        policy = self._load_policy()
        asked_at = _parse_iso(safety.get("asked_at"))
        now = datetime.now(UTC)
        expired = False
        if asked_at is not None:
            if asked_at.tzinfo is None:
                asked_at = asked_at.replace(tzinfo=UTC)
            expired = (now - asked_at).total_seconds() > policy["confirm_ttl_seconds"]

        next_state: ToolSafetyState = {
            "pending_signature": None,
            "pending_summary": None,
            "allow_once_signature": pending_signature if approved and not expired else None,
            "resolved_at": _now_iso(),
        }

        clarification = state.get("clarification")
        update: dict[str, Any] = {"tool_safety": next_state}
        if isinstance(clarification, dict) and clarification.get("status") == "awaiting_user":
            resolved = dict(clarification)
            resolved["status"] = "resolved"
            resolved["resolved_at"] = _now_iso()
            resolved["resolved_by_message_id"] = getattr(last_message, "id", None)
            update["clarification"] = resolved
        return update

    @override
    async def awrap_tool_call(
        self,
        request: ToolCallRequest,
        handler: Callable[[ToolCallRequest], Awaitable[ToolMessage | Command]],
    ) -> ToolMessage | Command:
        state = request.state if isinstance(request.state, dict) else {}
        execution_mode = str(state.get("execution_mode") or "sandbox")
        if execution_mode != "host":
            return await handler(request)

        tool_name = str(request.tool_call.get("name") or "")
        args = cast(dict[str, Any], request.tool_call.get("args") or {})
        signature = self._signature(tool_name, args)

        safety_state = state.get("tool_safety")
        if not isinstance(safety_state, dict):
            safety_state = {}
        allow_once = safety_state.get("allow_once_signature")
        if isinstance(allow_once, str) and allow_once == signature:
            # Consume the once token before executing.
            state["tool_safety"] = {
                "pending_signature": None,
                "pending_summary": None,
                "allow_once_signature": None,
                "resolved_at": _now_iso(),
            }
            return await handler(request)

        decision, reason = self._evaluate(tool_name, args)
        tool_call_id = cast(str | None, request.tool_call.get("id"))

        if decision == "allow":
            return await handler(request)

        if decision == "deny":
            return ToolMessage(
                content=f"已拒绝执行该操作：{reason}",
                tool_call_id=tool_call_id or "",
                name="tool_safety_guard",
            )

        clarification = self._build_clarification_payload(reason, tool_call_id)
        return Command(
            update={
                "messages": [
                    ToolMessage(
                        content=clarification["question"],
                        tool_call_id=tool_call_id or "",
                        name="tool_safety_guard",
                    )
                ],
                "tool_safety": {
                    "pending_signature": signature,
                    "pending_summary": reason,
                    "allow_once_signature": None,
                    "asked_at": _now_iso(),
                },
                "clarification": clarification,
            },
            goto=END,
        )

    @override
    def wrap_tool_call(
        self,
        request: ToolCallRequest,
        handler,
    ) -> ToolMessage | Command:
        state = request.state if isinstance(request.state, dict) else {}
        execution_mode = str(state.get("execution_mode") or "sandbox")
        if execution_mode != "host":
            return handler(request)

        tool_name = str(request.tool_call.get("name") or "")
        args = cast(dict[str, Any], request.tool_call.get("args") or {})
        signature = self._signature(tool_name, args)

        safety_state = state.get("tool_safety")
        if not isinstance(safety_state, dict):
            safety_state = {}
        allow_once = safety_state.get("allow_once_signature")
        if isinstance(allow_once, str) and allow_once == signature:
            # Consume the once token before executing.
            state["tool_safety"] = {
                "pending_signature": None,
                "pending_summary": None,
                "allow_once_signature": None,
                "resolved_at": _now_iso(),
            }
            return handler(request)

        decision, reason = self._evaluate(tool_name, args)
        tool_call_id = cast(str | None, request.tool_call.get("id"))

        if decision == "allow":
            return handler(request)

        if decision == "deny":
            return ToolMessage(
                content=f"已拒绝执行该操作：{reason}",
                tool_call_id=tool_call_id or "",
                name="tool_safety_guard",
            )

        clarification = self._build_clarification_payload(reason, tool_call_id)
        return Command(
            update={
                "messages": [
                    ToolMessage(
                        content=clarification["question"],
                        tool_call_id=tool_call_id or "",
                        name="tool_safety_guard",
                    )
                ],
                "tool_safety": {
                    "pending_signature": signature,
                    "pending_summary": reason,
                    "allow_once_signature": None,
                    "asked_at": _now_iso(),
                },
                "clarification": clarification,
            },
            goto=END,
        )
