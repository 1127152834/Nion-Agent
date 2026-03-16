"""Workbench runtime APIs: command sessions and plugin test execution."""

from __future__ import annotations

import asyncio
import base64
import io
import json
import logging
import os
import re
import shutil
import signal
import subprocess
import threading
import time
import uuid
import zipfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal
from urllib.parse import quote

import httpx
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field

from src.config.paths import get_paths
from src.gateway.langgraph_client import build_langgraph_upstream_url
from src.gateway.path_utils import resolve_thread_virtual_path

router = APIRouter(prefix="/api/threads/{thread_id}/workbench", tags=["workbench"])
plugin_router = APIRouter(prefix="/api/workbench/plugins", tags=["workbench"])
marketplace_router = APIRouter(prefix="/api/workbench/marketplace", tags=["workbench"])
plugin_studio_router = APIRouter(prefix="/api/workbench/plugin-studio", tags=["workbench"])

logger = logging.getLogger(__name__)

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


def _utcnow_iso() -> str:
    return datetime.now(UTC).isoformat()


def _sse(event: str, data: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


class WorkbenchSessionCreateRequest(BaseModel):
    command: str = Field(..., min_length=1, max_length=4000)
    cwd: str = Field(default=DEFAULT_CWD, min_length=1, max_length=1024)
    timeout_seconds: int = Field(default=DEFAULT_COMMAND_TIMEOUT_SECONDS, ge=1, le=MAX_COMMAND_TIMEOUT_SECONDS)


class WorkbenchSessionCreateResponse(BaseModel):
    session_id: str
    status: Literal["running", "finished", "failed", "stopped", "timeout"]
    thread_id: str
    command: str
    cwd: str
    created_at: str


class WorkbenchSessionStopResponse(BaseModel):
    success: bool
    session_id: str
    status: Literal["running", "finished", "failed", "stopped", "timeout"]


class PluginTestCommandStep(BaseModel):
    id: str | None = None
    command: str = Field(..., min_length=1, max_length=4000)
    cwd: str = Field(default=DEFAULT_CWD, min_length=1, max_length=1024)
    timeout_seconds: int = Field(default=120, ge=1, le=MAX_COMMAND_TIMEOUT_SECONDS)
    expect_contains: list[str] = Field(default_factory=list)


class PluginTestRequest(BaseModel):
    thread_id: str = Field(..., min_length=1)
    command_steps: list[PluginTestCommandStep] = Field(default_factory=list)


class PluginTestStepResult(BaseModel):
    id: str
    passed: bool
    command: str
    cwd: str
    exit_code: int | None = None
    duration_ms: int
    output_excerpt: str
    message: str | None = None


class PluginTestResponse(BaseModel):
    plugin_id: str
    passed: bool
    executed_at: str
    summary: str
    steps: list[PluginTestStepResult]


class PluginTestThreadResponse(BaseModel):
    thread_id: str
    created_at: str
    workspace_root: str


class MarketplacePluginListItem(BaseModel):
    id: str
    name: str
    description: str
    version: str
    maintainer: str | None = None
    tags: list[str] = Field(default_factory=list)
    updated_at: str | None = None
    download_url: str
    detail_url: str
    docs_summary: str | None = None


class MarketplacePluginListResponse(BaseModel):
    plugins: list[MarketplacePluginListItem]


class MarketplacePluginDetailResponse(BaseModel):
    id: str
    name: str
    description: str
    version: str
    maintainer: str | None = None
    tags: list[str] = Field(default_factory=list)
    updated_at: str | None = None
    download_url: str
    readme_markdown: str
    demo_image_urls: list[str] = Field(default_factory=list)


class PluginStudioSessionCreateRequest(BaseModel):
    plugin_name: str = Field(..., min_length=2, max_length=80)
    plugin_id: str | None = Field(default=None, min_length=2, max_length=64)
    description: str = Field(default="", max_length=400)
    chat_thread_id: str | None = Field(default=None, min_length=1, max_length=200)


class PluginStudioGenerateRequest(BaseModel):
    description: str | None = Field(default=None, max_length=2000)


class PluginStudioImportSourceRequest(BaseModel):
    package_base64: str = Field(..., min_length=8)
    filename: str | None = Field(default=None, max_length=240)
    linked_plugin_id: str | None = Field(default=None, min_length=2, max_length=64)
    plugin_name: str | None = Field(default=None, min_length=2, max_length=80)
    description: str | None = Field(default=None, max_length=2000)
    thread_id: str | None = Field(default=None, min_length=1, max_length=200)


class PluginStudioManualVerifyRequest(BaseModel):
    passed: bool = Field(default=True)
    note: str | None = Field(default=None, max_length=1000)


class PluginStudioStepReport(BaseModel):
    id: str
    passed: bool
    message: str


class PluginStudioAutoVerifyResponse(BaseModel):
    session_id: str
    passed: bool
    executed_at: str
    summary: str
    steps: list[PluginStudioStepReport]


class PluginStudioPublishRequest(BaseModel):
    version: str = Field(..., min_length=5, max_length=32)
    release_notes: str = Field(..., min_length=1, max_length=8000)
    description: str = Field(..., min_length=1, max_length=4000)
    conversation_snapshot: str = Field(default="", max_length=20000)
    auto_download: bool = Field(default=False)


class PluginStudioDraftRequest(BaseModel):
    description: str | None = Field(default=None, max_length=4000)
    draft_version: str | None = Field(default=None, min_length=5, max_length=32)
    chat_thread_id: str | None = Field(default=None, min_length=1, max_length=200)
    match_rules: dict[str, Any] | None = None
    workflow_state: dict[str, Any] | None = None
    workflow_stage: Literal["requirements", "interaction", "ui_design", "generate"] | None = None
    selected_test_material_path: str | None = Field(default=None, max_length=2048)


class PluginStudioTestMaterialEntry(BaseModel):
    path: str = Field(..., min_length=1, max_length=512)
    content_base64: str = Field(..., min_length=4)
    source: Literal["upload", "zip"] = "upload"


class PluginStudioTestMaterialImportRequest(BaseModel):
    thread_id: str | None = Field(default=None, min_length=1, max_length=200)
    entries: list[PluginStudioTestMaterialEntry] = Field(default_factory=list, min_length=1, max_length=500)
    selected_path: str | None = Field(default=None, max_length=512)


class PluginStudioTestMaterialDeleteRequest(BaseModel):
    thread_id: str | None = Field(default=None, min_length=1, max_length=200)
    path: str = Field(..., min_length=1, max_length=2048)


class PluginStudioTestMaterialsResponse(BaseModel):
    session_id: str
    test_materials: list[dict[str, str]]
    selected_test_material_path: str | None = None


class PluginStudioSessionResponse(BaseModel):
    session_id: str
    plugin_id: str
    plugin_name: str
    chat_thread_id: str | None = None
    preview_thread_id: str | None = None
    description: str
    state: Literal["draft", "generated", "auto_verified", "manual_verified", "packaged"]
    auto_verified: bool
    manual_verified: bool
    current_version: str
    release_notes: str | None = None
    source_mode: Literal["scratch", "imported"] = "scratch"
    linked_plugin_id: str | None = None
    published_at: str | None = None
    created_at: str
    updated_at: str
    readme_url: str | None = None
    demo_image_urls: list[str] = Field(default_factory=list)
    package_download_url: str | None = None
    workflow_stage: Literal["requirements", "interaction", "ui_design", "generate"] = "requirements"
    workflow_state: dict[str, Any] = Field(default_factory=dict)
    draft_version: str | None = None
    match_rules: dict[str, Any] = Field(default_factory=dict)
    test_materials: list[dict[str, str]] = Field(default_factory=list)
    selected_test_material_path: str | None = None


class PluginStudioPackageResponse(BaseModel):
    session_id: str
    plugin_id: str
    filename: str
    package_download_url: str
    packaged_at: str


class PluginStudioWorkspaceSyncRequest(BaseModel):
    thread_id: str = Field(..., min_length=1, max_length=200)
    include_test_materials: bool = Field(default=True)


class PluginStudioWorkspaceSeedResponse(BaseModel):
    session_id: str
    thread_id: str
    source_root: str
    test_materials_root: str | None = None


class PluginStudioSourceFileResponse(BaseModel):
    encoding: Literal["text", "base64"]
    content: str


class PluginStudioSourcePackageResponse(BaseModel):
    session_id: str
    manifest: dict[str, Any]
    files: dict[str, PluginStudioSourceFileResponse]


class PluginStudioPublishResponse(BaseModel):
    session: PluginStudioSessionResponse
    plugin_id: str
    version: str
    filename: str
    package_download_url: str
    packaged_at: str
    verify_report: PluginStudioAutoVerifyResponse


class _SessionState:
    def __init__(self, *, thread_id: str, command: str, cwd_virtual: str, cwd_actual: Path):
        self.id = uuid.uuid4().hex
        self.thread_id = thread_id
        self.command = command
        self.cwd_virtual = cwd_virtual
        self.cwd_actual = cwd_actual
        self.created_at = _utcnow_iso()
        self.status: Literal["running", "finished", "failed", "stopped", "timeout"] = "running"
        self.return_code: int | None = None
        self.finished_at: str | None = None
        self.events: list[dict[str, Any]] = []
        self._event_lock = threading.Lock()
        self._process: subprocess.Popen[str] | None = None
        self._reader_thread: threading.Thread | None = None
        self._killer_timer: threading.Timer | None = None

    def append_event(self, event: str, data: dict[str, Any]) -> None:
        payload = {"event": event, "timestamp": _utcnow_iso(), **data}
        with self._event_lock:
            self.events.append(payload)

    def read_events_since(self, index: int) -> tuple[list[dict[str, Any]], int]:
        with self._event_lock:
            if index < 0:
                index = 0
            if index >= len(self.events):
                return [], len(self.events)
            next_events = self.events[index:]
            return next_events, len(self.events)

    def mark_finished(self, status: Literal["finished", "failed", "stopped", "timeout"], return_code: int | None) -> None:
        if self.status != "running":
            return
        self.status = status
        self.return_code = return_code
        self.finished_at = _utcnow_iso()

    def stop(self) -> None:
        if self._process is None or self.status != "running":
            return
        try:
            os.killpg(os.getpgid(self._process.pid), signal.SIGTERM)
        except ProcessLookupError:
            pass
        except Exception:
            self._process.terminate()
        self.mark_finished("stopped", self._process.poll())
        self.append_event("exit", {"status": self.status, "return_code": self.return_code})

    def enforce_timeout(self) -> None:
        if self.status != "running":
            return
        self.append_event("stderr", {"text": "Command timed out and was terminated."})
        if self._process is not None:
            try:
                os.killpg(os.getpgid(self._process.pid), signal.SIGKILL)
            except ProcessLookupError:
                pass
            except Exception:
                self._process.kill()
        self.mark_finished("timeout", self._process.poll() if self._process else None)
        self.append_event("exit", {"status": self.status, "return_code": self.return_code})


_SESSIONS: dict[str, _SessionState] = {}
_SESSIONS_LOCK = threading.Lock()


def _cleanup_expired_sessions() -> None:
    now = time.time()
    with _SESSIONS_LOCK:
        stale_ids: list[str] = []
        for sid, session in _SESSIONS.items():
            if session.status == "running":
                continue
            finished_at = session.finished_at or session.created_at
            try:
                finished_ts = datetime.fromisoformat(finished_at).timestamp()
            except ValueError:
                finished_ts = now
            if now - finished_ts > SESSION_TTL_SECONDS:
                stale_ids.append(sid)
        for sid in stale_ids:
            _SESSIONS.pop(sid, None)


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


def _start_session_process(session: _SessionState, timeout_seconds: int) -> None:
    process = subprocess.Popen(
        ["/bin/zsh", "-lc", session.command],
        cwd=str(session.cwd_actual),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
        preexec_fn=os.setsid,
    )
    session._process = process
    session.append_event(
        "start",
        {
            "session_id": session.id,
            "command": session.command,
            "cwd": session.cwd_virtual,
            "status": session.status,
        },
    )

    def reader() -> None:
        assert process.stdout is not None
        try:
            for line in process.stdout:
                session.append_event("stdout", {"text": line.rstrip("\n")})
        finally:
            process.wait()
            if session.status == "running":
                final_status: Literal["finished", "failed"] = "finished" if process.returncode == 0 else "failed"
                session.mark_finished(final_status, process.returncode)
                session.append_event(
                    "exit",
                    {
                        "status": session.status,
                        "return_code": session.return_code,
                    },
                )

    session._reader_thread = threading.Thread(target=reader, daemon=True)
    session._reader_thread.start()

    timer = threading.Timer(timeout_seconds, session.enforce_timeout)
    timer.daemon = True
    timer.start()
    session._killer_timer = timer


@router.post(
    "/sessions",
    response_model=WorkbenchSessionCreateResponse,
    summary="Create workbench command session",
)
async def create_workbench_session(thread_id: str, payload: WorkbenchSessionCreateRequest) -> WorkbenchSessionCreateResponse:
    _cleanup_expired_sessions()
    virtual_cwd, actual_cwd = _resolve_cwd(thread_id, payload.cwd)

    with _SESSIONS_LOCK:
        if len(_SESSIONS) >= MAX_SESSIONS:
            raise HTTPException(status_code=429, detail="Too many active workbench sessions")
        session = _SessionState(
            thread_id=thread_id,
            command=payload.command,
            cwd_virtual=virtual_cwd,
            cwd_actual=actual_cwd,
        )
        _SESSIONS[session.id] = session

    try:
        _start_session_process(session, payload.timeout_seconds)
    except Exception as exc:
        with _SESSIONS_LOCK:
            _SESSIONS.pop(session.id, None)
        raise HTTPException(status_code=500, detail=f"Failed to start workbench session: {exc}") from exc

    return WorkbenchSessionCreateResponse(
        session_id=session.id,
        status=session.status,
        thread_id=thread_id,
        command=session.command,
        cwd=session.cwd_virtual,
        created_at=session.created_at,
    )


def _get_session_or_404(thread_id: str, session_id: str) -> _SessionState:
    with _SESSIONS_LOCK:
        session = _SESSIONS.get(session_id)
    if session is None or session.thread_id != thread_id:
        raise HTTPException(status_code=404, detail=f"Workbench session not found: {session_id}")
    return session


@router.post(
    "/sessions/{session_id}/stop",
    response_model=WorkbenchSessionStopResponse,
    summary="Stop workbench command session",
)
async def stop_workbench_session(thread_id: str, session_id: str) -> WorkbenchSessionStopResponse:
    session = _get_session_or_404(thread_id, session_id)
    session.stop()
    return WorkbenchSessionStopResponse(success=True, session_id=session.id, status=session.status)


@router.get(
    "/sessions/{session_id}/stream",
    summary="Stream workbench session output",
)
async def stream_workbench_session(thread_id: str, session_id: str, request: Request) -> StreamingResponse:
    session = _get_session_or_404(thread_id, session_id)

    async def event_stream() -> Any:
        cursor = 0
        yield _sse(
            "ready",
            {
                "session_id": session.id,
                "status": session.status,
                "timestamp": _utcnow_iso(),
            },
        )
        while True:
            if await request.is_disconnected():
                break
            next_events, cursor = session.read_events_since(cursor)
            if next_events:
                for event in next_events:
                    yield _sse(event.get("event", "output"), event)
            elif session.status != "running":
                break
            else:
                yield _sse("heartbeat", {"session_id": session.id, "timestamp": _utcnow_iso()})
                await asyncio.sleep(1.0)

    headers = {
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
    }
    return StreamingResponse(event_stream(), media_type="text/event-stream", headers=headers)


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


@plugin_router.post(
    "/test-thread",
    response_model=PluginTestThreadResponse,
    summary="Create hidden workbench test thread",
)
async def create_workbench_test_thread() -> PluginTestThreadResponse:
    """Create a sandbox-only thread directory for workbench plugin tests.

    This avoids coupling plugin tests to any existing chat thread while still
    providing a valid /mnt/user-data workspace for commandSteps execution.
    """
    thread_id = str(uuid.uuid4())
    await _ensure_langgraph_thread_for_plugin_test(thread_id, best_effort=True)
    paths = get_paths()
    paths.ensure_thread_dirs(thread_id)
    return PluginTestThreadResponse(
        thread_id=thread_id,
        created_at=_utcnow_iso(),
        workspace_root=str(paths.sandbox_work_dir(thread_id)),
    )


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

    created_thread_id = str(uuid.uuid4())
    await _ensure_langgraph_thread_for_plugin_test(created_thread_id, best_effort=True)
    get_paths().ensure_thread_dirs(created_thread_id)
    session_payload["preview_thread_id"] = created_thread_id
    return created_thread_id


@plugin_router.post(
    "/{plugin_id}/test",
    response_model=PluginTestResponse,
    summary="Run plugin compatibility test",
)
async def test_workbench_plugin(plugin_id: str, payload: PluginTestRequest) -> PluginTestResponse:
    step_results: list[PluginTestStepResult] = []
    all_passed = True

    for index, step in enumerate(payload.command_steps):
        started_at = time.time()
        step_id = step.id or f"command-{index + 1}"
        try:
            virtual_cwd, actual_cwd = _resolve_cwd(payload.thread_id, step.cwd)
        except HTTPException as exc:
            duration_ms = int((time.time() - started_at) * 1000)
            step_results.append(
                PluginTestStepResult(
                    id=step_id,
                    passed=False,
                    command=step.command,
                    cwd=step.cwd,
                    exit_code=None,
                    duration_ms=duration_ms,
                    output_excerpt="",
                    message=str(exc.detail),
                ),
            )
            all_passed = False
            continue

        output_excerpt = ""
        exit_code: int | None = None
        passed = False
        message: str | None = None

        try:
            process = subprocess.run(
                ["/bin/zsh", "-lc", step.command],
                cwd=str(actual_cwd),
                capture_output=True,
                text=True,
                timeout=step.timeout_seconds,
            )
            exit_code = process.returncode
            combined_output = (process.stdout or "") + ("\n" + process.stderr if process.stderr else "")
            output_excerpt = combined_output[:4000]
            passed = process.returncode == 0
            if passed and step.expect_contains:
                for expected in step.expect_contains:
                    if expected in combined_output:
                        continue

                    # Allow virtual /mnt/user-data paths to match their resolved host paths.
                    # Workbench command steps run on the host, so `pwd` will emit host paths.
                    alternate_match = False
                    if expected.startswith("/mnt/user-data"):
                        try:
                            resolved = resolve_thread_virtual_path(payload.thread_id, expected)
                            if str(resolved) in combined_output:
                                alternate_match = True
                        except HTTPException:
                            alternate_match = False

                    if not alternate_match:
                        passed = False
                        message = f"Missing expected output fragment: {expected}"
                        break
            if not passed and message is None and process.returncode != 0:
                message = f"Command exited with code {process.returncode}"
        except subprocess.TimeoutExpired as exc:
            timeout_output = (exc.stdout or "") + ("\n" + exc.stderr if exc.stderr else "")
            output_excerpt = timeout_output[:4000]
            passed = False
            message = f"Command timed out after {step.timeout_seconds}s"
        except Exception as exc:
            passed = False
            message = f"Command execution failed: {exc}"

        duration_ms = int((time.time() - started_at) * 1000)
        step_results.append(
            PluginTestStepResult(
                id=step_id,
                passed=passed,
                command=step.command,
                cwd=virtual_cwd,
                exit_code=exit_code,
                duration_ms=duration_ms,
                output_excerpt=output_excerpt,
                message=message,
            ),
        )
        all_passed = all_passed and passed

    if not payload.command_steps:
        summary = "No command steps provided; plugin test accepted."
    elif all_passed:
        summary = f"All {len(payload.command_steps)} command steps passed."
    else:
        summary = f"{sum(1 for r in step_results if r.passed)}/{len(payload.command_steps)} command steps passed."

    return PluginTestResponse(
        plugin_id=plugin_id,
        passed=all_passed,
        executed_at=_utcnow_iso(),
        summary=summary,
        steps=step_results,
    )


def _repo_root_dir() -> Path:
    return Path(__file__).resolve().parents[4]


def _marketplace_catalog_file() -> Path:
    if env_value := os.getenv("NION_WORKBENCH_MARKETPLACE_CATALOG"):
        return Path(env_value).expanduser().resolve()
    return (_repo_root_dir() / "backend" / "data" / "workbench_marketplace" / "catalog.json").resolve()


def _marketplace_assets_dir() -> Path:
    return (_repo_root_dir() / "backend" / "data" / "workbench_marketplace" / "assets").resolve()


def _safe_repo_relative_path(raw_path: str) -> Path:
    if not raw_path:
        raise HTTPException(status_code=400, detail="Empty relative path is not allowed")
    repo_root = _repo_root_dir().resolve()
    candidate = (repo_root / raw_path).resolve()
    try:
        candidate.relative_to(repo_root)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"Path escapes repository root: {raw_path}") from exc
    return candidate


