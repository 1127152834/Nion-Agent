"""Global timezone propagation service."""

from __future__ import annotations

import json
import threading
from datetime import UTC, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from pydantic import BaseModel, Field

from nion.config.paths import get_paths
from app.heartbeat.service import get_heartbeat_service
from nion.scheduler.models import TriggerType
from nion.scheduler.service import get_scheduler

_LOCK = threading.Lock()


def _utc_iso() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


class SystemTimezoneState(BaseModel):
    timezone: str = "UTC"
    updated_at: str = Field(default_factory=_utc_iso)


class TimezoneUpdateSummary(BaseModel):
    timezone: str
    updated_at: str
    affected_task_ids: list[str] = Field(default_factory=list)
    affected_heartbeat_agents: list[str] = Field(default_factory=list)


def _system_settings_file() -> Path:
    path = get_paths().base_dir / "system" / "settings.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def _load_state_unlocked() -> SystemTimezoneState:
    path = _system_settings_file()
    if not path.exists():
        return SystemTimezoneState()
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(payload, dict):
            return SystemTimezoneState()
        return SystemTimezoneState.model_validate(payload)
    except Exception:  # noqa: BLE001
        return SystemTimezoneState()


def _save_state_unlocked(state: SystemTimezoneState) -> None:
    path = _system_settings_file()
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(state.model_dump(mode="json"), indent=2, ensure_ascii=False), encoding="utf-8")
    tmp.replace(path)


class TimezoneService:
    """Service for global timezone state and propagation."""

    def get_state(self) -> SystemTimezoneState:
        with _LOCK:
            return _load_state_unlocked()

    def update_timezone(self, timezone: str) -> TimezoneUpdateSummary:
        normalized = timezone.strip()
        try:
            ZoneInfo(normalized)
        except Exception as exc:  # noqa: BLE001
            raise ValueError(f"invalid timezone: {normalized}") from exc

        affected_task_ids: list[str] = []
        scheduler = get_scheduler()
        scheduler.start()
        for task in scheduler.list_tasks():
            if task.trigger.type not in {TriggerType.CRON, TriggerType.INTERVAL, TriggerType.ONCE}:
                continue
            if task.trigger.timezone == normalized:
                continue
            updated = task.model_copy(deep=True)
            updated.trigger.timezone = normalized
            scheduler.update_task(task.id, updated)
            affected_task_ids.append(task.id)

        heartbeat_service = get_heartbeat_service()
        heartbeat_agents: list[str] = []
        candidates = ["_default"]
        agents_dir = get_paths().agents_dir
        if agents_dir.exists():
            for directory in agents_dir.iterdir():
                if directory.is_dir():
                    candidates.append(directory.name.lower())
        for agent in sorted(set(candidates)):
            try:
                settings = heartbeat_service.get_settings(agent)
                if settings.timezone == normalized:
                    continue
                settings.timezone = normalized
                heartbeat_service.update_settings(settings, agent)
                heartbeat_agents.append(agent)
            except Exception:  # noqa: BLE001
                continue

        with _LOCK:
            state = SystemTimezoneState(timezone=normalized, updated_at=_utc_iso())
            _save_state_unlocked(state)
        return TimezoneUpdateSummary(
            timezone=normalized,
            updated_at=state.updated_at,
            affected_task_ids=affected_task_ids,
            affected_heartbeat_agents=heartbeat_agents,
        )


_SERVICE: TimezoneService | None = None


def get_timezone_service() -> TimezoneService:
    global _SERVICE
    with _LOCK:
        if _SERVICE is None:
            _SERVICE = TimezoneService()
    return _SERVICE
