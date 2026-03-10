"""Heartbeat service (reuses scheduler)."""

from datetime import UTC, datetime

from src.heartbeat.models import HeartbeatLogRecord, HeartbeatSettings, HeartbeatTemplate
from src.heartbeat.store import append_log, get_log_by_id, load_logs, load_settings, save_settings
from src.heartbeat.templates import get_default_templates, get_template
from src.scheduler.models import ScheduledTask, TaskMode, TriggerConfig, TriggerType
from src.scheduler.service import get_scheduler


class HeartbeatService:
    """Heartbeat service (reuses scheduler)."""

    def __init__(self):
        self._scheduler = get_scheduler()
        self._settings = load_settings()

    def get_settings(self) -> HeartbeatSettings:
        """Get settings."""
        return self._settings

    def update_settings(self, settings: HeartbeatSettings) -> HeartbeatSettings:
        """Update settings."""
        save_settings(settings)
        self._settings = settings

        # Sync with scheduler
        if not settings.enabled:
            # Disable all heartbeat tasks
            for task in self._scheduler.list_tasks():
                if task.name.startswith("heartbeat:"):
                    self._scheduler.remove_task(task.id)
        else:
            # Update tasks based on template configs
            self.bootstrap()

        return settings

    def get_templates(self) -> list[HeartbeatTemplate]:
        """Get all templates."""
        return list(get_default_templates().values())

    def bootstrap(self) -> dict[str, str]:
        """Initialize default heartbeat tasks."""
        settings = self._settings
        result = {}

        for tid, tmpl in get_default_templates().items():
            config = settings.templates.get(tid)
            if not config or not config.enabled:
                continue

            # Check if task already exists
            task_name = f"heartbeat:{tid}"
            existing = None
            for task in self._scheduler.list_tasks():
                if task.name == task_name:
                    existing = task
                    break

            trigger = TriggerConfig(
                type=TriggerType.CRON,
                cron_expression=config.cron,
                timezone=tmpl.default_timezone,
            )

            if existing:
                # Update existing task
                updated = ScheduledTask(
                    id=existing.id,
                    name=task_name,
                    description=tmpl.description,
                    mode=TaskMode.WORKFLOW,
                    trigger=trigger,
                    enabled=config.enabled,
                    created_by="heartbeat",
                    created_at=existing.created_at,
                )
                self._scheduler.update_task(existing.id, updated)
                result[tid] = existing.id
            else:
                # Create new task
                task = ScheduledTask(
                    name=task_name,
                    description=tmpl.description,
                    mode=TaskMode.WORKFLOW,
                    trigger=trigger,
                    enabled=config.enabled,
                    created_by="heartbeat",
                    created_at=datetime.now(UTC),
                )
                created = self._scheduler.add_task(task)
                result[tid] = created.id

        return result

    def execute_heartbeat(self, template_id: str) -> str:
        """Execute heartbeat manually."""
        tmpl = get_template(template_id)
        if not tmpl:
            raise ValueError(f"Unknown template: {template_id}")

        # Find corresponding scheduler task
        task_name = f"heartbeat:{template_id}"
        task_id = None
        for task in self._scheduler.list_tasks():
            if task.name == task_name:
                task_id = task.id
                break

        if not task_id:
            raise ValueError(f"Heartbeat task not found: {template_id}")

        # Run task now
        result = self._scheduler.run_task_now(task_id)
        return result.run_id

    def get_logs(self, template_id: str | None = None, limit: int = 50) -> list[HeartbeatLogRecord]:
        """Get logs."""
        all_logs = load_logs()

        if template_id:
            records = all_logs.get(template_id, [])
        else:
            records = []
            for logs in all_logs.values():
                records.extend(logs)
            records.sort(key=lambda r: r.timestamp, reverse=True)

        return records[:limit]

    def get_log(self, log_id: str) -> HeartbeatLogRecord | None:
        """Get log by ID."""
        return get_log_by_id(log_id)

    def get_status(self) -> dict:
        """Get Heartbeat system status."""
        settings = self._settings
        next_runs = {}

        for task in self._scheduler.list_tasks():
            if task.name.startswith("heartbeat:"):
                tid = task.name.split(":", 1)[1]
                next_runs[tid] = task.next_run_at.isoformat() if task.next_run_at else None

        recent_logs = self.get_logs(limit=10)

        return {
            "enabled": settings.enabled,
            "next_runs": next_runs,
            "recent_logs": recent_logs,
        }


# Singleton
_service: HeartbeatService | None = None


def get_heartbeat_service() -> HeartbeatService:
    """Get Heartbeat service singleton."""
    global _service
    if _service is None:
        _service = HeartbeatService()
    return _service
