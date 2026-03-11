"""Evolution storage."""

import json
import threading
from pathlib import Path

from src.config.paths import get_paths
from src.evolution.models import EvolutionReport, EvolutionSettings, EvolutionSuggestion, SuggestionStatus

_lock = threading.Lock()


def _evolution_file(agent_name: str = "_default") -> Path:
    """Per-agent evolution file path."""
    return get_paths().agent_evolution_file(agent_name)


def load_settings(agent_name: str = "_default") -> EvolutionSettings:
    """Load Evolution settings for an agent."""
    with _lock:
        evolution_file = _evolution_file(agent_name)
        if not evolution_file.exists():
            return EvolutionSettings()

        with open(evolution_file, encoding="utf-8") as f:
            data = json.load(f)
            settings_data = data.get("settings", {})
            return EvolutionSettings(**settings_data)


def save_settings(settings: EvolutionSettings, agent_name: str = "_default") -> None:
    """Save Evolution settings for an agent."""
    with _lock:
        evolution_file = _evolution_file(agent_name)
        evolution_file.parent.mkdir(parents=True, exist_ok=True)

        # Load existing data to preserve reports and suggestions
        existing_data = {}
        if evolution_file.exists():
            with open(evolution_file, encoding="utf-8") as f:
                existing_data = json.load(f)

        # Update settings while preserving other data
        new_data = {
            "settings": settings.model_dump(),
            "reports": existing_data.get("reports", []),
            "suggestions": existing_data.get("suggestions", {}),
        }

        temp_file = evolution_file.with_suffix(".tmp")
        with open(temp_file, "w", encoding="utf-8") as f:
            json.dump(new_data, f, indent=2, default=str)
        temp_file.replace(evolution_file)


def save_report(report: EvolutionReport, agent_name: str = "_default") -> None:
    """Save Evolution report for an agent."""
    with _lock:
        evolution_file = _evolution_file(agent_name)
        evolution_file.parent.mkdir(parents=True, exist_ok=True)

        # Load existing data
        existing_data = {"settings": {}, "reports": [], "suggestions": {}}
        if evolution_file.exists():
            with open(evolution_file, encoding="utf-8") as f:
                existing_data = json.load(f)

        # Add new report
        reports = existing_data.get("reports", [])
        reports.insert(0, report.model_dump(mode="json"))
        existing_data["reports"] = reports[:50]  # Keep last 50 reports

        temp_file = evolution_file.with_suffix(".tmp")
        with open(temp_file, "w", encoding="utf-8") as f:
            json.dump(existing_data, f, indent=2, default=str)
        temp_file.replace(evolution_file)


def load_reports(agent_name: str = "_default", limit: int = 50) -> list[EvolutionReport]:
    """Load Evolution reports for an agent."""
    with _lock:
        evolution_file = _evolution_file(agent_name)
        if not evolution_file.exists():
            return []

        with open(evolution_file, encoding="utf-8") as f:
            data = json.load(f)
            reports_data = data.get("reports", [])
            return [EvolutionReport(**r) for r in reports_data[:limit]]


def get_report(report_id: str, agent_name: str = "_default") -> EvolutionReport | None:
    """Get report by ID for an agent."""
    reports = load_reports(agent_name, limit=100)
    for report in reports:
        if report.report_id == report_id:
            return report
    return None


def save_suggestion(suggestion: EvolutionSuggestion, agent_name: str = "_default") -> None:
    """Save suggestion for an agent."""
    with _lock:
        evolution_file = _evolution_file(agent_name)
        evolution_file.parent.mkdir(parents=True, exist_ok=True)

        # Load existing data
        existing_data = {"settings": {}, "reports": [], "suggestions": {}}
        if evolution_file.exists():
            with open(evolution_file, encoding="utf-8") as f:
                existing_data = json.load(f)

        # Add/update suggestion
        suggestions = existing_data.get("suggestions", {})
        status_key = suggestion.status.value
        if status_key not in suggestions:
            suggestions[status_key] = []

        # Remove old version if exists
        suggestions[status_key] = [s for s in suggestions[status_key] if s.get("id") != suggestion.id]
        # Add new version
        suggestions[status_key].insert(0, suggestion.model_dump(mode="json"))
        existing_data["suggestions"] = suggestions

        temp_file = evolution_file.with_suffix(".tmp")
        with open(temp_file, "w", encoding="utf-8") as f:
            json.dump(existing_data, f, indent=2, default=str)
        temp_file.replace(evolution_file)


def load_suggestions(agent_name: str = "_default", status: SuggestionStatus | None = None, limit: int = 50) -> list[EvolutionSuggestion]:
    """Load suggestions for an agent."""
    with _lock:
        evolution_file = _evolution_file(agent_name)
        if not evolution_file.exists():
            return []

        with open(evolution_file, encoding="utf-8") as f:
            data = json.load(f)
            suggestions_data = data.get("suggestions", {})

        suggestions = []
        if status:
            status_suggestions = suggestions_data.get(status.value, [])
            suggestions = [EvolutionSuggestion(**s) for s in status_suggestions[:limit]]
        else:
            for status_key, status_suggestions in suggestions_data.items():
                suggestions.extend([EvolutionSuggestion(**s) for s in status_suggestions])
            suggestions.sort(key=lambda s: s.created_at, reverse=True)
            suggestions = suggestions[:limit]

        return suggestions


def update_suggestion_status(suggestion_id: str, new_status: SuggestionStatus, agent_name: str = "_default") -> EvolutionSuggestion | None:
    """Update suggestion status for an agent."""
    with _lock:
        evolution_file = _evolution_file(agent_name)
        if not evolution_file.exists():
            return None

        with open(evolution_file, encoding="utf-8") as f:
            data = json.load(f)

        suggestions_data = data.get("suggestions", {})

        # Find and update suggestion
        found_suggestion = None
        for status_key, status_suggestions in suggestions_data.items():
            for i, s in enumerate(status_suggestions):
                if s.get("id") == suggestion_id:
                    found_suggestion = EvolutionSuggestion(**s)
                    # Remove from old status
                    status_suggestions.pop(i)
                    break
            if found_suggestion:
                break

        if not found_suggestion:
            return None

        # Update status
        found_suggestion.status = new_status
        from datetime import datetime
        found_suggestion.updated_at = datetime.now()

        # Add to new status
        new_status_key = new_status.value
        if new_status_key not in suggestions_data:
            suggestions_data[new_status_key] = []
        suggestions_data[new_status_key].insert(0, found_suggestion.model_dump(mode="json"))

        data["suggestions"] = suggestions_data

        temp_file = evolution_file.with_suffix(".tmp")
        with open(temp_file, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, default=str)
        temp_file.replace(evolution_file)

        return found_suggestion
