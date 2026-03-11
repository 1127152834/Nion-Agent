"""Evolution API router."""

from fastapi import APIRouter, HTTPException

from src.evolution.models import EvolutionReport, EvolutionSettings, EvolutionSuggestion, SuggestionStatus
from src.evolution.service import get_evolution_service

router = APIRouter(prefix="/api/evolution", tags=["evolution"])


@router.post("/run", status_code=202)
async def run_evolution(agent_name: str = "_default") -> dict:
    """Run Evolution analysis manually for an agent."""
    service = get_evolution_service()
    settings = service.get_settings(agent_name)

    if not settings.enabled:
        raise HTTPException(status_code=403, detail="Evolution is disabled")

    report = await service.run(agent_name)
    return {"status": "completed", "report_id": report.report_id}


@router.get("/settings", response_model=EvolutionSettings)
async def get_settings(agent_name: str = "_default") -> EvolutionSettings:
    """Get Evolution settings for an agent."""
    service = get_evolution_service()
    return service.get_settings(agent_name)


@router.put("/settings", response_model=EvolutionSettings)
async def update_settings(settings: EvolutionSettings, agent_name: str = "_default") -> EvolutionSettings:
    """Update Evolution settings for an agent."""
    service = get_evolution_service()
    return service.update_settings(settings, agent_name)


@router.get("/reports", response_model=list[EvolutionReport])
async def get_reports(agent_name: str = "_default", limit: int = 50) -> list[EvolutionReport]:
    """Get Evolution reports for an agent."""
    service = get_evolution_service()
    return service.get_reports(agent_name, limit=limit)


@router.get("/reports/{report_id}", response_model=EvolutionReport)
async def get_report(report_id: str, agent_name: str = "_default") -> EvolutionReport:
    """Get Evolution report by ID for an agent."""
    service = get_evolution_service()
    report = service.get_report_by_id(report_id, agent_name)
    if not report:
        raise HTTPException(status_code=404, detail=f"Report not found: {report_id}")
    return report


@router.get("/suggestions", response_model=list[EvolutionSuggestion])
async def get_suggestions(
    agent_name: str = "_default",
    status: SuggestionStatus | None = None,
    limit: int = 50,
) -> list[EvolutionSuggestion]:
    """Get Evolution suggestions for an agent."""
    service = get_evolution_service()
    return service.get_suggestions(agent_name, status=status, limit=limit)


@router.post("/suggestions/{suggestion_id}/dismiss", response_model=EvolutionSuggestion)
async def dismiss_suggestion(suggestion_id: str, agent_name: str = "_default") -> EvolutionSuggestion:
    """Dismiss suggestion for an agent."""
    service = get_evolution_service()
    suggestion = service.dismiss_suggestion(suggestion_id, agent_name)
    if not suggestion:
        raise HTTPException(status_code=404, detail=f"Suggestion not found: {suggestion_id}")
    return suggestion


@router.post("/suggestions/{suggestion_id}/accept", response_model=EvolutionSuggestion)
async def accept_suggestion(suggestion_id: str, agent_name: str = "_default") -> EvolutionSuggestion:
    """Accept suggestion (does not auto-apply) for an agent."""
    service = get_evolution_service()
    suggestion = service.accept_suggestion(suggestion_id, agent_name)
    if not suggestion:
        raise HTTPException(status_code=404, detail=f"Suggestion not found: {suggestion_id}")
    return suggestion
