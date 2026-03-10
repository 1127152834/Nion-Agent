"""Workbench runtime APIs: command sessions and plugin test execution."""

from __future__ import annotations

import asyncio
import json
import os
import re
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

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field

from src.config.paths import get_paths
from src.gateway.path_utils import resolve_thread_virtual_path

router = APIRouter(prefix="/api/threads/{thread_id}/workbench", tags=["workbench"])
plugin_router = APIRouter(prefix="/api/workbench/plugins", tags=["workbench"])
marketplace_router = APIRouter(prefix="/api/workbench/marketplace", tags=["workbench"])
plugin_studio_router = APIRouter(prefix="/api/workbench/plugin-studio", tags=["workbench"])

DEFAULT_CWD = "/mnt/user-data/workspace"
DEFAULT_COMMAND_TIMEOUT_SECONDS = 600
MAX_COMMAND_TIMEOUT_SECONDS = 1800
SESSION_TTL_SECONDS = 60 * 60
MAX_SESSIONS = 64
_SAFE_PLUGIN_ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,63}$")
_SAFE_SESSION_ID_RE = re.compile(r"^[a-f0-9]{32}$")


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


class PluginStudioSessionResponse(BaseModel):
    session_id: str
    plugin_id: str
    plugin_name: str
    chat_thread_id: str | None = None
    description: str
    state: Literal["draft", "generated", "auto_verified", "manual_verified", "packaged"]
    auto_verified: bool
    manual_verified: bool
    created_at: str
    updated_at: str
    readme_url: str | None = None
    demo_image_urls: list[str] = Field(default_factory=list)
    package_download_url: str | None = None


class PluginStudioPackageResponse(BaseModel):
    session_id: str
    plugin_id: str
    filename: str
    package_download_url: str
    packaged_at: str


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
    thread_id = f"workbench-test-{uuid.uuid4().hex}"
    paths = get_paths()
    paths.ensure_thread_dirs(thread_id)
    return PluginTestThreadResponse(
        thread_id=thread_id,
        created_at=_utcnow_iso(),
        workspace_root=str(paths.sandbox_work_dir(thread_id)),
    )


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


def _plugin_studio_scaffold_dir(session_id: str) -> Path:
    return _plugin_studio_session_dir(session_id) / "plugin-src"


def _plugin_studio_package_dir(session_id: str) -> Path:
    directory = _plugin_studio_session_dir(session_id) / "dist"
    directory.mkdir(parents=True, exist_ok=True)
    return directory


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
    demo_urls = [
        f"/api/workbench/plugin-studio/sessions/{session_id}/assets/{quote(str(rel).lstrip('/'))}"
        for rel in demo_rel_paths
        if str(rel).strip()
    ]
    package_download_url = None
    if package_rel:
        package_download_url = f"/api/workbench/plugin-studio/sessions/{session_id}/package/download"

    return PluginStudioSessionResponse(
        session_id=session_id,
        plugin_id=plugin_id,
        plugin_name=str(payload.get("plugin_name", plugin_id)),
        chat_thread_id=str(payload.get("chat_thread_id") or "") or None,
        description=str(payload.get("description", "")),
        state=str(payload.get("state", "draft")),  # type: ignore[arg-type]
        auto_verified=bool(payload.get("auto_verified", False)),
        manual_verified=bool(payload.get("manual_verified", False)),
        created_at=str(payload.get("created_at", _utcnow_iso())),
        updated_at=str(payload.get("updated_at", _utcnow_iso())),
        readme_url=readme_url,
        demo_image_urls=demo_urls,
        package_download_url=package_download_url,
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
        "ui": {"surface": "sidebar-slot"},
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
  color-scheme: light;
}
html, body {
  margin: 0;
  width: 100%;
  height: 100%;
  background: transparent;
  font-family: "SF Pro Text", "PingFang SC", "Helvetica Neue", sans-serif;
}
.app {
  display: flex;
  min-height: 100%;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
  color: #1f2937;
}
#toastBtn {
  width: fit-content;
  border: 1px solid #d1d5db;
  border-radius: 10px;
  padding: 6px 12px;
  background: #ffffff;
  cursor: pointer;
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
  if (title) title.textContent = {plugin_name!r};
  if (desc) desc.textContent = {description!r} || "Generated plugin scaffold is ready.";
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
2. 在聊天页右侧切换到“插件”模式。  
3. 选择该插件并开始调试。  

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


def _run_plugin_studio_auto_verify(session_payload: dict[str, Any]) -> tuple[bool, list[dict[str, Any]]]:
    session_id = str(session_payload["session_id"])
    scaffold_dir = _plugin_studio_scaffold_dir(session_id)
    manifest_file = scaffold_dir / "manifest.json"
    entry_file = scaffold_dir / "index.html"
    readme_file = scaffold_dir / "README.md"
    demo_file = scaffold_dir / "docs" / "demo" / "overview.svg"
    steps = [
        _plugin_studio_step("manifest_exists", manifest_file.exists(), "manifest.json exists"),
        _plugin_studio_step("entry_exists", entry_file.exists(), "index.html exists"),
        _plugin_studio_step("readme_exists", readme_file.exists(), "README.md exists"),
        _plugin_studio_step("demo_image_exists", demo_file.exists(), "docs/demo/overview.svg exists"),
    ]

    manifest_ok = False
    if manifest_file.exists():
        try:
            manifest_payload = json.loads(manifest_file.read_text(encoding="utf-8"))
            ui_surface = (
                (manifest_payload.get("ui") or {}).get("surface")
                if isinstance(manifest_payload.get("ui"), dict)
                else None
            )
            verification_level = (
                (manifest_payload.get("verification") or {}).get("level")
                if isinstance(manifest_payload.get("verification"), dict)
                else None
            )
            provenance_source = (
                (manifest_payload.get("provenance") or {}).get("source")
                if isinstance(manifest_payload.get("provenance"), dict)
                else None
            )
            manifest_ok = (
                ui_surface == "sidebar-slot"
                and verification_level == "auto_manual"
                and provenance_source == "assistant"
            )
            steps.append(
                _plugin_studio_step(
                    "manifest_contract",
                    manifest_ok,
                    "manifest ui.surface / verification.level / provenance.source are valid",
                ),
            )
        except Exception as exc:
            steps.append(_plugin_studio_step("manifest_contract", False, f"manifest parse failed: {exc}"))
            manifest_ok = False

    passed = all(bool(item["passed"]) for item in steps) and manifest_ok
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
            "description": payload.description.strip(),
            "state": "draft",
            "auto_verified": False,
            "manual_verified": False,
            "created_at": now,
            "updated_at": now,
            "readme_rel_path": "",
            "demo_rel_paths": [],
            "package_rel_path": "",
            "manual_note": "",
        }
        _save_plugin_studio_session(session_id, session_payload)
    return _plugin_studio_response(session_payload)


@plugin_studio_router.get(
    "/sessions/{session_id}",
    response_model=PluginStudioSessionResponse,
    summary="Get plugin studio session",
)
async def get_plugin_studio_session(session_id: str) -> PluginStudioSessionResponse:
    session_payload = _read_plugin_studio_session(session_id)
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
        session_payload["package_rel_path"] = ""
        _save_plugin_studio_session(session_id, session_payload)
    return _plugin_studio_response(session_payload)


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
