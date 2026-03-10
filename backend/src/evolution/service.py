"""Evolution service."""

from datetime import datetime

from src.evolution.analyzer import EvolutionAnalyzer
from src.evolution.models import EvolutionReport, EvolutionSettings, EvolutionSuggestion, ReportStatus, SuggestionStatus
from src.evolution.store import (
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
        self._settings = load_settings()
        self._analyzer = EvolutionAnalyzer()

    def get_settings(self) -> EvolutionSettings:
        """Get settings."""
        return self._settings

    def update_settings(self, settings: EvolutionSettings) -> EvolutionSettings:
        """Update settings."""
        save_settings(settings)
        self._settings = settings
        return settings

    async def run(self) -> EvolutionReport:
        """Run Evolution analysis."""
        start_time = datetime.now()
        report_id = start_time.strftime("%Y-%m-%dT%H-%M-%SZ")

        try:
            # Generate suggestions
            suggestions = await self._analyzer.analyze(report_id)

            # Save suggestions
            for suggestion in suggestions:
                save_suggestion(suggestion)

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
            save_report(report)

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
            save_report(report)
            raise

    def get_reports(self, limit: int = 50) -> list[EvolutionReport]:
        """Get reports."""
        return load_reports(limit=limit)

    def get_report_by_id(self, report_id: str) -> EvolutionReport | None:
        """Get report by ID."""
        return get_report(report_id)

    def get_suggestions(self, status: SuggestionStatus | None = None, limit: int = 50) -> list[EvolutionSuggestion]:
        """Get suggestions."""
        return load_suggestions(status=status, limit=limit)

    def dismiss_suggestion(self, suggestion_id: str) -> EvolutionSuggestion | None:
        """Dismiss suggestion."""
        return update_suggestion_status(suggestion_id, SuggestionStatus.DISMISSED)

    def accept_suggestion(self, suggestion_id: str) -> EvolutionSuggestion | None:
        """Accept suggestion (does not auto-apply)."""
        return update_suggestion_status(suggestion_id, SuggestionStatus.ACCEPTED)


# Singleton
_service: EvolutionService | None = None


def get_evolution_service() -> EvolutionService:
    """Get Evolution service singleton."""
    global _service
    if _service is None:
        _service = EvolutionService()
    return _service