def _load_marketplace_catalog() -> list[dict[str, Any]]:
    catalog_file = _marketplace_catalog_file()
    if not catalog_file.exists():
        return []
    try:
        payload = json.loads(catalog_file.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=500, detail=f"Invalid marketplace catalog JSON: {exc}") from exc
    plugins = payload.get("plugins")
    if not isinstance(plugins, list):
        raise HTTPException(status_code=500, detail="Marketplace catalog missing `plugins` list")
    normalized: list[dict[str, Any]] = []
    for item in plugins:
        if isinstance(item, dict):
            normalized.append(item)
    return normalized


def _find_marketplace_entry(plugin_id: str) -> dict[str, Any]:
    for item in _load_marketplace_catalog():
        if str(item.get("id", "")).strip() == plugin_id:
            return item
    raise HTTPException(status_code=404, detail=f"Marketplace plugin not found: {plugin_id}")


def _entry_package_path(entry: dict[str, Any]) -> Path:
    path_value = str(entry.get("package_path", "")).strip()
    if not path_value:
        raise HTTPException(status_code=500, detail=f"Marketplace plugin `{entry.get('id')}` has no package_path")
    package_path = _safe_repo_relative_path(path_value)
    if not package_path.exists() or not package_path.is_file():
        raise HTTPException(status_code=404, detail=f"Marketplace package missing: {path_value}")
    return package_path


def _entry_readme_text(entry: dict[str, Any]) -> str:
    path_value = str(entry.get("readme_path", "")).strip()
    if not path_value:
        return ""
    readme_file = _safe_repo_relative_path(path_value)
    if not readme_file.exists() or not readme_file.is_file():
        return ""
    return readme_file.read_text(encoding="utf-8")


def _entry_demo_image_urls(entry: dict[str, Any]) -> list[str]:
    demo_images_raw = entry.get("demo_images")
    if not isinstance(demo_images_raw, list):
        return []
    urls: list[str] = []
    for raw in demo_images_raw:
        asset_rel = str(raw or "").strip().lstrip("/")
        if not asset_rel:
            continue
        candidate = (_marketplace_assets_dir() / asset_rel).resolve()
        try:
            candidate.relative_to(_marketplace_assets_dir())
        except ValueError:
            continue
        if not candidate.exists() or not candidate.is_file():
            continue
        encoded = quote(asset_rel)
        urls.append(f"/api/workbench/marketplace/assets/{encoded}")
    return urls


def _marketplace_list_item(entry: dict[str, Any]) -> MarketplacePluginListItem:
    plugin_id = str(entry.get("id", "")).strip()
    if not plugin_id:
        raise HTTPException(status_code=500, detail="Marketplace catalog contains plugin with empty id")
    # Resolve package path ahead of time so list only shows installable entries.
    _entry_package_path(entry)

    readme = _entry_readme_text(entry)
    docs_summary = None
    if readme:
        first_line = next((line.strip() for line in readme.splitlines() if line.strip()), "")
        docs_summary = first_line[:180] if first_line else None

    return MarketplacePluginListItem(
        id=plugin_id,
        name=str(entry.get("name") or plugin_id),
        description=str(entry.get("description") or "No description"),
        version=str(entry.get("version") or "0.0.0"),
        maintainer=str(entry.get("maintainer") or "") or None,
        tags=[str(tag) for tag in entry.get("tags", []) if str(tag).strip()],
        updated_at=str(entry.get("updated_at") or "") or None,
        download_url=f"/api/workbench/marketplace/plugins/{plugin_id}/download",
        detail_url=f"/api/workbench/marketplace/plugins/{plugin_id}",
        docs_summary=docs_summary,
    )


@marketplace_router.get(
    "/plugins",
    response_model=MarketplacePluginListResponse,
    summary="List available workbench marketplace plugins",
)
async def list_workbench_marketplace_plugins() -> MarketplacePluginListResponse:
    items: list[MarketplacePluginListItem] = []
    for entry in _load_marketplace_catalog():
        try:
            items.append(_marketplace_list_item(entry))
        except HTTPException:
            # Keep the list resilient: malformed entries are skipped instead of
            # breaking the whole marketplace page.
            continue
    return MarketplacePluginListResponse(plugins=items)


