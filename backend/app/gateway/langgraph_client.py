from __future__ import annotations

import asyncio
from typing import Any

import httpx
from fastapi import HTTPException

from app.gateway.config import get_gateway_config


class LangGraphThreadNotFoundError(RuntimeError):
    pass


class LangGraphThreadNotReadyError(RuntimeError):
    pass


def get_langgraph_upstream_base_url() -> str:
    return get_gateway_config().langgraph_base_url.rstrip("/")


def build_langgraph_upstream_url(path: str) -> str:
    base = get_langgraph_upstream_base_url()
    if not path:
        return base
    return f"{base}/{path.lstrip('/')}"


_TERMINAL_RUN_STATUSES = {"success", "error", "timeout", "interrupted"}


async def cancel_active_thread_runs(thread_id: str, *, timeout: float = 15.0) -> None:
    async with httpx.AsyncClient(timeout=timeout) as client:
        try:
            response = await client.get(
                build_langgraph_upstream_url(f"threads/{thread_id}/runs"),
                params={"limit": 100},
            )
        except httpx.RequestError as exc:
            raise HTTPException(status_code=502, detail=f"LangGraph upstream unavailable: {exc}") from exc

        if response.status_code == 404:
            return
        if not response.is_success:
            raise HTTPException(status_code=502, detail=f"Failed to list thread runs ({response.status_code})")

        payload = response.json()
        if not isinstance(payload, list):
            raise HTTPException(status_code=502, detail="Invalid runs payload from LangGraph")

        active_run_ids = [run.get("run_id") for run in payload if isinstance(run, dict) and isinstance(run.get("run_id"), str) and run.get("status") not in _TERMINAL_RUN_STATUSES]

        if not active_run_ids:
            return

        cancellations = await asyncio.gather(
            *(
                client.post(
                    build_langgraph_upstream_url(f"threads/{thread_id}/runs/{run_id}/cancel"),
                    params={"wait": "true", "action": "interrupt"},
                )
                for run_id in active_run_ids
            ),
            return_exceptions=True,
        )

    failures: list[str] = []
    for run_id, result in zip(active_run_ids, cancellations, strict=False):
        if isinstance(result, Exception):
            failures.append(run_id)
            continue
        if result.status_code in {200, 404, 409}:
            continue
        failures.append(run_id)

    if failures:
        joined = ", ".join(failures)
        raise HTTPException(status_code=502, detail=f"Failed to cancel active runs before thread delete: {joined}")


async def load_thread_state(thread_id: str, *, timeout: float = 15.0) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=timeout) as client:
        try:
            response = await client.get(build_langgraph_upstream_url(f"threads/{thread_id}/state"))
        except httpx.RequestError as exc:
            raise HTTPException(status_code=502, detail=f"LangGraph upstream unavailable: {exc}") from exc

    if response.status_code == 404:
        raise LangGraphThreadNotFoundError(f"Thread '{thread_id}' not found")
    if response.status_code == 422:
        raise LangGraphThreadNotReadyError(f"Thread '{thread_id}' state is not ready")
    if not response.is_success:
        raise HTTPException(status_code=502, detail=f"Failed to load thread state ({response.status_code})")

    payload = response.json()
    if not isinstance(payload, dict):
        raise HTTPException(status_code=502, detail="Invalid thread state payload from LangGraph")
    values = payload.get("values", {})
    return values if isinstance(values, dict) else {}


async def update_thread_state(
    thread_id: str,
    values: dict[str, Any],
    *,
    timeout: float = 15.0,
) -> None:
    async with httpx.AsyncClient(timeout=timeout) as client:
        try:
            response = await client.post(
                build_langgraph_upstream_url(f"threads/{thread_id}/state"),
                json={"values": values},
            )
        except httpx.RequestError as exc:
            raise HTTPException(status_code=502, detail=f"LangGraph upstream unavailable: {exc}") from exc

    if response.status_code == 404:
        raise LangGraphThreadNotFoundError(f"Thread '{thread_id}' not found")
    if response.status_code == 422:
        raise LangGraphThreadNotReadyError(f"Thread '{thread_id}' state is not ready")
    if not response.is_success:
        raise HTTPException(status_code=502, detail=f"Failed to persist thread state ({response.status_code})")
