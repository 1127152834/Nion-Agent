"""ProcessLog service."""

from __future__ import annotations

import threading
import uuid
from typing import Any

from src.processlog.store import append_event, load_events
from src.processlog.types import ProcessLogEvent, ProcessLogLevel


class ProcessLogService:
    """Service for recording and exporting process-level traces."""

    def record(
        self,
        *,
        trace_id: str,
        step: str,
        chat_id: str | None = None,
        level: ProcessLogLevel = "info",
        duration_ms: int = 0,
        data: dict[str, Any] | None = None,
    ) -> ProcessLogEvent:
        event = ProcessLogEvent(
            id=uuid.uuid4().hex[:12],
            trace_id=trace_id,
            chat_id=chat_id,
            step=step,
            level=level,
            duration_ms=max(0, int(duration_ms)),
            data=data or {},
        )
        append_event(event)
        return event

    def export_trace(self, trace_id: str, *, limit: int = 2000) -> dict[str, Any]:
        events = load_events(trace_id=trace_id, limit=limit)
        return {
            "trace_id": trace_id,
            "count": len(events),
            "events": [event.model_dump(mode="json") for event in events],
        }

    def export_chat(self, chat_id: str, *, limit: int = 2000) -> dict[str, Any]:
        events = load_events(chat_id=chat_id, limit=limit)
        return {
            "chat_id": chat_id,
            "count": len(events),
            "events": [event.model_dump(mode="json") for event in events],
        }


_LOCK = threading.Lock()
_SERVICE: ProcessLogService | None = None


def get_processlog_service() -> ProcessLogService:
    global _SERVICE
    with _LOCK:
        if _SERVICE is None:
            _SERVICE = ProcessLogService()
    return _SERVICE

