"""Evolution service."""

from datetime import datetime

from app.evolution.analyzer import EvolutionAnalyzer
from app.evolution.models import EvolutionReport, EvolutionSettings, EvolutionSuggestion, ReportStatus, SuggestionStatus
from app.evolution.store import (
    get_report,
    load_reports,
    load_settings,
    load_suggestions,
    save_report,
    save_settings,
    save_suggestion,
    update_suggestion_status,
)


class EvolutionService:
    """Evolution service."""

    def __init__(self):
        self._analyzer = EvolutionAnalyzer()

    def get_settings(self, agent_name: str = "_default") -> EvolutionSettings:
        """Get settings for an agent."""
        return load_settings(agent_name)

    def update_settings(self, settings: EvolutionSettings, agent_name: str = "_default") -> EvolutionSettings:
        """Update settings for an agent."""
        current = load_settings(agent_name)
        save_settings(settings, agent_name)

        from datetime import UTC, datetime

        from nion.scheduler.models import ScheduledTask, TaskMode, TriggerConfig, TriggerType
        from nion.scheduler.runner import TaskAlreadyRunningError
        from nion.scheduler.service import get_scheduler

        scheduler = get_scheduler()
        scheduler.start()

        task_name = f"evolution:{agent_name}:auto_trigger"
        existing: ScheduledTask | None = None
        for task in scheduler.list_tasks():
            if task.name == task_name:
                existing = task
                break

        if (not settings.enabled) or (not settings.auto_trigger):
            if existing is not None:
                scheduler.remove_task(existing.id)
            return settings

        trigger = TriggerConfig(
            type=TriggerType.INTERVAL,
            interval_seconds=int(settings.interval_hours) * 3600,
            timezone="UTC",
        )

        if existing is not None:
            updated = ScheduledTask(
                id=existing.id,
                agent_name=agent_name,
                name=task_name,
                description="Evolution auto trigger",
                mode=TaskMode.EVOLUTION,
                trigger=trigger,
                steps=[],
                enabled=True,
                created_by="evolution",
                created_at=existing.created_at,
                timeout_seconds=existing.timeout_seconds,
                max_concurrent_steps=existing.max_concurrent_steps,
            )
            scheduler.update_task(existing.id, updated)
            task_id = existing.id
        else:
            task = ScheduledTask(
                agent_name=agent_name,
                name=task_name,
                description="Evolution auto trigger",
                mode=TaskMode.EVOLUTION,
                trigger=trigger,
                steps=[],
                enabled=True,
                created_by="evolution",
                created_at=datetime.now(UTC),
                timeout_seconds=60,
                max_concurrent_steps=1,
            )
            created = scheduler.add_task(task)
            task_id = created.id

        should_run_once = (not current.enabled) or (not current.auto_trigger)
        if should_run_once:
            try:
                scheduler.run_task_now(task_id)
            except TaskAlreadyRunningError:
                pass
        return settings

    async def run(self, agent_name: str = "_default") -> EvolutionReport:
        """Run Evolution analysis for an agent."""
        start_time = datetime.now()
        report_id = start_time.strftime("%Y-%m-%dT%H-%M-%SZ")

        try:
            # Generate suggestions
            suggestions = await self._analyzer.analyze(report_id, agent_name)

            # Save suggestions
            for suggestion in suggestions:
                save_suggestion(suggestion, agent_name)

            # Create report
            duration = (datetime.now() - start_time).total_seconds()
            report = EvolutionReport(
                report_id=report_id,
                timestamp=start_time,
                status=ReportStatus.COMPLETED,
                duration_seconds=int(duration),
                input_sources={
                    "heartbeat_logs": True,
                    "memory_stats": True,
                    "soul_summaries": True,
                },
                suggestions=suggestions,
                summary=f"生成了 {len(suggestions)} 条建议",
            )

            # Save report
            save_report(report, agent_name)

            return report

        except Exception as e:
            duration = (datetime.now() - start_time).total_seconds()
            report = EvolutionReport(
                report_id=report_id,
                timestamp=start_time,
                status=ReportStatus.FAILED,
                duration_seconds=int(duration),
                input_sources={},
                suggestions=[],
                summary="",
                error_message=str(e),
            )
            save_report(report, agent_name)
            raise

    def get_reports(self, agent_name: str = "_default", limit: int = 50) -> list[EvolutionReport]:
        """Get reports for an agent."""
        return load_reports(agent_name, limit=limit)

    def get_report_by_id(self, report_id: str, agent_name: str = "_default") -> EvolutionReport | None:
        """Get report by ID for an agent."""
        return get_report(report_id, agent_name)

    def get_suggestions(self, agent_name: str = "_default", status: SuggestionStatus | None = None, limit: int = 50) -> list[EvolutionSuggestion]:
        """Get suggestions for an agent."""
        return load_suggestions(agent_name, status=status, limit=limit)

    def dismiss_suggestion(self, suggestion_id: str, agent_name: str = "_default") -> EvolutionSuggestion | None:
        """Dismiss suggestion for an agent."""
        return update_suggestion_status(suggestion_id, SuggestionStatus.DISMISSED, agent_name)

    def accept_suggestion(self, suggestion_id: str, agent_name: str = "_default") -> EvolutionSuggestion | None:
        """Accept suggestion (does not auto-apply) for an agent."""
        return update_suggestion_status(suggestion_id, SuggestionStatus.ACCEPTED, agent_name)


# Singleton
_service: EvolutionService | None = None


def get_evolution_service() -> EvolutionService:
    """Get Evolution service singleton."""
    global _service
    if _service is None:
        _service = EvolutionService()
    return _service
