"""Test Evolution models."""

from src.evolution.models import (
    EvolutionReport,
    EvolutionSettings,
    EvolutionSuggestion,
    ReportStatus,
    SuggestionPriority,
    SuggestionStatus,
    SuggestionType,
)


def test_evolution_suggestion():
    """Test EvolutionSuggestion model."""
    suggestion = EvolutionSuggestion(
        report_id="test-report",
        type=SuggestionType.MEMORY,
        target_domain="memory",
        content="Test suggestion",
        evidence_summary="Test evidence",
        impact_scope="Test impact",
        confidence=0.85,
        priority=SuggestionPriority.MEDIUM,
    )
    assert suggestion.type == SuggestionType.MEMORY
    assert suggestion.status == SuggestionStatus.PENDING
    assert suggestion.default_action == "suggest_only"


def test_evolution_report():
    """Test EvolutionReport model."""
    report = EvolutionReport(
        status=ReportStatus.COMPLETED,
        duration_seconds=10,
        summary="Test report",
    )
    assert report.status == ReportStatus.COMPLETED
    assert len(report.suggestions) == 0


def test_evolution_settings():
    """Test EvolutionSettings model."""
    settings = EvolutionSettings(
        enabled=True,
        interval_hours=24,
    )
    assert settings.enabled is True
    assert settings.interval_hours == 24
    assert settings.auto_trigger is False
