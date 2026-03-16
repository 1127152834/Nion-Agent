from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, Literal

SessionMode = Literal["normal", "temporary_chat"]

_TRUE_VALUES = {"1", "true", "yes", "on"}
_FALSE_VALUES = {"0", "false", "no", "off"}


@dataclass(frozen=True, slots=True)
class MemorySessionPolicy:
    session_mode: SessionMode
    allow_read: bool
    allow_write: bool


def _normalize_session_mode(value: object) -> SessionMode | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip().lower()
    if normalized == "temporary_chat":
        return "temporary_chat"
    if normalized == "normal":
        return "normal"
    return None


def _coerce_optional_bool(value: object) -> bool | None:
    if isinstance(value, bool):
        return value
    if isinstance(value, int) and value in (0, 1):
        return bool(value)
    if not isinstance(value, str):
        return None

    normalized = value.strip().lower()
    if normalized in _TRUE_VALUES:
        return True
    if normalized in _FALSE_VALUES:
        return False
    return None


def _resolve_session_mode(
    state: Mapping[str, Any],
    runtime_context: Mapping[str, Any],
) -> SessionMode:
    return _normalize_session_mode(state.get("session_mode")) or _normalize_session_mode(runtime_context.get("session_mode")) or "normal"


def _resolve_explicit_bool(
    field_name: str,
    *,
    state: Mapping[str, Any],
    runtime_context: Mapping[str, Any],
) -> bool | None:
    state_value = _coerce_optional_bool(state.get(field_name))
    if state_value is not None:
        return state_value
    return _coerce_optional_bool(runtime_context.get(field_name))


def resolve_memory_policy(
    state: Mapping[str, Any] | None = None,
    runtime_context: Mapping[str, Any] | None = None,
) -> MemorySessionPolicy:
    resolved_state = state or {}
    resolved_runtime_context = runtime_context or {}

    session_mode = _resolve_session_mode(resolved_state, resolved_runtime_context)
    explicit_read = _resolve_explicit_bool(
        "memory_read",
        state=resolved_state,
        runtime_context=resolved_runtime_context,
    )
    explicit_write = _resolve_explicit_bool(
        "memory_write",
        state=resolved_state,
        runtime_context=resolved_runtime_context,
    )

    default_read = True
    default_write = session_mode != "temporary_chat"

    return MemorySessionPolicy(
        session_mode=session_mode,
        allow_read=explicit_read if explicit_read is not None else default_read,
        allow_write=explicit_write if explicit_write is not None else default_write,
    )


def can_read_memory(
    state: Mapping[str, Any] | None = None,
    runtime_context: Mapping[str, Any] | None = None,
) -> bool:
    return resolve_memory_policy(state=state, runtime_context=runtime_context).allow_read


def can_write_memory(
    state: Mapping[str, Any] | None = None,
    runtime_context: Mapping[str, Any] | None = None,
) -> bool:
    return resolve_memory_policy(state=state, runtime_context=runtime_context).allow_write
