"""Heartbeat settings and log storage."""

import json
import threading
from pathlib import Path

from app.heartbeat.models import HeartbeatLogRecord, HeartbeatSettings, TemplateConfig
from app.heartbeat.templates import get_default_templates
from nion.config.paths import get_paths

_lock = threading.Lock()


def _heartbeat_file(agent_name: str = "_default") -> Path:
    """Per-agent heartbeat file path."""
    return get_paths().agent_heartbeat_file(agent_name)


def load_settings(agent_name: str = "_default") -> HeartbeatSettings:
    """Load Heartbeat settings for an agent.

    Args:
        agent_name: Agent name (default: "_default")

    Returns:
        HeartbeatSettings instance
    """
    with _lock:
        heartbeat_file = _heartbeat_file(agent_name)
        if not heartbeat_file.exists():
            # Return default settings with all templates enabled
            templates = {}
            for tid, tmpl in get_default_templates().items():
                templates[tid] = TemplateConfig(
                    template_id=tid,
                    enabled=tmpl.default_enabled,
                    cron=tmpl.default_cron,
                )
            return HeartbeatSettings(enabled=True, timezone="UTC", templates=templates)

        with open(heartbeat_file, encoding="utf-8") as f:
            data = json.load(f)
            # Extract settings from root or nested structure
            if "settings" in data:
                settings_data = data["settings"]
            else:
                # Legacy format or settings-only file
                settings_data = {k: v for k, v in data.items() if k != "logs"}
            return HeartbeatSettings(**settings_data)


def save_settings(settings: HeartbeatSettings, agent_name: str = "_default") -> None:
    """Save Heartbeat settings for an agent.

    Args:
        settings: HeartbeatSettings to save
        agent_name: Agent name (default: "_default")
    """
    with _lock:
        heartbeat_file = _heartbeat_file(agent_name)
        heartbeat_file.parent.mkdir(parents=True, exist_ok=True)

        # Load existing data to preserve logs
        existing_data = {}
        if heartbeat_file.exists():
            with open(heartbeat_file, encoding="utf-8") as f:
                existing_data = json.load(f)

        # Update settings while preserving logs
        new_data = {
            "settings": settings.model_dump(),
            "logs": existing_data.get("logs", {}),
        }

        # Atomic write
        temp_file = heartbeat_file.with_suffix(".tmp")
        with open(temp_file, "w", encoding="utf-8") as f:
            json.dump(new_data, f, indent=2, default=str)
        temp_file.replace(heartbeat_file)


def load_logs(agent_name: str = "_default") -> dict[str, list[HeartbeatLogRecord]]:
    """Load Heartbeat logs for an agent.

    Args:
        agent_name: Agent name (default: "_default")

    Returns:
        Dict mapping heartbeat type to list of log records
    """
    with _lock:
        heartbeat_file = _heartbeat_file(agent_name)
        if not heartbeat_file.exists():
            return {}

        with open(heartbeat_file, encoding="utf-8") as f:
            data = json.load(f)
            logs_data = data.get("logs", {})
            result = {}
            for htype, records in logs_data.items():
                result[htype] = [HeartbeatLogRecord(**r) for r in records]
            return result


def append_log(record: HeartbeatLogRecord, agent_name: str = "_default", limit: int = 100) -> None:
    """Append log record for an agent.

    Args:
        record: HeartbeatLogRecord to append
        agent_name: Agent name (default: "_default")
        limit: Maximum number of logs to keep per type
    """
    with _lock:
        logs = load_logs(agent_name)
        htype = record.heartbeat_type

        if htype not in logs:
            logs[htype] = []

        logs[htype].insert(0, record)
        logs[htype] = logs[htype][:limit]

        # Load existing data to preserve settings
        heartbeat_file = _heartbeat_file(agent_name)
        heartbeat_file.parent.mkdir(parents=True, exist_ok=True)

        existing_data = {}
        if heartbeat_file.exists():
            with open(heartbeat_file, encoding="utf-8") as f:
                existing_data = json.load(f)

        # Update logs while preserving settings
        new_data = {
            "settings": existing_data.get("settings", {}),
            "logs": {htype: [r.model_dump(mode="json") for r in records] for htype, records in logs.items()},
        }

        # Atomic write
        temp_file = heartbeat_file.with_suffix(".tmp")
        with open(temp_file, "w", encoding="utf-8") as f:
            json.dump(new_data, f, indent=2, default=str)
        temp_file.replace(heartbeat_file)


def get_log_by_id(log_id: str, agent_name: str = "_default") -> HeartbeatLogRecord | None:
    """Get log by ID for an agent.

    Args:
        log_id: Log record ID
        agent_name: Agent name (default: "_default")

    Returns:
        HeartbeatLogRecord if found, None otherwise
    """
    logs = load_logs(agent_name)
    for records in logs.values():
        for record in records:
            if record.id == log_id:
                return record
    return None
