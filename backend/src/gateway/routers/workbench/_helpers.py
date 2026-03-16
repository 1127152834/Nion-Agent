"""Shared helpers, constants, and utilities for workbench sub-modules."""

from __future__ import annotations

import json
import re
import threading
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal

import httpx
from fastapi import HTTPException

from src.config.paths import get_paths
from src.gateway.langgraph_client import build_langgraph_upstream_url
from src.gateway.path_utils import resolve_thread_virtual_path

import logging

logger = logging.getLogger(__name__)

# ── Constants ────────────────────────────────────────────────────────────────

DEFAULT_CWD = "/mnt/user-data/workspace"
DEFAULT_COMMAND_TIMEOUT_SECONDS = 600
MAX_COMMAND_TIMEOUT_SECONDS = 1800
SESSION_TTL_SECONDS = 60 * 60
MAX_SESSIONS = 64
_SAFE_PLUGIN_ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,63}$")
_SAFE_SESSION_ID_RE = re.compile(r"^[a-f0-9]{32}$")
_SEMVER_RE = re.compile(r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$")
_PLUGIN_STUDIO_WORKSPACE_SOURCE_ROOT = "/mnt/user-data/workspace/plugin-src"
_PLUGIN_STUDIO_WORKSPACE_TEST_ROOT = "/mnt/user-data/workspace/fixtures"
_TEXT_FILE_EXTENSIONS = {
    ".css",
    ".env",
    ".gif",
    ".html",
    ".htm",
    ".ini",
    ".jpeg",
    ".jpg",
    ".js",
    ".json",
    ".jsx",
    ".md",
    ".mjs",
    ".png",
    ".scss",
    ".svg",
    ".toml",
    ".ts",
    ".tsx",
    ".txt",
    ".vue",
    ".xml",
    ".yaml",
    ".yml",
}


# ── Utility functions ────────────────────────────────────────────────────────


def _utcnow_iso() -> str:
    return datetime.now(UTC).isoformat()


def _sse(event: str, data: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def _resolve_cwd(thread_id: str, cwd: str) -> tuple[str, Path]:
    virtual_cwd = cwd.strip() or DEFAULT_CWD
    if not virtual_cwd.startswith("/"):
        virtual_cwd = f"/{virtual_cwd}"
    actual_cwd = resolve_thread_virtual_path(thread_id, virtual_cwd)
    if not actual_cwd.exists():
        raise HTTPException(status_code=404, detail=f"Workbench cwd not found: {virtual_cwd}")
    if not actual_cwd.is_dir():
        raise HTTPException(status_code=400, detail=f"Workbench cwd is not a directory: {virtual_cwd}")
    return virtual_cwd, actual_cwd


async def _ensure_langgraph_thread_for_plugin_test(thread_id: str, *, best_effort: bool = False) -> None:
    payload = {
        "thread_id": thread_id,
        "metadata": {
            "source": "workbench_test",
        },
    }
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(
                build_langgraph_upstream_url("threads"),
                json=payload,
            )
    except httpx.RequestError as exc:
        if best_effort:
            logger.warning("LangGraph upstream unavailable for workbench test thread '%s': %s", thread_id, exc)
            return
        raise HTTPException(status_code=502, detail=f"LangGraph upstream unavailable: {exc}") from exc

    if response.status_code in {200, 201, 409}:
        return

    detail = response.text.strip()
    if best_effort:
        logger.warning(
            "Failed to create LangGraph thread '%s' for workbench test (status=%s, detail=%s)",
            thread_id,
            response.status_code,
            detail,
        )
        return
    raise HTTPException(status_code=502, detail=detail or f"Failed to create LangGraph thread ({response.status_code})")


# ── Plugin Studio shared helpers ─────────────────────────────────────────────

_PLUGIN_STUDIO_LOCK = threading.Lock()


def _plugin_studio_sessions_dir() -> Path:
    sessions_dir = get_paths().base_dir / "workbench-plugin-studio" / "sessions"
    sessions_dir.mkdir(parents=True, exist_ok=True)
    return sessions_dir


def _plugin_studio_session_dir(session_id: str) -> Path:
    if not _SAFE_SESSION_ID_RE.match(session_id):
        raise HTTPException(status_code=400, detail=f"Invalid plugin studio session id: {session_id}")
    return _plugin_studio_sessions_dir() / session_id


def _plugin_studio_session_file(session_id: str) -> Path:
    return _plugin_studio_session_dir(session_id) / "session.json"


def _safe_plugin_id(raw: str) -> str:
    normalized = raw.strip().lower()
    normalized = re.sub(r"[^a-z0-9-]+", "-", normalized)
    normalized = re.sub(r"-{2,}", "-", normalized).strip("-")
    if len(normalized) < 2:
        normalized = f"plugin-{normalized or 'custom'}"
    if len(normalized) > 64:
        normalized = normalized[:64].rstrip("-")
    if not _SAFE_PLUGIN_ID_RE.match(normalized):
        raise HTTPException(status_code=400, detail=f"Invalid plugin id: {raw}")
    return normalized


def _parse_semver(value: str | None) -> tuple[int, int, int] | None:
    if not value:
        return None
    match = _SEMVER_RE.match(value.strip())
    if not match:
        return None
    return (int(match.group(1)), int(match.group(2)), int(match.group(3)))


def _normalize_semver(value: str | None, *, fallback: str = "0.1.0") -> str:
    parsed = _parse_semver(value)
    if not parsed:
        return fallback
    return f"{parsed[0]}.{parsed[1]}.{parsed[2]}"


def _is_semver_greater(new_version: str, current_version: str) -> bool:
    parsed_new = _parse_semver(new_version)
    parsed_current = _parse_semver(current_version)
    if not parsed_new or not parsed_current:
        return False
    return parsed_new > parsed_current


def _increment_patch(version: str, *, fallback: str = "0.1.1") -> str:
    parsed = _parse_semver(version)
    if not parsed:
        return fallback
    return f"{parsed[0]}.{parsed[1]}.{parsed[2] + 1}"


def _default_workflow_state() -> dict[str, Any]:
    return {
        "goal": "",
        "plugin_scope": "",
        "entry_points": [],
        "core_actions": [],
        "ui_layout_summary": "",
        "interaction_rules": [],
        "component_list": [],
        "data_bindings": [],
        "file_match_mode": "file",
    }


def _to_non_empty_string(value: Any) -> str:
    if value is None:
        return ""
    result = str(value).strip()
    return result


def _to_clean_string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    result: list[str] = []
    for item in value:
        text = _to_non_empty_string(item)
        if text:
            result.append(text)
    return result


def _normalize_workflow_state(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        return _default_workflow_state()
    base = _default_workflow_state()
    base["goal"] = _to_non_empty_string(raw.get("goal"))
    base["plugin_scope"] = _to_non_empty_string(raw.get("plugin_scope"))
    base["entry_points"] = _to_clean_string_list(raw.get("entry_points"))
    base["core_actions"] = _to_clean_string_list(raw.get("core_actions"))
    base["ui_layout_summary"] = _to_non_empty_string(raw.get("ui_layout_summary"))
    base["interaction_rules"] = _to_clean_string_list(raw.get("interaction_rules"))
    base["component_list"] = _to_clean_string_list(raw.get("component_list"))
    base["data_bindings"] = _to_clean_string_list(raw.get("data_bindings"))
    base["file_match_mode"] = _to_non_empty_string(raw.get("file_match_mode")) or "file"
    return base


def _normalize_match_rules(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        return {
            "kind": "file",
            "allowAll": False,
            "extensions": [],
            "mimeTypes": [],
        }
    kind = _to_non_empty_string(raw.get("kind")) or "file"
    allow_all = bool(raw.get("allowAll", False))

    raw_extensions = raw.get("extensions")
    extensions: list[str] = []
    if isinstance(raw_extensions, list):
        for item in raw_extensions:
            text = _to_non_empty_string(item)
            if text:
                # Store extensions without leading dot (e.g. "tsx"), which is what the
                # plugin manifest contract and tests expect.
                normalized = text.lstrip(".").lower()
                if normalized:
                    extensions.append(normalized)

    raw_mimes = raw.get("mimeTypes")
    mime_types: list[str] = []
    if isinstance(raw_mimes, list):
        for item in raw_mimes:
            text = _to_non_empty_string(item)
            if text:
                mime_types.append(text.lower())

    return {
        "kind": kind,
        "allowAll": allow_all,
        "extensions": extensions,
        "mimeTypes": mime_types,
    }


def _is_workflow_requirements_done(state: dict[str, Any]) -> bool:
    return bool(_to_non_empty_string(state.get("goal")) and _to_non_empty_string(state.get("plugin_scope")) and state.get("entry_points"))


def _is_workflow_interaction_done(state: dict[str, Any]) -> bool:
    return bool(
        _is_workflow_requirements_done(state)
        and state.get("core_actions")
        and state.get("interaction_rules"),
    )


def _is_workflow_ui_done(state: dict[str, Any]) -> bool:
    return bool(_is_workflow_interaction_done(state) and state.get("component_list"))


def _compute_workflow_stage(state: dict[str, Any], session_state: str) -> Literal["requirements", "interaction", "ui_design", "generate"]:
    if session_state in {"packaged", "manual_verified", "auto_verified"}:
        return "generate"
    # Current product contract: once requirements are present, the next step is generation.
    # The intermediate "interaction/ui_design" stages are reserved for future use.
    if _is_workflow_requirements_done(state):
        return "generate"
    return "requirements"


def _sync_workflow_fields(session_payload: dict[str, Any]) -> None:
    workflow_state = _normalize_workflow_state(session_payload.get("workflow_state"))
    session_payload["workflow_state"] = workflow_state
    session_payload["workflow_stage"] = _compute_workflow_stage(
        workflow_state, str(session_payload.get("state") or "draft"),
    )


def _safe_relative_material_path(name: str) -> str:
    normalized = name.strip().lstrip("/")
    if not normalized:
        raise HTTPException(status_code=400, detail="Empty material path")
    parts = [p for p in normalized.split("/") if p and p != "."]
    if any(part == ".." for part in parts):
        raise HTTPException(status_code=400, detail=f"Unsafe material path: {name}")
    return "/".join(parts)


def _plugin_studio_test_materials_virtual_root(session_id: str) -> str:
    return f"/mnt/user-data/workspace/fixtures"


def _normalize_material_relative_path(name: str) -> str:
    normalized = name.strip().lstrip("/")
    if not normalized:
        return ""

    # Accept both paths relative to fixtures root (e.g. "sample-project/src/a.tsx") and
    # paths that include the fixtures prefix (e.g. "fixtures/sample-project/src/a.tsx"
    # or "/mnt/user-data/workspace/fixtures/sample-project/src/a.tsx").
    for prefix in (
        "mnt/user-data/workspace/fixtures/",
        "mnt/user-data/workspace/fixtures",
    ):
        if normalized == prefix.rstrip("/"):
            normalized = ""
            break
        if normalized.startswith(prefix):
            normalized = normalized[len(prefix) :].lstrip("/")
            break
    if normalized == "fixtures":
        normalized = ""
    elif normalized.startswith("fixtures/"):
        normalized = normalized[len("fixtures/") :].lstrip("/")
    if not normalized:
        return ""

    parts = [p for p in normalized.split("/") if p and p != "."]
    if any(part == ".." for part in parts):
        return ""
    return "/".join(parts)


def _build_targets_from_match_rules(match_rules: dict[str, Any]) -> list[dict[str, Any]]:
    allow_all = bool(match_rules.get("allowAll", False))
    kind = _to_non_empty_string(match_rules.get("kind")) or "file"
    extensions = match_rules.get("extensions")
    if not isinstance(extensions, list):
        extensions = []
    mime_types = match_rules.get("mimeTypes")
    if not isinstance(mime_types, list):
        mime_types = []

    target: dict[str, Any] = {"kind": kind, "priority": 85}
    if allow_all:
        return [target]
    if extensions:
        target["extensions"] = extensions
    if mime_types:
        target["mimeTypes"] = mime_types
    return [target]


def _match_rules_from_manifest(manifest_payload: dict[str, Any]) -> dict[str, Any]:
    targets = manifest_payload.get("targets")
    if not isinstance(targets, list) or not targets:
        return _normalize_match_rules({})
    first_target = targets[0] if isinstance(targets[0], dict) else {}
    kind = _to_non_empty_string(first_target.get("kind")) or "file"
    extensions = first_target.get("extensions")
    if not isinstance(extensions, list):
        extensions = []
    mime_types = first_target.get("mimeTypes")
    if not isinstance(mime_types, list):
        mime_types = []
    allow_all = not extensions and not mime_types
    return _normalize_match_rules({
        "kind": kind,
        "allowAll": allow_all,
        "extensions": extensions,
        "mimeTypes": mime_types,
    })


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _read_plugin_studio_session(session_id: str) -> dict[str, Any]:
    session_file = _plugin_studio_session_file(session_id)
    if not session_file.exists():
        raise HTTPException(status_code=404, detail=f"Plugin studio session not found: {session_id}")
    try:
        payload = json.loads(session_file.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=500, detail=f"Plugin studio session data broken: {exc}") from exc
    if not isinstance(payload, dict):
        raise HTTPException(status_code=500, detail="Plugin studio session payload is invalid")
    return payload


def _save_plugin_studio_session(session_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    _sync_workflow_fields(payload)
    payload["updated_at"] = _utcnow_iso()
    _write_json(_plugin_studio_session_file(session_id), payload)
    return payload


async def _ensure_plugin_studio_preview_thread(
    session_payload: dict[str, Any],
    *,
    preferred_thread_id: str | None = None,
) -> str:
    resolved_thread_id = _to_non_empty_string(preferred_thread_id) or _to_non_empty_string(
        session_payload.get("preview_thread_id"),
    )
    if resolved_thread_id:
        get_paths().ensure_thread_dirs(resolved_thread_id)
        session_payload["preview_thread_id"] = resolved_thread_id
        return resolved_thread_id

    import uuid

    created_thread_id = str(uuid.uuid4())
    await _ensure_langgraph_thread_for_plugin_test(created_thread_id, best_effort=True)
    get_paths().ensure_thread_dirs(created_thread_id)
    session_payload["preview_thread_id"] = created_thread_id
    return created_thread_id
