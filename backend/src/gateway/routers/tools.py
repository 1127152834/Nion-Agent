"""Tools-related gateway APIs."""

from __future__ import annotations

from typing import Literal

import httpx
from fastapi import APIRouter
from pydantic import BaseModel, Field

from src.community.web_search.tools import DEFAULT_PUBLIC_SEARXNG_INSTANCES

router = APIRouter(prefix="/api/tools", tags=["tools"])


class WebProviderTestRequest(BaseModel):
    provider: Literal["tavily", "jina", "searxng"]
    api_key: str | None = None
    base_url: str | None = None
    max_results: int = Field(default=1, ge=1, le=10)
    timeout_seconds: int = Field(default=10, ge=1, le=60)


def _ok(message: str) -> dict:
    return {
        "status": "ok",
        "result": {
            "message": message,
        },
    }


def _error(error_code: str, message: str) -> dict:
    return {
        "status": "degraded",
        "error_code": error_code,
        "result": {
            "message": message,
        },
    }


@router.post("/test-web-provider")
async def test_web_provider(payload: WebProviderTestRequest) -> dict:
    """Probe web provider connectivity for settings UI."""
    provider = payload.provider

    if provider == "tavily":
        if not (payload.api_key or "").strip():
            return _error("tool_api_key_missing", "Tavily API key is required")
        try:
            from tavily import TavilyClient

            client = TavilyClient(api_key=payload.api_key)
            client.search("hello", max_results=1)
            return _ok("Tavily key is valid")
        except Exception as exc:  # noqa: BLE001
            message = str(exc)
            lowered = message.lower()
            if "unauthorized" in lowered or "invalid" in lowered or "forbidden" in lowered:
                return _error("tool_api_key_invalid", message)
            return _error("tool_provider_unreachable", message)

    if provider == "jina":
        url = "https://r.jina.ai/"
        headers = {
            "Content-Type": "application/json",
            "X-Return-Format": "text",
            "X-Timeout": str(payload.timeout_seconds),
        }
        if payload.api_key:
            headers["Authorization"] = f"Bearer {payload.api_key}"

        try:
            with httpx.Client(timeout=payload.timeout_seconds, follow_redirects=True) as client:
                response = client.post(url, headers=headers, json={"url": "https://example.com"})

            if response.status_code in {401, 403}:
                return _error("tool_api_key_invalid", response.text or "Unauthorized")
            if response.status_code >= 400:
                return _error(
                    "tool_provider_unreachable",
                    f"Jina returned HTTP {response.status_code}",
                )
            return _ok("Jina provider is reachable")
        except Exception as exc:  # noqa: BLE001
            return _error("tool_provider_unreachable", str(exc))

    if provider == "searxng":
        base_url = (payload.base_url or "").strip()
        candidates = [base_url] if base_url else DEFAULT_PUBLIC_SEARXNG_INSTANCES
        errors: list[str] = []
        try:
            with httpx.Client(timeout=payload.timeout_seconds, follow_redirects=True) as client:
                for candidate in candidates:
                    try:
                        endpoint_base = candidate.rstrip("/")
                        endpoint = endpoint_base if endpoint_base.endswith("/search") else f"{endpoint_base}/search"
                        response = client.get(endpoint, params={"q": "hello", "format": "json", "count": 1})
                        response.raise_for_status()
                        content_type = str(response.headers.get("content-type", "")).lower()
                        if "json" not in content_type:
                            raise ValueError(f"Unexpected content-type: {content_type or 'unknown'}")
                        body = response.json()
                        if not isinstance(body, dict):
                            raise ValueError("Unexpected SearXNG response")
                        return _ok(f"SearXNG provider is reachable: {candidate}")
                    except Exception as candidate_error:  # noqa: BLE001
                        errors.append(f"{candidate}: {candidate_error}")
        except Exception as exc:  # noqa: BLE001
            errors.append(str(exc))
        return _error("tool_provider_unreachable", "; ".join(errors))

    return _error("tool_provider_unsupported", f"Unsupported provider: {provider}")
