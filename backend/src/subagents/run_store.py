"""File-backed store for subagent run records."""

from __future__ import annotations

import json
import threading
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from src.config.paths import get_paths
from src.subagents.run_models import SubagentRunRecord

_LOCK = threading.Lock()


def _subagent_dir() -> Path:
    path = get_paths().base_dir / "subagents"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _runs_file() -> Path:
    return _subagent_dir() / "runs.json"


def _read_raw() -> dict[str, Any]:
    path = _runs_file()
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return {}


def _write_raw(payload: dict[str, Any]) -> None:
    path = _runs_file()
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    tmp.replace(path)


def upsert_run(record: SubagentRunRecord) -> SubagentRunRecord:
    with _LOCK:
        raw = _read_raw()
        payload = record.model_copy(update={"updated_at": datetime.now(UTC)})
        raw[payload.id] = payload.model_dump(mode="json")
        _write_raw(raw)
    return payload


def get_run(run_id: str) -> SubagentRunRecord | None:
    with _LOCK:
        raw = _read_raw()
    item = raw.get(run_id)
    if not isinstance(item, dict):
        return None
    try:
        return SubagentRunRecord.model_validate(item)
    except Exception:  # noqa: BLE001
        return None


def list_runs(*, limit: int = 200, status: str | None = None, trace_id: str | None = None) -> list[SubagentRunRecord]:
    with _LOCK:
        raw = _read_raw()
    rows: list[SubagentRunRecord] = []
    for value in raw.values():
        if not isinstance(value, dict):
            continue
        try:
            row = SubagentRunRecord.model_validate(value)
        except Exception:  # noqa: BLE001
            continue
        if status and row.status != status:
            continue
        if trace_id and row.trace_id != trace_id:
            continue
        rows.append(row)
    rows.sort(key=lambda item: item.updated_at, reverse=True)
    return rows[: max(1, int(limit))]


def patch_run(run_id: str, fields: dict[str, Any]) -> SubagentRunRecord | None:
    current = get_run(run_id)
    if current is None:
        return None
    merged = current.model_copy(update=fields)
    return upsert_run(merged)
