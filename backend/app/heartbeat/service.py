"""Heartbeat service (reuses scheduler)."""

from datetime import UTC, datetime

from src.heartbeat.models import HeartbeatLogRecord, HeartbeatSettings, HeartbeatTemplate
from src.heartbeat.store import get_log_by_id, load_logs, load_settings, save_settings
from src.heartbeat.templates import get_default_templates, get_template
from src.scheduler.models import ScheduledTask, TaskMode, TriggerConfig, TriggerType
from src.scheduler.service import get_scheduler


class HeartbeatService:
    """Heartbeat service (reuses scheduler)."""

    def __init__(self):
        self._scheduler = get_scheduler()

    def get_settings(self, agent_name: str = "_default") -> HeartbeatSettings:
        """Get settings for an agent.

        Args:
            agent_name: Agent name (default: "_default")

        Returns:
            HeartbeatSettings instance
        """
        return load_settings(agent_name)

    def update_settings(self, settings: HeartbeatSettings, agent_name: str = "_default") -> HeartbeatSettings:
        """Update settings for an agent.

        Args:
            settings: HeartbeatSettings to save
            agent_name: Agent name (default: "_default")

        Returns:
            Updated HeartbeatSettings instance
        """
        save_settings(settings, agent_name)

        # Sync with scheduler
        if not settings.enabled:
            # Disable all heartbeat tasks for this agent
            task_prefix = f"heartbeat:{agent_name}:"
            for task in self._scheduler.list_tasks():
                if task.name.startswith(task_prefix):
                    self._scheduler.remove_task(task.id)
        else:
            # Update tasks based on template configs
            self.bootstrap(agent_name)

        return settings

    def get_templates(self) -> list[HeartbeatTemplate]:
        """Get all templates."""
        return list(get_default_templates().values())

    def bootstrap(self, agent_name: str = "_default") -> dict[str, str]:
        """Initialize default heartbeat tasks for an agent.

        Args:
            agent_name: Agent name (default: "_default")

        Returns:
            Dict mapping template ID to scheduler task ID
        """
        settings = load_settings(agent_name)
        result = {}

        for tid, tmpl in get_default_templates().items():
            config = settings.templates.get(tid)
            if not config or not config.enabled:
                continue

            # Check if task already exists
            task_name = f"heartbeat:{agent_name}:{tid}"
            existing = None
            for task in self._scheduler.list_tasks():
                if task.name == task_name:
                    existing = task
                    break

            trigger = TriggerConfig(
                type=TriggerType.CRON,
                cron_expression=config.cron,
                timezone=settings.timezone or tmpl.default_timezone,
            )

            if existing:
                # Update existing task
                updated = ScheduledTask(
                    id=existing.id,
                    agent_name=agent_name,
                    name=task_name,
                    description=tmpl.description,
                    mode=TaskMode.HEARTBEAT,
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
                    agent_name=agent_name,
                    name=task_name,
                    description=tmpl.description,
                    mode=TaskMode.HEARTBEAT,
                    trigger=trigger,
                    enabled=config.enabled,
                    created_by="heartbeat",
                    created_at=datetime.now(UTC),
                )
                created = self._scheduler.add_task(task)
                result[tid] = created.id

        return result

    def execute_heartbeat(self, template_id: str, agent_name: str = "_default") -> str:
        """Execute heartbeat manually for an agent.

        Args:
            template_id: Template ID to execute
            agent_name: Agent name (default: "_default")

        Returns:
            Run ID from scheduler
        """
        tmpl = get_template(template_id)
        if not tmpl:
            raise ValueError(f"Unknown template: {template_id}")

        # Find corresponding scheduler task
        task_name = f"heartbeat:{agent_name}:{template_id}"
        task_id = None
        for task in self._scheduler.list_tasks():
            if task.name == task_name:
                task_id = task.id
                break

        if not task_id:
            # Be tolerant to "not bootstrapped yet" state: ensure tasks exist, then retry.
            self.bootstrap(agent_name)
            for task in self._scheduler.list_tasks():
                if task.name == task_name:
                    task_id = task.id
                    break

        if not task_id:
            raise ValueError(f"Heartbeat task not found: {template_id}")

        # Run task now
        result = self._scheduler.run_task_now(task_id)
        return result.run_id

    def get_logs(self, agent_name: str = "_default", template_id: str | None = None, limit: int = 50) -> list[HeartbeatLogRecord]:
        """Get logs for an agent.

        Args:
            agent_name: Agent name (default: "_default")
            template_id: Optional template ID to filter by
            limit: Maximum number of logs to return

        Returns:
            List of HeartbeatLogRecord
        """
        all_logs = load_logs(agent_name)

        if template_id:
            records = all_logs.get(template_id, [])
        else:
            records = []
            for logs in all_logs.values():
                records.extend(logs)
            records.sort(key=lambda r: r.timestamp, reverse=True)

        return records[:limit]

    def get_log(self, log_id: str, agent_name: str = "_default") -> HeartbeatLogRecord | None:
        """Get log by ID for an agent.

        Args:
            log_id: Log record ID
            agent_name: Agent name (default: "_default")

        Returns:
            HeartbeatLogRecord if found, None otherwise
        """
        return get_log_by_id(log_id, agent_name)

    def get_status(self, agent_name: str = "_default") -> dict:
        """Get Heartbeat system status for an agent.

        Args:
            agent_name: Agent name (default: "_default")

        Returns:
            Status dict with enabled, next_runs, and recent_logs
        """
        settings = load_settings(agent_name)
        next_runs = {}

        task_prefix = f"heartbeat:{agent_name}:"
        for task in self._scheduler.list_tasks():
            if task.name.startswith(task_prefix):
                tid = task.name.split(":", 2)[2]
                next_runs[tid] = task.next_run_at.isoformat() if task.next_run_at else None

        recent_logs = self.get_logs(agent_name, limit=10)

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