@marketplace_router.get(
    "/plugins/{plugin_id}",
    response_model=MarketplacePluginDetailResponse,
    summary="Get workbench marketplace plugin detail",
)
async def get_workbench_marketplace_plugin_detail(plugin_id: str) -> MarketplacePluginDetailResponse:
    entry = _find_marketplace_entry(plugin_id)
    list_item = _marketplace_list_item(entry)
    readme_markdown = _entry_readme_text(entry)
    if not readme_markdown:
        readme_markdown = f"# {list_item.name}\n\n{list_item.description}\n"
    return MarketplacePluginDetailResponse(
        id=list_item.id,
        name=list_item.name,
        description=list_item.description,
        version=list_item.version,
        maintainer=list_item.maintainer,
        tags=list_item.tags,
        updated_at=list_item.updated_at,
        download_url=list_item.download_url,
        readme_markdown=readme_markdown,
        demo_image_urls=_entry_demo_image_urls(entry),
    )


@marketplace_router.get(
    "/plugins/{plugin_id}/download",
    summary="Download marketplace plugin package",
)
async def download_workbench_marketplace_plugin(plugin_id: str) -> FileResponse:
    entry = _find_marketplace_entry(plugin_id)
    package_file = _entry_package_path(entry)
    filename = f"{plugin_id}.nwp"
    return FileResponse(path=package_file, filename=filename, media_type="application/zip")


@marketplace_router.get(
    "/assets/{asset_path:path}",
    summary="Read marketplace documentation/demo asset",
)
async def read_workbench_marketplace_asset(asset_path: str) -> FileResponse:
    normalized = asset_path.lstrip("/")
    if not normalized:
        raise HTTPException(status_code=404, detail="Asset path is empty")
    candidate = (_marketplace_assets_dir() / normalized).resolve()
    try:
        candidate.relative_to(_marketplace_assets_dir())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid marketplace asset path") from exc
    if not candidate.exists() or not candidate.is_file():
        raise HTTPException(status_code=404, detail=f"Marketplace asset not found: {asset_path}")
    return FileResponse(path=candidate)


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
        "target_user": "",
        "plugin_scope": "",
        "entry_points": [],
        "core_actions": [],
        "file_match_mode": "",
        "layout_template": "",
        "visual_style": "",
        "responsive_rules": "",
    }


def _to_non_empty_string(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    return value.strip()


def _to_clean_string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    result: list[str] = []
    for item in value:
        normalized = _to_non_empty_string(item)
        if normalized and normalized not in result:
            result.append(normalized)
    return result


def _normalize_workflow_state(raw: Any) -> dict[str, Any]:
    baseline = _default_workflow_state()
    if not isinstance(raw, dict):
        return baseline
    baseline["goal"] = _to_non_empty_string(raw.get("goal"))
    baseline["target_user"] = _to_non_empty_string(raw.get("target_user"))
    baseline["plugin_scope"] = _to_non_empty_string(raw.get("plugin_scope"))
    baseline["entry_points"] = _to_clean_string_list(raw.get("entry_points"))
    baseline["core_actions"] = _to_clean_string_list(raw.get("core_actions"))
    baseline["file_match_mode"] = _to_non_empty_string(raw.get("file_match_mode"))
    baseline["layout_template"] = _to_non_empty_string(raw.get("layout_template"))
    baseline["visual_style"] = _to_non_empty_string(raw.get("visual_style"))
    baseline["responsive_rules"] = _to_non_empty_string(raw.get("responsive_rules"))
    return baseline


def _normalize_match_rules(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        return {
            "allowAll": False,
            "kind": "file",
            "extensions": [],
            "pathPattern": "",
            "projectMarkers": [],
        }
    kind = _to_non_empty_string(raw.get("kind")).lower() or "file"
    if kind not in {"file", "directory", "project"}:
        kind = "file"
    allow_all_raw = raw.get("allowAll")
    allow_all = bool(allow_all_raw) if isinstance(allow_all_raw, bool) else False

    extensions = _to_clean_string_list(raw.get("extensions"))
    if isinstance(raw.get("extensions"), str):
        extensions = _to_clean_string_list([part.strip() for part in str(raw.get("extensions", "")).split(",")])
    normalized_extensions = []
    for ext in extensions:
        clean = ext.strip().lstrip(".").lower()
        if clean and clean not in normalized_extensions:
            normalized_extensions.append(clean)

    project_markers = _to_clean_string_list(raw.get("projectMarkers"))
    if isinstance(raw.get("projectMarkers"), str):
        project_markers = _to_clean_string_list([part.strip() for part in str(raw.get("projectMarkers", "")).split(",")])

    return {
        "allowAll": allow_all,
        "kind": kind,
        "extensions": normalized_extensions,
        "pathPattern": _to_non_empty_string(raw.get("pathPattern")),
        "projectMarkers": project_markers,
    }


def _is_workflow_requirements_done(state: dict[str, Any]) -> bool:
    return bool(_to_non_empty_string(state.get("goal")) and _to_non_empty_string(state.get("target_user")) and _to_non_empty_string(state.get("plugin_scope")))


def _is_workflow_interaction_done(state: dict[str, Any]) -> bool:
    entry_points = _to_clean_string_list(state.get("entry_points"))
    core_actions = _to_clean_string_list(state.get("core_actions"))
    return len(entry_points) >= 1 and len(core_actions) >= 2 and bool(_to_non_empty_string(state.get("file_match_mode")))


def _is_workflow_ui_done(state: dict[str, Any]) -> bool:
    return bool(_to_non_empty_string(state.get("layout_template")) and _to_non_empty_string(state.get("visual_style")) and _to_non_empty_string(state.get("responsive_rules")))


def _compute_workflow_stage(state: dict[str, Any], session_state: str) -> Literal["requirements", "interaction", "ui_design", "generate"]:
    if session_state == "packaged":
        return "generate"
    if not _is_workflow_requirements_done(state):
        return "requirements"
    if not _is_workflow_interaction_done(state):
        return "interaction"
    if not _is_workflow_ui_done(state):
        return "ui_design"
    # "生成插件" 阶段包含发布前与发布后，因此 UI 设计完成后进入 generate。
    return "generate"


def _sync_workflow_fields(session_payload: dict[str, Any]) -> None:
    normalized_state = _normalize_workflow_state(session_payload.get("workflow_state"))
    session_payload["workflow_state"] = normalized_state
    session_payload["match_rules"] = _normalize_match_rules(session_payload.get("match_rules"))
    computed_stage = _compute_workflow_stage(normalized_state, str(session_payload.get("state") or "draft"))
    session_payload["workflow_stage"] = computed_stage


def _safe_relative_material_path(name: str) -> str:
    normalized = name.replace("\\", "/").strip().lstrip("/")
    if not normalized:
        raise HTTPException(status_code=422, detail={"stage": "test_materials", "message": "Material path is empty"})
    parts = [part for part in normalized.split("/") if part and part != "."]
    if not parts or any(part == ".." for part in parts):
        raise HTTPException(status_code=422, detail={"stage": "test_materials", "message": f"Unsafe material path: {name}"})
    return "/".join(parts)


def _plugin_studio_test_materials_virtual_root(session_id: str) -> str:
    # Keep test materials visible in workspace tree for easier debugging.
    return _PLUGIN_STUDIO_WORKSPACE_TEST_ROOT


def _normalize_material_relative_path(name: str) -> str:
    relative = _safe_relative_material_path(name)
    if relative == "fixtures":
        return ""
    prefix = "fixtures/"
    if relative.startswith(prefix):
        return relative[len(prefix) :]
    return relative


def _build_targets_from_match_rules(match_rules: dict[str, Any]) -> list[dict[str, Any]]:
    normalized = _normalize_match_rules(match_rules)
    if normalized.get("allowAll"):
        # "全部内容"：允许文件与目录都进入候选列表，便于右键菜单完整展示。
        return [{"kind": "file", "priority": 85}, {"kind": "directory", "priority": 85}]

    target: dict[str, Any] = {
        "kind": normalized.get("kind") or "file",
        "priority": 85,
    }
    if normalized.get("extensions"):
        target["extensions"] = normalized["extensions"]
    if normalized.get("pathPattern"):
        target["pathPattern"] = normalized["pathPattern"]
    if normalized.get("projectMarkers"):
        target["projectMarkers"] = normalized["projectMarkers"]

    # 至少要有一个可用目标规则，避免空规则导致无法匹配。
    if target["kind"] == "file" and not target.get("extensions") and not target.get("pathPattern") and not target.get("projectMarkers"):
        return [{"kind": "file", "priority": 85}]
    return [target]


def _match_rules_from_manifest(manifest_payload: dict[str, Any]) -> dict[str, Any]:
    targets = manifest_payload.get("targets")
    if not isinstance(targets, list) or len(targets) == 0:
        return _normalize_match_rules({})
    first = targets[0] if isinstance(targets[0], dict) else {}
    kind = _to_non_empty_string(first.get("kind")).lower() or "file"
    extensions = _to_clean_string_list(first.get("extensions"))
    path_pattern = _to_non_empty_string(first.get("pathPattern"))
    project_markers = _to_clean_string_list(first.get("projectMarkers"))
    allow_all = kind == "file" and not extensions and not path_pattern and not project_markers
    return _normalize_match_rules(
        {
            "allowAll": allow_all,
            "kind": kind,
            "extensions": extensions,
            "pathPattern": path_pattern,
            "projectMarkers": project_markers,
        }
    )


def _collect_test_material_records(
    *,
    root_dir: Path,
    root_virtual_path: str,
    source_map: dict[str, str],
) -> list[dict[str, str]]:
    file_entries: list[dict[str, str]] = []
    directory_sources: dict[str, set[str]] = {}

    for file_path in sorted(root_dir.rglob("*")):
        if not file_path.is_file():
            continue
        relative = file_path.relative_to(root_dir).as_posix()
        virtual_path = f"{root_virtual_path}/{relative}"
        source = source_map.get(relative, "upload")
        file_entries.append(
            {
                "path": virtual_path,
                "kind": "file",
                "source": source if source in {"upload", "zip"} else "upload",
            }
        )
        parts = relative.split("/")
        if len(parts) > 1:
            for idx in range(1, len(parts)):
                dir_key = "/".join(parts[:idx])
                source_set = directory_sources.setdefault(dir_key, set())
                source_set.add(source)

    directory_entries: list[dict[str, str]] = []
    for relative_dir in sorted(directory_sources.keys()):
        source_set = directory_sources[relative_dir]
        source = "zip" if "zip" in source_set else "upload"
        directory_entries.append(
            {
                "path": f"{root_virtual_path}/{relative_dir}",
                "kind": "directory",
                "source": source,
            }
        )

    return [*directory_entries, *file_entries]


def _import_plugin_studio_test_materials(
    *,
    session_payload: dict[str, Any],
    payload: PluginStudioTestMaterialImportRequest,
    thread_id: str | None = None,
) -> None:
    session_id = str(session_payload["session_id"])
    root_virtual = _plugin_studio_test_materials_virtual_root(session_id)
    resolved_thread_id = (
        _to_non_empty_string(thread_id)
        or _to_non_empty_string(payload.thread_id)
        or _to_non_empty_string(
            session_payload.get("preview_thread_id"),
        )
    )
    if not resolved_thread_id:
        raise HTTPException(
            status_code=422,
            detail={"stage": "test_materials", "message": "Missing preview thread id"},
        )
    root_dir = resolve_thread_virtual_path(resolved_thread_id.strip(), root_virtual)
    root_dir.mkdir(parents=True, exist_ok=True)

    existing_source_map: dict[str, str] = {}
    existing_materials = session_payload.get("test_materials")
    if isinstance(existing_materials, list):
        for item in existing_materials:
            if not isinstance(item, dict):
                continue
            if item.get("kind") != "file":
                continue
            path = _to_non_empty_string(item.get("path"))
            source = _to_non_empty_string(item.get("source")) or "upload"
            prefix = f"{root_virtual}/"
            if path.startswith(prefix):
                relative = path[len(prefix) :]
                if relative:
                    existing_source_map[relative] = source

    for entry in payload.entries:
        relative_path = _normalize_material_relative_path(entry.path)
        if not relative_path:
            continue
        target = (root_dir / relative_path).resolve()
        try:
            target.relative_to(root_dir.resolve())
        except ValueError as exc:
            raise HTTPException(
                status_code=422,
                detail={"stage": "test_materials", "message": f"Unsafe target path: {entry.path}"},
            ) from exc
        try:
            decoded = base64.b64decode(entry.content_base64, validate=True)
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(
                status_code=422,
                detail={"stage": "test_materials", "message": f"Invalid base64 content for {entry.path}"},
            ) from exc
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(decoded)
        existing_source_map[relative_path] = entry.source

    records = _collect_test_material_records(
        root_dir=root_dir,
        root_virtual_path=root_virtual,
        source_map=existing_source_map,
    )
    session_payload["test_materials"] = records

    selected_relative = _to_non_empty_string(payload.selected_path)
    if selected_relative:
        safe_selected = _normalize_material_relative_path(selected_relative)
        if not safe_selected:
            session_payload["selected_test_material_path"] = ""
            return
        session_payload["selected_test_material_path"] = f"{root_virtual}/{safe_selected}"
    elif not _to_non_empty_string(session_payload.get("selected_test_material_path")):
        first_file = next((item for item in records if item.get("kind") == "file"), None)
        session_payload["selected_test_material_path"] = first_file.get("path") if first_file else ""


def _delete_plugin_studio_test_material(
    *,
    session_payload: dict[str, Any],
    payload: PluginStudioTestMaterialDeleteRequest,
    thread_id: str | None = None,
) -> None:
    session_id = str(session_payload["session_id"])
    root_virtual = _plugin_studio_test_materials_virtual_root(session_id)
    resolved_thread_id = (
        _to_non_empty_string(thread_id)
        or _to_non_empty_string(payload.thread_id)
        or _to_non_empty_string(
            session_payload.get("preview_thread_id"),
        )
    )
    if not resolved_thread_id:
        raise HTTPException(
            status_code=422,
            detail={"stage": "test_materials", "message": "Missing preview thread id"},
        )
    root_dir = resolve_thread_virtual_path(resolved_thread_id.strip(), root_virtual)
    root_dir.mkdir(parents=True, exist_ok=True)

    target_path = _to_non_empty_string(payload.path)
    prefix = f"{root_virtual}/"
    if target_path.startswith(prefix):
        relative = target_path[len(prefix) :]
    else:
        relative = _safe_relative_material_path(target_path)
    relative = _safe_relative_material_path(relative)
    candidate = (root_dir / relative).resolve()
    try:
        candidate.relative_to(root_dir.resolve())
    except ValueError as exc:
        raise HTTPException(
            status_code=422,
            detail={"stage": "test_materials", "message": f"Unsafe material path: {payload.path}"},
        ) from exc
    if candidate.is_file():
        candidate.unlink()
    elif candidate.is_dir():
        shutil.rmtree(candidate, ignore_errors=True)
    else:
        raise HTTPException(
            status_code=404,
            detail={"stage": "test_materials", "message": "Test material not found"},
        )

    source_map: dict[str, str] = {}
    raw_test_materials = session_payload.get("test_materials")
    if isinstance(raw_test_materials, list):
        for item in raw_test_materials:
            if not isinstance(item, dict):
                continue
            if item.get("kind") != "file":
                continue
            file_path = _to_non_empty_string(item.get("path"))
            source = _to_non_empty_string(item.get("source")) or "upload"
            if file_path.startswith(prefix):
                rel = file_path[len(prefix) :]
                if rel and rel != relative:
                    source_map[rel] = source

    records = _collect_test_material_records(
        root_dir=root_dir,
        root_virtual_path=root_virtual,
        source_map=source_map,
    )
    session_payload["test_materials"] = records
    selected_path = _to_non_empty_string(session_payload.get("selected_test_material_path"))
    if not selected_path or selected_path == f"{root_virtual}/{relative}" or not any(item.get("path") == selected_path for item in records):
        first_file = next((item for item in records if item.get("kind") == "file"), None)
        session_payload["selected_test_material_path"] = first_file.get("path") if first_file else ""


def _plugin_studio_scaffold_dir(session_id: str) -> Path:
    return _plugin_studio_session_dir(session_id) / "plugin-src"


def _plugin_studio_workspace_source_dir(thread_id: str) -> Path:
    return resolve_thread_virtual_path(thread_id, _PLUGIN_STUDIO_WORKSPACE_SOURCE_ROOT)


def _plugin_studio_package_dir(session_id: str) -> Path:
    directory = _plugin_studio_session_dir(session_id) / "dist"
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _reset_directory(path: Path) -> None:
    if path.exists():
        if path.is_dir():
            shutil.rmtree(path, ignore_errors=True)
        else:
            path.unlink()
    path.mkdir(parents=True, exist_ok=True)


def _copy_directory_contents(source_dir: Path, target_dir: Path) -> None:
    _reset_directory(target_dir)
    for source_file in sorted(source_dir.rglob("*")):
        if not source_file.is_file():
            continue
        relative = source_file.relative_to(source_dir)
        target_file = (target_dir / relative).resolve()
        try:
            target_file.relative_to(target_dir.resolve())
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=f"Unsafe target path during copy: {relative.as_posix()}") from exc
        target_file.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source_file, target_file)


