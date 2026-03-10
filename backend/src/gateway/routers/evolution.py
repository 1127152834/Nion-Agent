"""Evolution API router."""

from typing import Optional

from fastapi import APIRouter, HTTPException

from src.evolution.models import EvolutionReport, EvolutionSettings, EvolutionSuggestion, SuggestionStatus
from src.evolution.service import get_evolution_service

router = APIRouter(prefix="/api/evolution", tags=["evolution"])


@router.post("/run", status_code=202)
async def run_evolution() -> dict:
    """Run Evolution analysis manually."""
    service = get_evolution_service()
    settings = service.get_settings()

    if not settings.enabled:
        raise HTTPException(status_code=403, detail="Evolution is disabled")

    report = await service.run()
    return {"status": "completed", "report_id": report.report_id}


@router.get("/settings", response_model=EvolutionSettings)
async def get_settings() -> EvolutionSettings:
    """Get Evolution settings."""
    service = get_evolution_service()
    return service.get_settings()


@router.put("/settings", response_model=EvolutionSettings)
async def update_settings(settings: EvolutionSettings) -> EvolutionSettings:
    """Update Evolution settings."""
    service = get_evolution_service()
    return service.update_settings(settings)


@router.get("/reports", response_model=list[EvolutionReport])
async def get_reports(limit: int = 50) -> list[EvolutionReport]:
    """Get Evolution reports."""
    service = get_evolution_service()
    return service.get_reports(limit=limit)


@router.get("/reports/{report_id}", response_model=EvolutionReport)
async def get_report(report_id: str) -> EvolutionReport:
    """Get Evolution report by ID."""
    service = get_evolution_service()
    report = service.get_report_by_id(report_id)
    if not report:
        raise HTTPException(status_code=404, detail=f"Report not found: {report_id}")
    return report


@router.get("/suggestions", response_model=list[EvolutionSuggestion])
async def get_suggestions(
    status: Optional[SuggestionStatus] = None,
    limit: int = 50,
) -> list[EvolutionSuggestion]:
    """Get Evolution suggestions."""
    service = get_evolution_service()
    return service.get_suggestions(status=status, limit=limit)


@router.post("/suggestions/{suggestion_id}/dismiss", response_model=EvolutionSuggestion)
async def dismiss_suggestion(suggestion_id: str) -> EvolutionSuggestion:
    """Dismiss suggestion."""
    service = get_evolution_service()
    suggestion = service.dismiss_suggestion(suggestion_id)
    if not suggestion:
        raise HTTPException(status_code=404, detail=f"Suggestion not found: {suggestion_id}")
    return suggestion


@router.post("/suggestions/{suggestion_id}/accept", response_model=EvolutionSuggestion)
async def accept_suggestion(suggestion_id: str) -> EvolutionSuggestion:
    """Accept suggestion (does not auto-apply)."""
    service = get_evolution_service()
    suggestion = service.accept_suggestion(suggestion_id)
    if not suggestion:
        raise HTTPException(status_code=404, detail=f"Suggestion not found: {suggestion_id}")
    return suggestion
