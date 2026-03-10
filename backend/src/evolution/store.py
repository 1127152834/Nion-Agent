"""Evolution storage."""

import json
import threading
from pathlib import Path

from src.config.paths import get_paths
from src.evolution.models import EvolutionReport, EvolutionSettings, EvolutionSuggestion, SuggestionStatus

_lock = threading.Lock()


def _evolution_dir() -> Path:
    """Evolution data directory."""
    return get_paths().base_dir / "evolution"


def _settings_file() -> Path:
    """Settings file path."""
    return _evolution_dir() / "settings.json"


def _reports_dir() -> Path:
    """Reports directory."""
    return _evolution_dir() / "reports"


def _suggestions_dir() -> Path:
    """Suggestions directory."""
    return _evolution_dir() / "suggestions"


def load_settings() -> EvolutionSettings:
    """Load Evolution settings."""
    with _lock:
        settings_file = _settings_file()
        if not settings_file.exists():
            return EvolutionSettings()

        with open(settings_file, encoding="utf-8") as f:
            data = json.load(f)
            return EvolutionSettings(**data)


def save_settings(settings: EvolutionSettings) -> None:
    """Save Evolution settings."""
    with _lock:
        settings_file = _settings_file()
        settings_file.parent.mkdir(parents=True, exist_ok=True)

        temp_file = settings_file.with_suffix(".tmp")
        with open(temp_file, "w", encoding="utf-8") as f:
            json.dump(settings.model_dump(), f, indent=2, default=str)
        temp_file.replace(settings_file)


def save_report(report: EvolutionReport) -> None:
    """Save Evolution report."""
    with _lock:
        reports_dir = _reports_dir()
        reports_dir.mkdir(parents=True, exist_ok=True)

        report_file = reports_dir / f"{report.report_id}.json"
        temp_file = report_file.with_suffix(".tmp")
        with open(temp_file, "w", encoding="utf-8") as f:
            json.dump(report.model_dump(mode="json"), f, indent=2, default=str)
        temp_file.replace(report_file)


def load_reports(limit: int = 50) -> list[EvolutionReport]:
    """Load Evolution reports."""
    with _lock:
        reports_dir = _reports_dir()
        if not reports_dir.exists():
            return []

        reports = []
        for report_file in sorted(reports_dir.glob("*.json"), reverse=True)[:limit]:
            with open(report_file, encoding="utf-8") as f:
                data = json.load(f)
                reports.append(EvolutionReport(**data))
        return reports


def get_report(report_id: str) -> EvolutionReport | None:
    """Get report by ID."""
    with _lock:
        report_file = _reports_dir() / f"{report_id}.json"
        if not report_file.exists():
            return None

        with open(report_file, encoding="utf-8") as f:
            data = json.load(f)
            return EvolutionReport(**data)


def save_suggestion(suggestion: EvolutionSuggestion) -> None:
    """Save suggestion."""
    with _lock:
        status_dir = _suggestions_dir() / suggestion.status.value
        status_dir.mkdir(parents=True, exist_ok=True)

        suggestion_file = status_dir / f"{suggestion.id}.json"
        temp_file = suggestion_file.with_suffix(".tmp")
        with open(temp_file, "w", encoding="utf-8") as f:
            json.dump(suggestion.model_dump(mode="json"), f, indent=2, default=str)
        temp_file.replace(suggestion_file)


def load_suggestions(status: SuggestionStatus | None = None, limit: int = 50) -> list[EvolutionSuggestion]:
    """Load suggestions."""
    with _lock:
        suggestions_dir = _suggestions_dir()
        if not suggestions_dir.exists():
            return []

        suggestions = []
        if status:
            status_dir = suggestions_dir / status.value
            if status_dir.exists():
                for suggestion_file in sorted(status_dir.glob("*.json"), reverse=True)[:limit]:
                    with open(suggestion_file, encoding="utf-8") as f:
                        data = json.load(f)
                        suggestions.append(EvolutionSuggestion(**data))
        else:
            for status_dir in suggestions_dir.iterdir():
                if status_dir.is_dir():
                    for suggestion_file in status_dir.glob("*.json"):
                        with open(suggestion_file, encoding="utf-8") as f:
                            data = json.load(f)
                            suggestions.append(EvolutionSuggestion(**data))
            suggestions.sort(key=lambda s: s.created_at, reverse=True)
            suggestions = suggestions[:limit]

        return suggestions


def update_suggestion_status(suggestion_id: str, new_status: SuggestionStatus) -> EvolutionSuggestion | None:
    """Update suggestion status."""
    with _lock:
        # Find suggestion in all status directories
        suggestions_dir = _suggestions_dir()
        if not suggestions_dir.exists():
            return None

        for status_dir in suggestions_dir.iterdir():
            if status_dir.is_dir():
                suggestion_file = status_dir / f"{suggestion_id}.json"
                if suggestion_file.exists():
                    # Load suggestion
                    with open(suggestion_file, encoding="utf-8") as f:
                        data = json.load(f)
                        suggestion = EvolutionSuggestion(**data)

                    # Update status
                    suggestion.status = new_status
                    from datetime import datetime

                    suggestion.updated_at = datetime.now()

                    # Move to new status directory
                    new_status_dir = suggestions_dir / new_status.value
                    new_status_dir.mkdir(parents=True, exist_ok=True)
                    new_file = new_status_dir / f"{suggestion_id}.json"

                    temp_file = new_file.with_suffix(".tmp")
                    with open(temp_file, "w", encoding="utf-8") as f:
                        json.dump(suggestion.model_dump(mode="json"), f, indent=2, default=str)
                    temp_file.replace(new_file)

                    # Remove old file
                    suggestion_file.unlink()

                    return suggestion

        return None
