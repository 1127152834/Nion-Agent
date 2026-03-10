"""Workbench runtime APIs: command sessions and plugin test execution."""

from __future__ import annotations

import asyncio
import json
import os
import signal
import subprocess
import threading
import time
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from src.config.paths import get_paths
from src.gateway.path_utils import resolve_thread_virtual_path

router = APIRouter(prefix="/api/threads/{thread_id}/workbench", tags=["workbench"])
plugin_router = APIRouter(prefix="/api/workbench/plugins", tags=["workbench"])

DEFAULT_CWD = "/mnt/user-data/workspace"
DEFAULT_COMMAND_TIMEOUT_SECONDS = 600
MAX_COMMAND_TIMEOUT_SECONDS = 1800
SESSION_TTL_SECONDS = 60 * 60
MAX_SESSIONS = 64


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
