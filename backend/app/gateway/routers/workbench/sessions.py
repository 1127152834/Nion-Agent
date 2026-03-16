"""Workbench command session endpoints."""

from __future__ import annotations

import asyncio
import os
import signal
import subprocess
import threading
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse

from app.gateway.routers.workbench._helpers import (
    MAX_SESSIONS,
    SESSION_TTL_SECONDS,
    _resolve_cwd,
    _sse,
    _utcnow_iso,
)
from app.gateway.routers.workbench.models import (
    WorkbenchSessionCreateRequest,
    WorkbenchSessionCreateResponse,
    WorkbenchSessionStopResponse,
)

router = APIRouter(prefix="/api/threads/{thread_id}/workbench", tags=["workbench"])


# ── Session state ────────────────────────────────────────────────────────────


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


def _get_session_or_404(thread_id: str, session_id: str) -> _SessionState:
    with _SESSIONS_LOCK:
        session = _SESSIONS.get(session_id)
    if session is None or session.thread_id != thread_id:
        raise HTTPException(status_code=404, detail=f"Workbench session not found: {session_id}")
    return session


# ── Endpoints ────────────────────────────────────────────────────────────────


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