def _load_plugin_studio_manifest_from_source_dir(source_dir: Path) -> dict[str, Any]:
    manifest_file = source_dir / "manifest.json"
    if not manifest_file.exists() or not manifest_file.is_file():
        raise HTTPException(status_code=409, detail="Plugin source missing manifest.json")
    try:
        payload = json.loads(manifest_file.read_text(encoding="utf-8"))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=409, detail=f"manifest parse failed: {exc}") from exc
    if not isinstance(payload, dict):
        raise HTTPException(status_code=409, detail="manifest payload is invalid")
    return payload


def _sync_plugin_studio_session_metadata_from_source_dir(
    session_payload: dict[str, Any],
    *,
    source_dir: Path,
) -> None:
    manifest_payload = _load_plugin_studio_manifest_from_source_dir(source_dir)

    linked_plugin_id = _safe_plugin_id(str(session_payload.get("linked_plugin_id") or session_payload.get("plugin_id") or manifest_payload.get("id") or session_payload.get("plugin_name") or "plugin"))
    plugin_name = _to_non_empty_string(manifest_payload.get("name")) or _to_non_empty_string(session_payload.get("plugin_name")) or linked_plugin_id
    description = _to_non_empty_string(manifest_payload.get("description")) or _to_non_empty_string(session_payload.get("description"))
    version = _normalize_semver(
        _to_non_empty_string(manifest_payload.get("version")) or str(session_payload.get("current_version") or "0.1.0"),
    )
    match_rules = _match_rules_from_manifest(manifest_payload)

    manifest_payload["id"] = linked_plugin_id
    manifest_payload["name"] = plugin_name
    manifest_payload["version"] = version
    manifest_payload["description"] = description
    if not isinstance(manifest_payload.get("ui"), dict):
        manifest_payload["ui"] = {}
    manifest_payload["ui"]["surface"] = "sidebar-slot"
    raw_initial_width = manifest_payload["ui"].get("initialWidthPercent")
    if not isinstance(raw_initial_width, (int, float)) or raw_initial_width < 10 or raw_initial_width > 90:
        manifest_payload["ui"]["initialWidthPercent"] = 60

    (source_dir / "manifest.json").write_text(
        json.dumps(manifest_payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    workflow_state = _normalize_workflow_state(session_payload.get("workflow_state"))
    if not workflow_state.get("goal"):
        workflow_state["goal"] = description
    if not workflow_state.get("plugin_scope"):
        workflow_state["plugin_scope"] = plugin_name
    if not workflow_state.get("entry_points"):
        targets = manifest_payload.get("targets")
        if isinstance(targets, list):
            workflow_state["entry_points"] = [_to_non_empty_string(item.get("kind")) for item in targets if isinstance(item, dict) and _to_non_empty_string(item.get("kind"))][:3]
    if not workflow_state.get("core_actions"):
        capabilities = manifest_payload.get("capabilities")
        if isinstance(capabilities, list):
            workflow_state["core_actions"] = [_to_non_empty_string(item) for item in capabilities if _to_non_empty_string(item)][:3]
    workflow_state["file_match_mode"] = "all_files" if match_rules.get("allowAll") else str(match_rules.get("kind") or "file")

    session_payload["plugin_id"] = linked_plugin_id
    session_payload["linked_plugin_id"] = linked_plugin_id
    session_payload["plugin_name"] = plugin_name
    session_payload["description"] = description
    session_payload["current_version"] = version
    session_payload["draft_version"] = _increment_patch(version)
    session_payload["match_rules"] = match_rules
    session_payload["workflow_state"] = workflow_state
    session_payload["workflow_stage"] = _compute_workflow_stage(workflow_state, "generated")
    session_payload["state"] = "generated"
    session_payload["auto_verified"] = False
    session_payload["manual_verified"] = False
    session_payload["package_rel_path"] = ""
    session_payload["source_mode"] = "imported" if str(session_payload.get("source_mode") or "") == "imported" else "scratch"


def _copy_plugin_studio_test_materials_to_thread_workspace(
    *,
    session_payload: dict[str, Any],
    thread_id: str,
) -> None:
    target_root = resolve_thread_virtual_path(thread_id, _PLUGIN_STUDIO_WORKSPACE_TEST_ROOT)
    _reset_directory(target_root)

    preview_thread_id = _to_non_empty_string(session_payload.get("preview_thread_id"))
    if not preview_thread_id:
        return

    raw_test_materials = session_payload.get("test_materials")
    if not isinstance(raw_test_materials, list):
        return

    for item in raw_test_materials:
        if not isinstance(item, dict) or _to_non_empty_string(item.get("kind")) != "file":
            continue
        relative = _fixture_relative_from_virtual(_to_non_empty_string(item.get("path")))
        if not relative:
            continue
        source_virtual_path = f"/mnt/user-data/workspace/{relative}"
        source_file = resolve_thread_virtual_path(preview_thread_id, source_virtual_path)
        if not source_file.exists() or not source_file.is_file():
            continue
        safe_relative = _normalize_material_relative_path(relative)
        if not safe_relative:
            continue
        target_file = (target_root / safe_relative).resolve()
        try:
            target_file.relative_to(target_root.resolve())
        except ValueError:
            continue
        target_file.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source_file, target_file)


def _read_plugin_studio_source_package(
    session_id: str,
) -> PluginStudioSourcePackageResponse:
    source_dir = _plugin_studio_scaffold_dir(session_id)
    if not source_dir.exists() or not source_dir.is_dir():
        raise HTTPException(status_code=404, detail="Plugin source directory not found")

    manifest_payload = _load_plugin_studio_manifest_from_source_dir(source_dir)
    files: dict[str, PluginStudioSourceFileResponse] = {}
    for file_path in sorted(source_dir.rglob("*")):
        if not file_path.is_file():
            continue
        relative = file_path.relative_to(source_dir).as_posix()
        suffix = file_path.suffix.lower()
        if suffix in _TEXT_FILE_EXTENSIONS:
            try:
                files[relative] = PluginStudioSourceFileResponse(
                    encoding="text",
                    content=file_path.read_text(encoding="utf-8"),
                )
                continue
            except UnicodeDecodeError:
                pass
        files[relative] = PluginStudioSourceFileResponse(
            encoding="base64",
            content=base64.b64encode(file_path.read_bytes()).decode("ascii"),
        )
    return PluginStudioSourcePackageResponse(
        session_id=session_id,
        manifest=manifest_payload,
        files=files,
    )


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


def _plugin_studio_response(payload: dict[str, Any]) -> PluginStudioSessionResponse:
    session_id = str(payload.get("session_id", ""))
    plugin_id = str(payload.get("plugin_id", ""))
    readme_rel = str(payload.get("readme_rel_path") or "").strip()
    demo_rel_list = payload.get("demo_rel_paths")
    demo_rel_paths = demo_rel_list if isinstance(demo_rel_list, list) else []
    package_rel = str(payload.get("package_rel_path") or "").strip()
    readme_url = f"/api/workbench/plugin-studio/sessions/{session_id}/readme" if readme_rel else None
    demo_urls = [f"/api/workbench/plugin-studio/sessions/{session_id}/assets/{quote(str(rel).lstrip('/'))}" for rel in demo_rel_paths if str(rel).strip()]
    package_download_url = None
    if package_rel:
        package_download_url = f"/api/workbench/plugin-studio/sessions/{session_id}/package/download"
    source_mode = str(payload.get("source_mode") or "scratch")
    if source_mode not in {"scratch", "imported"}:
        source_mode = "scratch"
    workflow_stage = _to_non_empty_string(payload.get("workflow_stage"))
    if workflow_stage not in {"requirements", "interaction", "ui_design", "generate"}:
        workflow_stage = _compute_workflow_stage(
            _normalize_workflow_state(payload.get("workflow_state")),
            str(payload.get("state") or "draft"),
        )
    workflow_state = _normalize_workflow_state(payload.get("workflow_state"))
    draft_version = _normalize_semver(
        _to_non_empty_string(payload.get("draft_version")) or str(payload.get("current_version") or "0.1.0"),
        fallback=_normalize_semver(str(payload.get("current_version") or "0.1.0")),
    )
    match_rules = _normalize_match_rules(payload.get("match_rules"))
    raw_test_materials = payload.get("test_materials")
    test_materials = []
    if isinstance(raw_test_materials, list):
        for item in raw_test_materials:
            if not isinstance(item, dict):
                continue
            path = _to_non_empty_string(item.get("path"))
            kind = _to_non_empty_string(item.get("kind")) or "file"
            source = _to_non_empty_string(item.get("source")) or "upload"
            if not path:
                continue
            test_materials.append(
                {
                    "path": path,
                    "kind": kind if kind in {"file", "directory"} else "file",
                    "source": source if source in {"upload", "zip"} else "upload",
                }
            )

    return PluginStudioSessionResponse(
        session_id=session_id,
        plugin_id=plugin_id,
        plugin_name=str(payload.get("plugin_name", plugin_id)),
        chat_thread_id=str(payload.get("chat_thread_id") or "") or None,
        preview_thread_id=_to_non_empty_string(payload.get("preview_thread_id")) or None,
        description=str(payload.get("description", "")),
        state=str(payload.get("state", "draft")),  # type: ignore[arg-type]
        auto_verified=bool(payload.get("auto_verified", False)),
        manual_verified=bool(payload.get("manual_verified", False)),
        current_version=_normalize_semver(str(payload.get("current_version") or "0.1.0")),
        release_notes=str(payload.get("release_notes") or "") or None,
        source_mode=source_mode,  # type: ignore[arg-type]
        linked_plugin_id=str(payload.get("linked_plugin_id") or "") or None,
        published_at=str(payload.get("published_at") or "") or None,
        created_at=str(payload.get("created_at", _utcnow_iso())),
        updated_at=str(payload.get("updated_at", _utcnow_iso())),
        readme_url=readme_url,
        demo_image_urls=demo_urls,
        package_download_url=package_download_url,
        workflow_stage=workflow_stage,  # type: ignore[arg-type]
        workflow_state=workflow_state,
        draft_version=draft_version,
        match_rules=match_rules,
        test_materials=test_materials,
        selected_test_material_path=_to_non_empty_string(payload.get("selected_test_material_path")) or None,
    )


def _render_plugin_studio_scaffold(session_payload: dict[str, Any]) -> None:
    session_id = str(session_payload["session_id"])
    plugin_id = str(session_payload["plugin_id"])
    plugin_name = str(session_payload["plugin_name"])
    description = str(session_payload.get("description") or "")
    scaffold_dir = _plugin_studio_scaffold_dir(session_id)
    assets_dir = scaffold_dir / "assets"
    docs_demo_dir = scaffold_dir / "docs" / "demo"
    assets_dir.mkdir(parents=True, exist_ok=True)
    docs_demo_dir.mkdir(parents=True, exist_ok=True)

    manifest = {
        "id": plugin_id,
        "name": plugin_name,
        "version": _normalize_semver(str(session_payload.get("current_version") or "0.1.0")),
        "description": description or f"{plugin_name} generated by Plugin Assistant.",
        "entry": "index.html",
        "runtime": "iframe",
        "targets": [{"kind": "file", "priority": 85}],
        "capabilities": ["file.read", "file.write", "dir.list", "toast", "state.persist"],
        "docs": {
            "readme_path": "README.md",
            "demo_images": ["docs/demo/overview.svg"],
        },
        "verification": {"level": "auto_manual"},
        "provenance": {"source": "assistant"},
        "ui": {"surface": "sidebar-slot", "initialWidthPercent": 60},
    }

    (scaffold_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (scaffold_dir / "index.html").write_text(
        """<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Plugin Assistant Scaffold</title>
    <link rel="stylesheet" href="./assets/main.css" />
  </head>
  <body>
    <main class="app">
      <h1 id="title">Plugin Assistant</h1>
      <p id="desc">Generated plugin scaffold is ready.</p>
      <button id="toastBtn" type="button">测试提示</button>
    </main>
    <script src="./assets/main.js"></script>
  </body>
</html>
""",
        encoding="utf-8",
    )
    (assets_dir / "main.css").write_text(
        """:root {
  color-scheme: light dark;
  /* nion-scaffold:theme-ready */
  --wb-bg: #ffffff;
  --wb-text: #1f2937;
  --wb-border: #d1d5db;
  --wb-muted: #6b7280;
  --wb-primary: #2563eb;
}
html, body {
  margin: 0;
  width: 100%;
  height: 100%;
  background: var(--wb-bg);
  color: var(--wb-text);
  font-family: "SF Pro Text", "PingFang SC", "Helvetica Neue", sans-serif;
}
.app {
  display: flex;
  min-height: 100vh;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  box-sizing: border-box;
}
#title {
  margin: 0;
}
#desc {
  margin: 0;
  color: var(--wb-muted);
}
#toastBtn {
  width: fit-content;
  border: 1px solid var(--wb-border);
  border-radius: 10px;
  padding: 8px 12px;
  background: var(--wb-bg);
  color: var(--wb-text);
  cursor: pointer;
}
#toastBtn:hover {
  border-color: var(--wb-primary);
}
/* nion-scaffold:responsive-ready */
@media (max-width: 640px) {
  .app {
    min-height: 100%;
    padding: 12px;
    gap: 10px;
  }
  #toastBtn {
    width: 100%;
  }
}
""",
        encoding="utf-8",
    )
    (assets_dir / "main.js").write_text(
        f"""(function() {{
  const bridge = window.NionWorkbench;
  const title = document.getElementById("title");
  const desc = document.getElementById("desc");
  const btn = document.getElementById("toastBtn");
  const theme = bridge && typeof bridge === "object" ? bridge.theme : null;

  if (theme && typeof theme === "object") {{
    const mode = theme.mode === "dark" ? "dark" : "light";
    document.documentElement.dataset.theme = mode;
    document.documentElement.style.colorScheme = mode;
    const tokens = theme.tokens && typeof theme.tokens === "object" ? theme.tokens : {{}};
    const tokenMap = {{
      "--wb-bg": tokens.background,
      "--wb-text": tokens.foreground,
      "--wb-border": tokens.border,
      "--wb-muted": tokens["muted-foreground"],
      "--wb-primary": tokens.primary,
    }};
    Object.entries(tokenMap).forEach(([key, value]) => {{
      if (typeof value === "string" && value.trim()) {{
        document.documentElement.style.setProperty(key, value.trim());
      }}
    }});
  }}

  if (title) title.textContent = {plugin_name!r};
  if (desc) desc.textContent = {description!r} || "Generated scaffold is responsive and theme-aware by default.";
  if (btn) {{
    btn.addEventListener("click", function() {{
      if (bridge && typeof bridge.call === "function") {{
        bridge.call("toast", {{ message: "插件脚手架运行正常", type: "success" }});
      }}
    }});
  }}
}})();
""",
        encoding="utf-8",
    )
    (scaffold_dir / "README.md").write_text(
        f"""# {plugin_name}

{description or "该插件由插件生成助手自动创建，可在右侧插件插槽中运行。"}

## 使用说明

1. 在插件市场或本地安装 `.nwp` 包。  
2. 在聊天页右侧切换到“操作台”模式。  
3. 选择该插件并开始调试。  

## 发布前硬性检查项

- 必须支持响应式自适应：在窄宽度容器下仍可用。  
- 必须跟随系统主题：light/dark 均保持可读与层级一致。  
- 禁止依赖固定绝对宽高；优先流式布局与断点策略。  

## 验证门禁

- 自动验证：检查 manifest/入口/文档/演示图是否完整。  
- 人工确认：手动体验通过后才能打包下载。  

## 演示图

![插件演示](docs/demo/overview.svg)
""",
        encoding="utf-8",
    )
    (docs_demo_dir / "overview.svg").write_text(
        f"""<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="720" viewBox="0 0 1200 720">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#f6f8ff"/>
      <stop offset="100%" stop-color="#e9eefc"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="720" fill="url(#bg)"/>
  <rect x="80" y="80" width="1040" height="560" rx="20" fill="#ffffff" stroke="#dbe4ff" stroke-width="2"/>
  <text x="130" y="170" font-size="40" fill="#1f2a44" font-family="Arial, sans-serif">{plugin_name}</text>
  <text x="130" y="220" font-size="26" fill="#526085" font-family="Arial, sans-serif">{description or "插件生成助手演示图"}</text>
  <rect x="130" y="280" width="260" height="48" rx="10" fill="#3156d3"/>
  <text x="170" y="312" font-size="22" fill="#ffffff" font-family="Arial, sans-serif">Sidebar Slot Ready</text>
</svg>
""",
        encoding="utf-8",
    )

    session_payload["readme_rel_path"] = "README.md"
    session_payload["demo_rel_paths"] = ["docs/demo/overview.svg"]


def _plugin_studio_step(step_id: str, passed: bool, message: str) -> dict[str, Any]:
    return {"id": step_id, "passed": passed, "message": message}


def _refresh_plugin_studio_artifact_refs(session_payload: dict[str, Any]) -> None:
    session_id = str(session_payload["session_id"])
    source_dir = _plugin_studio_scaffold_dir(session_id)
    readme_file = source_dir / "README.md"
    session_payload["readme_rel_path"] = "README.md" if readme_file.exists() else ""
    demo_paths = sorted(file_path.relative_to(source_dir).as_posix() for file_path in source_dir.glob("docs/demo/*") if file_path.is_file())
    session_payload["demo_rel_paths"] = demo_paths


def _run_plugin_studio_auto_verify(session_payload: dict[str, Any]) -> tuple[bool, list[dict[str, Any]]]:
    session_id = str(session_payload["session_id"])
    source_dir = _plugin_studio_scaffold_dir(session_id)
    manifest_file = source_dir / "manifest.json"
    steps: list[dict[str, Any]] = [
        _plugin_studio_step("source_exists", source_dir.exists() and source_dir.is_dir(), "plugin source directory exists"),
        _plugin_studio_step("manifest_exists", manifest_file.exists(), "manifest.json exists"),
    ]
    if not manifest_file.exists():
        return False, steps

    manifest_payload: dict[str, Any] = {}
    try:
        loaded_payload = json.loads(manifest_file.read_text(encoding="utf-8"))
        manifest_payload = loaded_payload if isinstance(loaded_payload, dict) else {}
    except Exception as exc:
        steps.append(_plugin_studio_step("manifest_parse", False, f"manifest parse failed: {exc}"))
        return False, steps

    entry_name = str(manifest_payload.get("entry") or "").strip()
    runtime = str(manifest_payload.get("runtime") or "").strip()
    manifest_version = str(manifest_payload.get("version") or "").strip()
    entry_file = source_dir / entry_name if entry_name else source_dir / "index.html"
    steps.append(_plugin_studio_step("entry_declared", bool(entry_name), "manifest.entry declared"))
    steps.append(_plugin_studio_step("entry_exists", entry_file.exists(), f"entry file exists: {entry_name or 'index.html'}"))
    steps.append(_plugin_studio_step("runtime_valid", runtime == "iframe", "manifest.runtime is iframe"))
    steps.append(_plugin_studio_step("version_valid", _parse_semver(manifest_version) is not None, "manifest.version is semver"))
    steps.append(
        _plugin_studio_step(
            "plugin_id_match",
            str(manifest_payload.get("id") or "").strip() == str(session_payload.get("plugin_id") or "").strip(),
            "manifest.id matches session plugin id",
        ),
    )

    docs_payload = manifest_payload.get("docs") if isinstance(manifest_payload.get("docs"), dict) else {}
    readme_file = source_dir / str(docs_payload.get("readme_path") or "README.md")
    steps.append(_plugin_studio_step("readme_exists", readme_file.exists(), "README file exists"))

    demo_images = []
    docs_config = docs_payload
    if isinstance(docs_config, dict) and isinstance(docs_config.get("demo_images"), list):
        demo_images = [str(item).strip() for item in docs_config.get("demo_images", []) if str(item).strip()]
    if demo_images:
        all_demo_exists = True
        for demo_path in demo_images:
            demo_file = source_dir / demo_path
            exists = demo_file.exists() and demo_file.is_file()
            all_demo_exists = all_demo_exists and exists
            steps.append(_plugin_studio_step(f"demo:{demo_path}", exists, f"demo image exists: {demo_path}"))
        steps.append(_plugin_studio_step("demo_images_valid", all_demo_exists, "manifest demo images exist"))
    else:
        steps.append(_plugin_studio_step("demo_images_optional", True, "no demo image declared"))

    passed = all(bool(item["passed"]) for item in steps)
    return passed, steps


def _build_plugin_studio_package(session_payload: dict[str, Any]) -> Path:
    session_id = str(session_payload["session_id"])
    plugin_id = str(session_payload["plugin_id"])
    source_dir = _plugin_studio_scaffold_dir(session_id)
    if not source_dir.exists() or not source_dir.is_dir():
        raise HTTPException(status_code=409, detail="Plugin source is missing, run generate first")

    package_dir = _plugin_studio_package_dir(session_id)
    package_path = package_dir / f"{plugin_id}.nwp"
    with zipfile.ZipFile(package_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        for file_path in source_dir.rglob("*"):
            if not file_path.is_file():
                continue
            arcname = file_path.relative_to(source_dir).as_posix()
            zf.write(file_path, arcname=arcname)
    return package_path


def _safe_zip_member_path(name: str) -> str | None:
    normalized = name.replace("\\", "/").strip()
    if not normalized or normalized.endswith("/"):
        return None
    normalized = normalized.lstrip("/")
    if not normalized:
        return None
    parts = [part for part in normalized.split("/") if part and part != "."]
    if not parts:
        return None
    if any(part == ".." for part in parts):
        raise HTTPException(status_code=400, detail=f"Unsafe path in package: {name}")
    return "/".join(parts)


def _collect_fixture_entries_from_scaffold(
    *,
    source_dir: Path,
    fixture_specs: list[str],
) -> tuple[list[dict[str, Any]], str | None]:
    entries: list[dict[str, Any]] = []
    seen_paths: set[str] = set()
    selected_path: str | None = None

    for raw_fixture in fixture_specs:
        try:
            safe_fixture = _safe_relative_material_path(raw_fixture)
        except HTTPException:
            continue
        candidate = (source_dir / safe_fixture).resolve()
        try:
            candidate.relative_to(source_dir.resolve())
        except ValueError:
            continue
        if not candidate.exists():
            continue

        if candidate.is_file():
            if safe_fixture not in seen_paths:
                entries.append(
                    {
                        "path": safe_fixture,
                        "source": "zip",
                        "content": candidate.read_bytes(),
                    }
                )
                seen_paths.add(safe_fixture)
            if selected_path is None:
                selected_path = safe_fixture
            continue

        if not candidate.is_dir():
            continue

        relative_files: list[str] = []
        for nested_file in sorted(candidate.rglob("*")):
            if not nested_file.is_file():
                continue
            nested_relative = f"{safe_fixture}/{nested_file.relative_to(candidate).as_posix()}"
            if nested_relative in seen_paths:
                continue
            entries.append(
                {
                    "path": nested_relative,
                    "source": "zip",
                    "content": nested_file.read_bytes(),
                }
            )
            seen_paths.add(nested_relative)
            relative_files.append(nested_relative)
        if selected_path is None and relative_files:
            selected_path = safe_fixture

    return entries, selected_path


def _fixture_relative_from_virtual(path_value: str) -> str | None:
    normalized = _to_non_empty_string(path_value)
    if not normalized:
        return None
    prefix = "/mnt/user-data/workspace/"
    if normalized.startswith(prefix):
        relative = normalized[len(prefix) :]
    elif normalized.startswith("/mnt/user-data/workspace"):
        relative = normalized.replace("/mnt/user-data/workspace", "", 1).lstrip("/")
    else:
        relative = normalized.lstrip("/")
    if not relative:
        return None
    try:
        safe_relative = _safe_relative_material_path(relative)
    except HTTPException:
        return None
    if not safe_relative.startswith("fixtures/"):
        return None
    return safe_relative


def _sync_session_fixtures_into_scaffold(session_payload: dict[str, Any], source_dir: Path) -> list[str]:
    preview_thread_id = _to_non_empty_string(session_payload.get("preview_thread_id"))
    if not preview_thread_id:
        return []

    material_files: list[str] = []
    raw_materials = session_payload.get("test_materials")
    if isinstance(raw_materials, list):
        for item in raw_materials:
            if not isinstance(item, dict):
                continue
            if _to_non_empty_string(item.get("kind")) != "file":
                continue
            relative = _fixture_relative_from_virtual(_to_non_empty_string(item.get("path")))
            if relative:
                material_files.append(relative)

    if not material_files:
        return []

    deduped_files: list[str] = []
    seen_files: set[str] = set()
    for relative in material_files:
        if relative in seen_files:
            continue
        seen_files.add(relative)
        deduped_files.append(relative)

    packaged_files: list[str] = []
    for relative in deduped_files:
        source_virtual_path = f"/mnt/user-data/workspace/{relative}"
        source_file = resolve_thread_virtual_path(preview_thread_id, source_virtual_path)
        if not source_file.exists() or not source_file.is_file():
            continue
        target_file = (source_dir / relative).resolve()
        try:
            target_file.relative_to(source_dir.resolve())
        except ValueError:
            continue
        target_file.parent.mkdir(parents=True, exist_ok=True)
        target_file.write_bytes(source_file.read_bytes())
        packaged_files.append(relative)

    selected_path = _fixture_relative_from_virtual(_to_non_empty_string(session_payload.get("selected_test_material_path")))
    ordered: list[str] = []
    if selected_path:
        ordered.append(selected_path)
    for relative in packaged_files:
        if relative not in ordered:
            ordered.append(relative)
    return ordered


def _import_plugin_studio_source(
    session_payload: dict[str, Any],
    payload: PluginStudioImportSourceRequest,
    *,
    preview_thread_id: str,
) -> None:
    session_id = str(session_payload["session_id"])
    source_dir = _plugin_studio_scaffold_dir(session_id)
    if source_dir.exists():
        shutil.rmtree(source_dir, ignore_errors=True)
    source_dir.mkdir(parents=True, exist_ok=True)

    try:
        package_bytes = base64.b64decode(payload.package_base64, validate=True)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid package_base64: {exc}") from exc

    extracted_files = 0
    try:
        with zipfile.ZipFile(io.BytesIO(package_bytes)) as zf:
            for info in zf.infolist():
                if info.is_dir():
                    continue
                relative = _safe_zip_member_path(info.filename)
                if not relative:
                    continue
                target = (source_dir / relative).resolve()
                try:
                    target.relative_to(source_dir)
                except ValueError as exc:
                    raise HTTPException(status_code=400, detail=f"Unsafe package path: {info.filename}") from exc
                target.parent.mkdir(parents=True, exist_ok=True)
                with zf.open(info, "r") as file_handle:
                    target.write_bytes(file_handle.read())
                extracted_files += 1
    except zipfile.BadZipFile as exc:
        raise HTTPException(status_code=400, detail=f"Invalid plugin package format: {exc}") from exc

    if extracted_files == 0:
        raise HTTPException(status_code=400, detail="Imported package is empty")

    manifest_file = source_dir / "manifest.json"
    if not manifest_file.exists():
        raise HTTPException(status_code=400, detail="Imported package missing manifest.json")

    try:
        manifest_payload = json.loads(manifest_file.read_text(encoding="utf-8"))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Imported manifest is invalid: {exc}") from exc
    if not isinstance(manifest_payload, dict):
        raise HTTPException(status_code=400, detail="Imported manifest payload is invalid")

    linked_plugin_id = _safe_plugin_id(payload.linked_plugin_id or str(session_payload.get("plugin_id") or manifest_payload.get("id") or session_payload.get("plugin_name") or "plugin"))
    plugin_name = (payload.plugin_name or str(manifest_payload.get("name") or session_payload.get("plugin_name") or linked_plugin_id)).strip()
    description = (payload.description if payload.description is not None else str(manifest_payload.get("description") or session_payload.get("description") or "")).strip()
    version = _normalize_semver(str(manifest_payload.get("version") or session_payload.get("current_version") or "0.1.0"))
    match_rules = _match_rules_from_manifest(manifest_payload)

    manifest_payload["id"] = linked_plugin_id
    manifest_payload["name"] = plugin_name
    manifest_payload["version"] = version
    manifest_payload["description"] = description
    if not isinstance(manifest_payload.get("ui"), dict):
        manifest_payload["ui"] = {}
    manifest_payload["ui"]["surface"] = "sidebar-slot"
    raw_initial_width = manifest_payload["ui"].get("initialWidthPercent")
    if not isinstance(raw_initial_width, (int, float)) or raw_initial_width < 10 or raw_initial_width > 90:
        manifest_payload["ui"]["initialWidthPercent"] = 60
    manifest_file.write_text(json.dumps(manifest_payload, ensure_ascii=False, indent=2), encoding="utf-8")

    workflow_state = _normalize_workflow_state(session_payload.get("workflow_state"))
    if not workflow_state.get("goal"):
        workflow_state["goal"] = description
    if not workflow_state.get("plugin_scope"):
        workflow_state["plugin_scope"] = plugin_name
    if not workflow_state.get("entry_points"):
        targets = manifest_payload.get("targets")
        if isinstance(targets, list):
            workflow_state["entry_points"] = [_to_non_empty_string(item.get("kind")) for item in targets if isinstance(item, dict) and _to_non_empty_string(item.get("kind"))][:3]
    if not workflow_state.get("core_actions"):
        capabilities = manifest_payload.get("capabilities")
        if isinstance(capabilities, list):
            workflow_state["core_actions"] = [_to_non_empty_string(item) for item in capabilities if _to_non_empty_string(item)][:3]
    workflow_state["file_match_mode"] = "all_files" if match_rules.get("allowAll") else str(match_rules.get("kind") or "file")

    session_payload["plugin_id"] = linked_plugin_id
    session_payload["plugin_name"] = plugin_name
    session_payload["description"] = description
    session_payload["current_version"] = version
    session_payload["draft_version"] = _increment_patch(version)
    session_payload["source_mode"] = "imported"
    session_payload["linked_plugin_id"] = linked_plugin_id
    session_payload["state"] = "generated"
    session_payload["auto_verified"] = False
    session_payload["manual_verified"] = False
    session_payload["package_rel_path"] = ""
    session_payload["release_notes"] = ""
    session_payload["published_at"] = ""
    session_payload["match_rules"] = match_rules
    session_payload["workflow_state"] = workflow_state
    session_payload["workflow_stage"] = "requirements"
    session_payload["preview_thread_id"] = preview_thread_id

    fixture_specs = [_to_non_empty_string(item) for item in (manifest_payload.get("fixtures") if isinstance(manifest_payload.get("fixtures"), list) else []) if _to_non_empty_string(item)]
    if fixture_specs:
        fixture_entries, selected_fixture_path = _collect_fixture_entries_from_scaffold(
            source_dir=source_dir,
            fixture_specs=fixture_specs,
        )
        if fixture_entries:
            root_virtual = _plugin_studio_test_materials_virtual_root(session_id)
            root_dir = resolve_thread_virtual_path(preview_thread_id, root_virtual)
            root_dir.mkdir(parents=True, exist_ok=True)
            existing_source_map: dict[str, str] = {}
            existing_materials = session_payload.get("test_materials")
            if isinstance(existing_materials, list):
                for item in existing_materials:
                    if not isinstance(item, dict):
                        continue
                    if item.get("kind") != "file":
                        continue
                    path = _to_non_empty_string(item.get("path"))
                    source = _to_non_empty_string(item.get("source")) or "upload"
                    prefix = f"{root_virtual}/"
                    if path.startswith(prefix):
                        relative = path[len(prefix) :]
                        if relative:
                            existing_source_map[relative] = source

            for entry in fixture_entries:
                relative_path = _normalize_material_relative_path(str(entry["path"]))
                if not relative_path:
                    continue
                target = (root_dir / relative_path).resolve()
                try:
                    target.relative_to(root_dir.resolve())
                except ValueError as exc:
                    raise HTTPException(
                        status_code=422,
                        detail={"stage": "test_materials", "message": f"Unsafe target path: {entry['path']}"},
                    ) from exc
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(entry["content"])
                existing_source_map[relative_path] = "zip"

            records = _collect_test_material_records(
                root_dir=root_dir,
                root_virtual_path=root_virtual,
                source_map=existing_source_map,
            )
            session_payload["test_materials"] = records
            if selected_fixture_path:
                safe_selected = _normalize_material_relative_path(selected_fixture_path)
                if safe_selected:
                    session_payload["selected_test_material_path"] = f"{root_virtual}/{safe_selected}"
            elif not _to_non_empty_string(session_payload.get("selected_test_material_path")):
                first_file = next((item for item in records if item.get("kind") == "file"), None)
                session_payload["selected_test_material_path"] = first_file.get("path") if first_file else ""

    _refresh_plugin_studio_artifact_refs(session_payload)


def _apply_plugin_studio_publish_changes(
    session_payload: dict[str, Any],
    payload: PluginStudioPublishRequest,
) -> None:
    session_id = str(session_payload["session_id"])
    source_dir = _plugin_studio_scaffold_dir(session_id)
    if not source_dir.exists() or not source_dir.is_dir():
        _render_plugin_studio_scaffold(session_payload)

    manifest_file = source_dir / "manifest.json"
    if not manifest_file.exists():
        raise HTTPException(status_code=409, detail={"stage": "generate", "message": "Plugin source missing manifest.json"})

    try:
        loaded_manifest = json.loads(manifest_file.read_text(encoding="utf-8"))
    except Exception as exc:
        raise HTTPException(status_code=409, detail={"stage": "generate", "message": f"manifest parse failed: {exc}"}) from exc
    manifest_payload = loaded_manifest if isinstance(loaded_manifest, dict) else {}

    version = _normalize_semver(payload.version)
    plugin_id = str(session_payload["plugin_id"])
    plugin_name = str(session_payload["plugin_name"])
    description = payload.description.strip()

    manifest_payload["id"] = plugin_id
    manifest_payload["name"] = plugin_name
    manifest_payload["version"] = version
    manifest_payload["description"] = description
    manifest_payload["runtime"] = "iframe"
    match_rules = _normalize_match_rules(session_payload.get("match_rules"))
    manifest_payload["targets"] = _build_targets_from_match_rules(match_rules)
    if not isinstance(manifest_payload.get("provenance"), dict):
        manifest_payload["provenance"] = {}
    manifest_payload["provenance"]["source"] = "assistant"
    if not isinstance(manifest_payload.get("verification"), dict):
        manifest_payload["verification"] = {}
    manifest_payload["verification"]["level"] = "auto_manual"
    if not isinstance(manifest_payload.get("ui"), dict):
        manifest_payload["ui"] = {}
    manifest_payload["ui"]["surface"] = "sidebar-slot"
    raw_initial_width = manifest_payload["ui"].get("initialWidthPercent")
    if not isinstance(raw_initial_width, (int, float)) or raw_initial_width < 10 or raw_initial_width > 90:
        manifest_payload["ui"]["initialWidthPercent"] = 60

    fixture_paths = _sync_session_fixtures_into_scaffold(session_payload, source_dir)
    if fixture_paths:
        manifest_payload["fixtures"] = fixture_paths
    else:
        manifest_payload["fixtures"] = []

    if not isinstance(manifest_payload.get("docs"), dict):
        manifest_payload["docs"] = {}
    manifest_payload["docs"]["readme_path"] = str(manifest_payload["docs"].get("readme_path") or "README.md")
    manifest_file.write_text(json.dumps(manifest_payload, ensure_ascii=False, indent=2), encoding="utf-8")

    readme_path = source_dir / str(manifest_payload["docs"]["readme_path"])
    readme_path.parent.mkdir(parents=True, exist_ok=True)
    existing_readme = readme_path.read_text(encoding="utf-8") if readme_path.exists() else f"# {plugin_name}\n\n{description}\n"
    release_marker = f"### v{version} "
    release_block = f"\n\n## 发布记录\n\n### v{version} ({datetime.now(UTC).date().isoformat()})\n\n{payload.release_notes.strip()}\n"
    if "## 发布记录" not in existing_readme:
        updated_readme = existing_readme.rstrip() + release_block
    elif release_marker not in existing_readme:
        updated_readme = existing_readme.rstrip() + f"\n\n### v{version} ({datetime.now(UTC).date().isoformat()})\n\n{payload.release_notes.strip()}\n"
    else:
        updated_readme = existing_readme
    readme_path.write_text(updated_readme.rstrip() + "\n", encoding="utf-8")

    if payload.conversation_snapshot.strip():
        trace_dir = source_dir / ".plugin-assistant"
        trace_dir.mkdir(parents=True, exist_ok=True)
        trace_file = trace_dir / f"conversation-{version}.md"
        trace_file.write_text(payload.conversation_snapshot.strip() + "\n", encoding="utf-8")

    session_payload["description"] = description
    session_payload["release_notes"] = payload.release_notes.strip()
    session_payload["current_version"] = version
    session_payload["draft_version"] = _increment_patch(version)
    session_payload["workflow_stage"] = "generate"
    _refresh_plugin_studio_artifact_refs(session_payload)


@plugin_studio_router.post(
    "/sessions",
    response_model=PluginStudioSessionResponse,
    summary="Create plugin studio session",
)
async def create_plugin_studio_session(payload: PluginStudioSessionCreateRequest) -> PluginStudioSessionResponse:
    with _PLUGIN_STUDIO_LOCK:
        session_id = uuid.uuid4().hex
        plugin_id = _safe_plugin_id(payload.plugin_id or payload.plugin_name)
        now = _utcnow_iso()
        session_payload: dict[str, Any] = {
            "session_id": session_id,
            "plugin_id": plugin_id,
            "plugin_name": payload.plugin_name.strip(),
            "chat_thread_id": (payload.chat_thread_id or "").strip(),
            "preview_thread_id": "",
            "description": payload.description.strip(),
            "state": "draft",
            "auto_verified": False,
            "manual_verified": False,
            "current_version": "0.1.0",
            "release_notes": "",
            "source_mode": "scratch",
            "linked_plugin_id": "",
            "published_at": "",
            "created_at": now,
            "updated_at": now,
            "readme_rel_path": "",
            "demo_rel_paths": [],
            "package_rel_path": "",
            "manual_note": "",
            "workflow_stage": "requirements",
            "workflow_state": {
                **_default_workflow_state(),
                "goal": payload.description.strip(),
                "plugin_scope": payload.plugin_name.strip(),
            },
            "draft_version": "0.1.1",
            "match_rules": _normalize_match_rules({}),
            "test_materials": [],
            "selected_test_material_path": "",
        }
        await _ensure_plugin_studio_preview_thread(session_payload)
        _save_plugin_studio_session(session_id, session_payload)
    return _plugin_studio_response(session_payload)


@plugin_studio_router.get(
    "/sessions/{session_id}",
    response_model=PluginStudioSessionResponse,
    summary="Get plugin studio session",
)
async def get_plugin_studio_session(session_id: str) -> PluginStudioSessionResponse:
    with _PLUGIN_STUDIO_LOCK:
        session_payload = _read_plugin_studio_session(session_id)
        if not _to_non_empty_string(session_payload.get("preview_thread_id")):
            await _ensure_plugin_studio_preview_thread(session_payload)
            _save_plugin_studio_session(session_id, session_payload)
    return _plugin_studio_response(session_payload)


@plugin_studio_router.post(
    "/sessions/{session_id}/generate",
    response_model=PluginStudioSessionResponse,
    summary="Generate plugin scaffold in session",
)
async def generate_plugin_studio_session(
    session_id: str,
    payload: PluginStudioGenerateRequest,
) -> PluginStudioSessionResponse:
    with _PLUGIN_STUDIO_LOCK:
        session_payload = _read_plugin_studio_session(session_id)
        if payload.description is not None:
            session_payload["description"] = payload.description.strip()
        _render_plugin_studio_scaffold(session_payload)
        session_payload["state"] = "generated"
        session_payload["auto_verified"] = False
        session_payload["manual_verified"] = False
        session_payload["source_mode"] = "scratch"
        session_payload["package_rel_path"] = ""
        session_payload["release_notes"] = ""
        session_payload["published_at"] = ""
        session_payload["draft_version"] = _increment_patch(_normalize_semver(str(session_payload.get("current_version") or "0.1.0")))
        workflow_state = _normalize_workflow_state(session_payload.get("workflow_state"))
        if payload.description is not None:
            workflow_state["goal"] = payload.description.strip()
        if not workflow_state.get("plugin_scope"):
            workflow_state["plugin_scope"] = str(session_payload.get("plugin_name") or "")
        session_payload["workflow_state"] = workflow_state
        session_payload["workflow_stage"] = "requirements"
        _refresh_plugin_studio_artifact_refs(session_payload)
        _save_plugin_studio_session(session_id, session_payload)
    return _plugin_studio_response(session_payload)


@plugin_studio_router.post(
    "/sessions/{session_id}/source/import",
    response_model=PluginStudioSessionResponse,
    summary="Import plugin source package into plugin studio session",
)
async def import_plugin_studio_session_source(
    session_id: str,
    payload: PluginStudioImportSourceRequest,
) -> PluginStudioSessionResponse:
    with _PLUGIN_STUDIO_LOCK:
        session_payload = _read_plugin_studio_session(session_id)
        if payload.plugin_name is not None:
            session_payload["plugin_name"] = payload.plugin_name.strip()
        if payload.description is not None:
            session_payload["description"] = payload.description.strip()
        preview_thread_id = await _ensure_plugin_studio_preview_thread(
            session_payload,
            preferred_thread_id=_to_non_empty_string(payload.thread_id),
        )
        _import_plugin_studio_source(
            session_payload,
            payload,
            preview_thread_id=preview_thread_id,
        )
        _save_plugin_studio_session(session_id, session_payload)
    return _plugin_studio_response(session_payload)


@plugin_studio_router.get(
    "/sessions/{session_id}/source/package",
    response_model=PluginStudioSourcePackageResponse,
    summary="Read current plugin studio draft source package",
)
async def read_plugin_studio_source_package(session_id: str) -> PluginStudioSourcePackageResponse:
    _read_plugin_studio_session(session_id)
    return _read_plugin_studio_source_package(session_id)


@plugin_studio_router.post(
    "/sessions/{session_id}/workspace/seed",
    response_model=PluginStudioWorkspaceSeedResponse,
    summary="Seed plugin studio source into chat thread workspace",
)
async def seed_plugin_studio_workspace(
    session_id: str,
    payload: PluginStudioWorkspaceSyncRequest,
) -> PluginStudioWorkspaceSeedResponse:
    with _PLUGIN_STUDIO_LOCK:
        session_payload = _read_plugin_studio_session(session_id)
        source_dir = _plugin_studio_scaffold_dir(session_id)
        if not source_dir.exists() or not source_dir.is_dir():
            raise HTTPException(status_code=409, detail="Plugin source is missing, run generate or import first")

        get_paths().ensure_thread_dirs(payload.thread_id)
        target_source_dir = _plugin_studio_workspace_source_dir(payload.thread_id)
        _copy_directory_contents(source_dir, target_source_dir)

        test_materials_root: str | None = None
        if payload.include_test_materials:
            _copy_plugin_studio_test_materials_to_thread_workspace(
                session_payload=session_payload,
                thread_id=payload.thread_id,
            )
            test_materials_root = _PLUGIN_STUDIO_WORKSPACE_TEST_ROOT

    return PluginStudioWorkspaceSeedResponse(
        session_id=session_id,
        thread_id=payload.thread_id,
        source_root=_PLUGIN_STUDIO_WORKSPACE_SOURCE_ROOT,
        test_materials_root=test_materials_root,
    )


@plugin_studio_router.post(
    "/sessions/{session_id}/workspace/pull",
    response_model=PluginStudioSessionResponse,
    summary="Pull chat thread workspace source back into plugin studio session",
)
async def pull_plugin_studio_workspace(
    session_id: str,
    payload: PluginStudioWorkspaceSyncRequest,
) -> PluginStudioSessionResponse:
    with _PLUGIN_STUDIO_LOCK:
        session_payload = _read_plugin_studio_session(session_id)
        workspace_source_dir = _plugin_studio_workspace_source_dir(payload.thread_id)
        if not workspace_source_dir.exists() or not workspace_source_dir.is_dir():
            raise HTTPException(status_code=404, detail="Workspace plugin source not found")
        if not (workspace_source_dir / "manifest.json").exists():
            raise HTTPException(status_code=409, detail="Workspace plugin source missing manifest.json")

        target_source_dir = _plugin_studio_scaffold_dir(session_id)
        _copy_directory_contents(workspace_source_dir, target_source_dir)
        _sync_plugin_studio_session_metadata_from_source_dir(
            session_payload,
            source_dir=target_source_dir,
        )
        _refresh_plugin_studio_artifact_refs(session_payload)
        _save_plugin_studio_session(session_id, session_payload)
    return _plugin_studio_response(session_payload)


@plugin_studio_router.patch(
    "/sessions/{session_id}/draft",
    response_model=PluginStudioSessionResponse,
    summary="Update plugin studio draft metadata",
)
async def update_plugin_studio_draft(
    session_id: str,
    payload: PluginStudioDraftRequest,
) -> PluginStudioSessionResponse:
    with _PLUGIN_STUDIO_LOCK:
        session_payload = _read_plugin_studio_session(session_id)
        if payload.description is not None:
            session_payload["description"] = payload.description.strip()
        if payload.draft_version is not None:
            version = payload.draft_version.strip()
            if _parse_semver(version) is None:
                raise HTTPException(
                    status_code=422,
                    detail={"stage": "version", "message": "Draft version must be semver (x.y.z)"},
                )
            session_payload["draft_version"] = _normalize_semver(version)
        if payload.chat_thread_id is not None:
            session_payload["chat_thread_id"] = payload.chat_thread_id.strip()
        if payload.match_rules is not None:
            normalized_match_rules = _normalize_match_rules(payload.match_rules)
            session_payload["match_rules"] = normalized_match_rules
            workflow_state = _normalize_workflow_state(session_payload.get("workflow_state"))
            workflow_state["file_match_mode"] = "all_files" if normalized_match_rules.get("allowAll") else str(normalized_match_rules.get("kind") or "file")
            session_payload["workflow_state"] = workflow_state
        if payload.workflow_state is not None:
            session_payload["workflow_state"] = _normalize_workflow_state(payload.workflow_state)
        if payload.workflow_stage is not None:
            session_payload["workflow_stage"] = payload.workflow_stage
        if payload.selected_test_material_path is not None:
            selected = _to_non_empty_string(payload.selected_test_material_path)
            session_payload["selected_test_material_path"] = selected

        _save_plugin_studio_session(session_id, session_payload)
    return _plugin_studio_response(session_payload)


@plugin_studio_router.post(
    "/sessions/{session_id}/test-materials/import",
    response_model=PluginStudioTestMaterialsResponse,
    summary="Import test materials for plugin studio session",
)
async def import_plugin_studio_test_materials(
    session_id: str,
    payload: PluginStudioTestMaterialImportRequest,
) -> PluginStudioTestMaterialsResponse:
    with _PLUGIN_STUDIO_LOCK:
        session_payload = _read_plugin_studio_session(session_id)
        preview_thread_id = await _ensure_plugin_studio_preview_thread(
            session_payload,
            preferred_thread_id=_to_non_empty_string(payload.thread_id),
        )
        _import_plugin_studio_test_materials(
            session_payload=session_payload,
            payload=payload,
            thread_id=preview_thread_id,
        )
        _save_plugin_studio_session(session_id, session_payload)

    return PluginStudioTestMaterialsResponse(
        session_id=session_id,
        test_materials=[
            {
                "path": str(item.get("path") or ""),
                "kind": str(item.get("kind") or "file"),
                "source": str(item.get("source") or "upload"),
            }
            for item in (session_payload.get("test_materials") if isinstance(session_payload.get("test_materials"), list) else [])
            if isinstance(item, dict) and str(item.get("path") or "").strip()
        ],
        selected_test_material_path=_to_non_empty_string(session_payload.get("selected_test_material_path")) or None,
    )


@plugin_studio_router.get(
    "/sessions/{session_id}/test-materials",
    response_model=PluginStudioTestMaterialsResponse,
    summary="List plugin studio test materials",
)
async def list_plugin_studio_test_materials(session_id: str) -> PluginStudioTestMaterialsResponse:
    session_payload = _read_plugin_studio_session(session_id)
    return PluginStudioTestMaterialsResponse(
        session_id=session_id,
        test_materials=[
            {
                "path": str(item.get("path") or ""),
                "kind": str(item.get("kind") or "file"),
                "source": str(item.get("source") or "upload"),
            }
            for item in (session_payload.get("test_materials") if isinstance(session_payload.get("test_materials"), list) else [])
            if isinstance(item, dict) and str(item.get("path") or "").strip()
        ],
        selected_test_material_path=_to_non_empty_string(session_payload.get("selected_test_material_path")) or None,
    )


@plugin_studio_router.delete(
    "/sessions/{session_id}/test-materials",
    response_model=PluginStudioTestMaterialsResponse,
    summary="Delete plugin studio test material item",
)
async def delete_plugin_studio_test_materials(
    session_id: str,
    payload: PluginStudioTestMaterialDeleteRequest,
) -> PluginStudioTestMaterialsResponse:
    with _PLUGIN_STUDIO_LOCK:
        session_payload = _read_plugin_studio_session(session_id)
        preview_thread_id = await _ensure_plugin_studio_preview_thread(
            session_payload,
            preferred_thread_id=_to_non_empty_string(payload.thread_id),
        )
        _delete_plugin_studio_test_material(
            session_payload=session_payload,
            payload=payload,
            thread_id=preview_thread_id,
        )
        _save_plugin_studio_session(session_id, session_payload)
    return PluginStudioTestMaterialsResponse(
        session_id=session_id,
        test_materials=[
            {
                "path": str(item.get("path") or ""),
                "kind": str(item.get("kind") or "file"),
                "source": str(item.get("source") or "upload"),
            }
            for item in (session_payload.get("test_materials") if isinstance(session_payload.get("test_materials"), list) else [])
            if isinstance(item, dict) and str(item.get("path") or "").strip()
        ],
        selected_test_material_path=_to_non_empty_string(session_payload.get("selected_test_material_path")) or None,
    )


@plugin_studio_router.post(
    "/sessions/{session_id}/verify/auto",
    response_model=PluginStudioAutoVerifyResponse,
    summary="Run auto verification for plugin studio session",
)
async def auto_verify_plugin_studio_session(session_id: str) -> PluginStudioAutoVerifyResponse:
    with _PLUGIN_STUDIO_LOCK:
        session_payload = _read_plugin_studio_session(session_id)
        if str(session_payload.get("state")) == "draft":
            raise HTTPException(status_code=409, detail="Session is draft, generate scaffold first")
        passed, steps = _run_plugin_studio_auto_verify(session_payload)
        session_payload["auto_verified"] = passed
        session_payload["manual_verified"] = False if not passed else bool(session_payload.get("manual_verified", False))
        session_payload["state"] = "auto_verified" if passed else "generated"
        session_payload["last_auto_verify"] = {
            "executed_at": _utcnow_iso(),
            "passed": passed,
            "steps": steps,
        }
        _save_plugin_studio_session(session_id, session_payload)

    summary = "Auto verification passed." if passed else "Auto verification failed."
    return PluginStudioAutoVerifyResponse(
        session_id=session_id,
        passed=passed,
        executed_at=_utcnow_iso(),
        summary=summary,
        steps=[PluginStudioStepReport(**step) for step in steps],
    )


@plugin_studio_router.post(
    "/sessions/{session_id}/publish",
    response_model=PluginStudioPublishResponse,
    summary="Publish plugin studio session with auto verify/package pipeline",
)
async def publish_plugin_studio_session(
    session_id: str,
    payload: PluginStudioPublishRequest,
) -> PluginStudioPublishResponse:
    with _PLUGIN_STUDIO_LOCK:
        session_payload = _read_plugin_studio_session(session_id)
        version = payload.version.strip()
        if _parse_semver(version) is None:
            raise HTTPException(status_code=422, detail={"stage": "version", "message": "Version must be semver (x.y.z)"})

        current_version = _normalize_semver(str(session_payload.get("current_version") or "0.1.0"))
        if not _is_semver_greater(version, current_version):
            raise HTTPException(
                status_code=422,
                detail={
                    "stage": "version",
                    "message": f"Version must be greater than current version {current_version}",
                },
            )

        _apply_plugin_studio_publish_changes(session_payload, payload)

        passed, steps = _run_plugin_studio_auto_verify(session_payload)
        verify_executed_at = _utcnow_iso()
        session_payload["last_auto_verify"] = {
            "executed_at": verify_executed_at,
            "passed": passed,
            "steps": steps,
        }
        session_payload["auto_verified"] = passed
        if not passed:
            session_payload["manual_verified"] = False
            session_payload["state"] = "generated"
            _save_plugin_studio_session(session_id, session_payload)
            raise HTTPException(
                status_code=422,
                detail={
                    "stage": "auto_verify",
                    "message": "Auto verification failed",
                    "steps": steps,
                },
            )

        session_payload["manual_verified"] = True
        session_payload["manual_note"] = "publish pipeline auto-approved"
        session_payload["state"] = "manual_verified"

        package_path = _build_plugin_studio_package(session_payload)
        packaged_at = _utcnow_iso()
        session_payload["state"] = "packaged"
        session_payload["package_rel_path"] = str(package_path.relative_to(_plugin_studio_session_dir(session_id)))
        session_payload["packaged_at"] = packaged_at
        session_payload["published_at"] = packaged_at
        session_payload["current_version"] = _normalize_semver(version)
        _save_plugin_studio_session(session_id, session_payload)

    verify_summary = "Auto verification passed." if passed else "Auto verification failed."
    verify_report = PluginStudioAutoVerifyResponse(
        session_id=session_id,
        passed=passed,
        executed_at=verify_executed_at,
        summary=verify_summary,
        steps=[PluginStudioStepReport(**step) for step in steps],
    )
    return PluginStudioPublishResponse(
        session=_plugin_studio_response(session_payload),
        plugin_id=str(session_payload["plugin_id"]),
        version=str(session_payload["current_version"]),
        filename=package_path.name,
        package_download_url=f"/api/workbench/plugin-studio/sessions/{session_id}/package/download",
        packaged_at=packaged_at,
        verify_report=verify_report,
    )


@plugin_studio_router.post(
    "/sessions/{session_id}/verify/manual",
    response_model=PluginStudioSessionResponse,
    summary="Mark manual verification result for plugin studio session",
)
async def manual_verify_plugin_studio_session(
    session_id: str,
    payload: PluginStudioManualVerifyRequest,
) -> PluginStudioSessionResponse:
    with _PLUGIN_STUDIO_LOCK:
        session_payload = _read_plugin_studio_session(session_id)
        if payload.passed and not bool(session_payload.get("auto_verified", False)):
            raise HTTPException(status_code=409, detail="Auto verification must pass before manual verification")
        session_payload["manual_verified"] = bool(payload.passed)
        session_payload["manual_note"] = payload.note or ""
        if payload.passed:
            session_payload["state"] = "manual_verified"
        else:
            session_payload["state"] = "auto_verified" if bool(session_payload.get("auto_verified", False)) else "generated"
        _save_plugin_studio_session(session_id, session_payload)
    return _plugin_studio_response(session_payload)


@plugin_studio_router.post(
    "/sessions/{session_id}/package",
    response_model=PluginStudioPackageResponse,
    summary="Package plugin studio session as .nwp",
)
async def package_plugin_studio_session(session_id: str) -> PluginStudioPackageResponse:
    with _PLUGIN_STUDIO_LOCK:
        session_payload = _read_plugin_studio_session(session_id)
        if not bool(session_payload.get("auto_verified", False)):
            raise HTTPException(status_code=409, detail="Auto verification has not passed")
        if not bool(session_payload.get("manual_verified", False)):
            raise HTTPException(status_code=409, detail="Manual verification has not passed")
        package_path = _build_plugin_studio_package(session_payload)
        session_payload["state"] = "packaged"
        session_payload["package_rel_path"] = str(package_path.relative_to(_plugin_studio_session_dir(session_id)))
        packaged_at = _utcnow_iso()
        session_payload["packaged_at"] = packaged_at
        _save_plugin_studio_session(session_id, session_payload)

    return PluginStudioPackageResponse(
        session_id=session_id,
        plugin_id=str(session_payload["plugin_id"]),
        filename=package_path.name,
        package_download_url=f"/api/workbench/plugin-studio/sessions/{session_id}/package/download",
        packaged_at=packaged_at,
    )


@plugin_studio_router.get(
    "/sessions/{session_id}/package/download",
    summary="Download packaged plugin studio artifact",
)
async def download_plugin_studio_package(session_id: str) -> FileResponse:
    session_payload = _read_plugin_studio_session(session_id)
    package_rel_path = str(session_payload.get("package_rel_path") or "").strip()
    if not package_rel_path:
        raise HTTPException(status_code=404, detail="Packaged artifact not found")
    package_file = (_plugin_studio_session_dir(session_id) / package_rel_path).resolve()
    try:
        package_file.relative_to(_plugin_studio_session_dir(session_id))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid package file path") from exc
    if not package_file.exists() or not package_file.is_file():
        raise HTTPException(status_code=404, detail="Packaged artifact file missing")
    return FileResponse(path=package_file, filename=package_file.name, media_type="application/zip")


@plugin_studio_router.get(
    "/sessions/{session_id}/readme",
    summary="Read plugin studio generated README",
)
async def read_plugin_studio_readme(session_id: str) -> FileResponse:
    session_payload = _read_plugin_studio_session(session_id)
    readme_rel = str(session_payload.get("readme_rel_path") or "").strip()
    if not readme_rel:
        raise HTTPException(status_code=404, detail="README not generated")
    readme_file = (_plugin_studio_scaffold_dir(session_id) / readme_rel).resolve()
    try:
        readme_file.relative_to(_plugin_studio_scaffold_dir(session_id))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid readme path") from exc
    if not readme_file.exists() or not readme_file.is_file():
        raise HTTPException(status_code=404, detail="README file missing")
    return FileResponse(path=readme_file, media_type="text/markdown")


@plugin_studio_router.get(
    "/sessions/{session_id}/assets/{asset_path:path}",
    summary="Read plugin studio generated demo asset",
)
async def read_plugin_studio_asset(session_id: str, asset_path: str) -> FileResponse:
    normalized = asset_path.lstrip("/")
    if not normalized:
        raise HTTPException(status_code=404, detail="Asset path is empty")
    asset_file = (_plugin_studio_scaffold_dir(session_id) / normalized).resolve()
    try:
        asset_file.relative_to(_plugin_studio_scaffold_dir(session_id))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid asset path") from exc
    if not asset_file.exists() or not asset_file.is_file():
        raise HTTPException(status_code=404, detail="Asset file missing")
    return FileResponse(path=asset_file)
