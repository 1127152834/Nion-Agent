"""Heartbeat settings and log storage."""

import json
import threading
from pathlib import Path

from src.config.paths import get_paths
from src.heartbeat.models import HeartbeatLogRecord, HeartbeatSettings, TemplateConfig
from src.heartbeat.templates import get_default_templates

_lock = threading.Lock()


def _heartbeat_dir() -> Path:
    """Heartbeat data directory."""
    return get_paths().base_dir / "heartbeat"


def _settings_file() -> Path:
    """Settings file path."""
    return _heartbeat_dir() / "settings.json"


def _logs_file() -> Path:
    """Logs file path."""
    return _heartbeat_dir() / "logs.json"


def load_settings() -> HeartbeatSettings:
    """Load Heartbeat settings."""
    with _lock:
        settings_file = _settings_file()
        if not settings_file.exists():
            # Return default settings with all templates enabled
            templates = {}
            for tid, tmpl in get_default_templates().items():
                templates[tid] = TemplateConfig(
                    template_id=tid,
                    enabled=tmpl.default_enabled,
                    cron=tmpl.default_cron,
                )
            return HeartbeatSettings(enabled=True, timezone="UTC", templates=templates)

        with open(settings_file, encoding="utf-8") as f:
            data = json.load(f)
            return HeartbeatSettings(**data)


def save_settings(settings: HeartbeatSettings) -> None:
    """Save Heartbeat settings."""
    with _lock:
        settings_file = _settings_file()
        settings_file.parent.mkdir(parents=True, exist_ok=True)

        # Atomic write
        temp_file = settings_file.with_suffix(".tmp")
        with open(temp_file, "w", encoding="utf-8") as f:
            json.dump(settings.model_dump(), f, indent=2, default=str)
        temp_file.replace(settings_file)


def load_logs() -> dict[str, list[HeartbeatLogRecord]]:
    """Load Heartbeat logs grouped by type."""
    with _lock:
        logs_file = _logs_file()
        if not logs_file.exists():
            return {}

        with open(logs_file, encoding="utf-8") as f:
            data = json.load(f)
            result = {}
            for htype, records in data.items():
                result[htype] = [HeartbeatLogRecord(**r) for r in records]
            return result


def append_log(record: HeartbeatLogRecord, limit: int = 100) -> None:
    """Append log record."""
    with _lock:
        logs = load_logs()
        htype = record.heartbeat_type

        if htype not in logs:
            logs[htype] = []

        logs[htype].insert(0, record)
        logs[htype] = logs[htype][:limit]

        # Save
        logs_file = _logs_file()
        logs_file.parent.mkdir(parents=True, exist_ok=True)

        temp_file = logs_file.with_suffix(".tmp")
        data = {htype: [r.model_dump(mode="json") for r in records] for htype, records in logs.items()}
        with open(temp_file, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, default=str)
        temp_file.replace(logs_file)


def get_log_by_id(log_id: str) -> HeartbeatLogRecord | None:
    """Get log by ID."""
    logs = load_logs()
    for records in logs.values():
        for record in records:
            if record.id == log_id:
                return record
    return None
