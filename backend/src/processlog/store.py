"""File-backed storage for ProcessLog events."""

from __future__ import annotations

import json
import threading
from pathlib import Path

from src.config.paths import get_paths
from src.processlog.types import ProcessLogEvent

_LOCK = threading.Lock()


def _processlog_dir() -> Path:
    path = get_paths().base_dir / "processlog"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _events_file() -> Path:
    return _processlog_dir() / "events.jsonl"


def append_event(event: ProcessLogEvent) -> None:
    line = json.dumps(event.model_dump(mode="json"), ensure_ascii=False)
    with _LOCK:
        with _events_file().open("a", encoding="utf-8") as f:
            f.write(line + "\n")


def load_events(*, trace_id: str | None = None, chat_id: str | None = None, limit: int = 1000) -> list[ProcessLogEvent]:
    path = _events_file()
    if not path.exists():
        return []

    rows: list[ProcessLogEvent] = []
    with _LOCK:
        lines = path.read_text(encoding="utf-8").splitlines()

    for line in reversed(lines):
        if not line.strip():
            continue
        try:
            payload = json.loads(line)
            event = ProcessLogEvent.model_validate(payload)
        except Exception:  # noqa: BLE001
            continue
        if trace_id and event.trace_id != trace_id:
            continue
        if chat_id and event.chat_id != chat_id:
            continue
        rows.append(event)
        if len(rows) >= max(1, int(limit)):
            break
    rows.reverse()
    return rows

