"""Tools-related gateway APIs."""

from __future__ import annotations

from typing import Literal

import httpx
from fastapi import APIRouter
from pydantic import BaseModel, Field

from src.community.web_search.tools import DEFAULT_PUBLIC_SEARXNG_INSTANCES

router = APIRouter(prefix="/api/tools", tags=["tools"])


class WebProviderTestRequest(BaseModel):
    provider: Literal[
        "tavily",
        "jina",
        "searxng",
        "brave",
        "metaso",
        "serpapi",
        "serper",
        "bing",
        "google_cse",
        "firecrawl",
        "browserless",
    ]
    api_key: str | None = None
    base_url: str | None = None
    cx: str | None = None
    engine: str | None = None
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

    def _missing(field_name: str) -> dict:
        return _error("tool_field_missing", f"Missing required field: {field_name}")

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
                return _error("tool_api_key_invalid", "Unauthorized (check API key)")
            return _error("tool_provider_unreachable", f"Request failed: {type(exc).__name__}")

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
                return _error("tool_api_key_invalid", "Unauthorized (check API key)")
            if response.status_code >= 400:
                return _error(
                    "tool_provider_unreachable",
                    f"Jina returned HTTP {response.status_code}",
                )
            return _ok("Jina provider is reachable")
        except Exception as exc:  # noqa: BLE001
            return _error("tool_provider_unreachable", str(exc))

    if provider == "brave":
        if not (payload.api_key or "").strip():
            return _error("tool_api_key_missing", "Brave API key is required")
        try:
            with httpx.Client(timeout=payload.timeout_seconds, follow_redirects=True) as client:
                response = client.get(
                    "https://api.search.brave.com/res/v1/web/search",
                    headers={"Accept": "application/json", "X-Subscription-Token": payload.api_key},
                    params={"q": "hello", "count": 1},
                )
            if response.status_code in {401, 403}:
                return _error("tool_api_key_invalid", "Unauthorized (check API key)")
            if response.status_code >= 400:
                return _error("tool_provider_unreachable", f"Brave returned HTTP {response.status_code}")
            return _ok("Brave provider is reachable")
        except Exception as exc:  # noqa: BLE001
            return _error("tool_provider_unreachable", f"Request failed: {type(exc).__name__}")

    if provider == "metaso":
        if not (payload.api_key or "").strip():
            return _error("tool_api_key_missing", "MetaSo API key is required")
        endpoint_base = (payload.base_url or "https://api.ecn.ai").rstrip("/")
        try:
            with httpx.Client(timeout=payload.timeout_seconds, follow_redirects=True) as client:
                response = client.post(
                    f"{endpoint_base}/metaso/search",
                    headers={"Content-Type": "application/json", "Authorization": f"Bearer {payload.api_key}"},
                    json={"q": "hello", "scope": "webpage", "includeSummary": True, "size": 1},
                )
            if response.status_code in {401, 403}:
                return _error("tool_api_key_invalid", "Unauthorized (check API key)")
            if response.status_code >= 400:
                return _error("tool_provider_unreachable", f"MetaSo returned HTTP {response.status_code}")
            return _ok("MetaSo provider is reachable")
        except Exception as exc:  # noqa: BLE001
            return _error("tool_provider_unreachable", f"Request failed: {type(exc).__name__}")

    if provider == "serpapi":
        if not (payload.api_key or "").strip():
            return _error("tool_api_key_missing", "SerpAPI api_key is required")
        engine = (payload.engine or "google").strip() or "google"
        try:
            with httpx.Client(timeout=payload.timeout_seconds, follow_redirects=True) as client:
                response = client.get(
                    "https://serpapi.com/search.json",
                    params={"q": "hello", "engine": engine, "num": 1, "api_key": payload.api_key},
                )
            if response.status_code in {401, 403}:
                return _error("tool_api_key_invalid", "Unauthorized (check API key)")
            if response.status_code >= 400:
                return _error("tool_provider_unreachable", f"SerpAPI returned HTTP {response.status_code}")
            return _ok("SerpAPI provider is reachable")
        except Exception as exc:  # noqa: BLE001
            return _error("tool_provider_unreachable", f"Request failed: {type(exc).__name__}")

    if provider == "serper":
        if not (payload.api_key or "").strip():
            return _error("tool_api_key_missing", "Serper API key is required")
        try:
            with httpx.Client(timeout=payload.timeout_seconds, follow_redirects=True) as client:
                response = client.post(
                    "https://google.serper.dev/search",
                    headers={"Content-Type": "application/json", "X-API-KEY": payload.api_key},
                    json={"q": "hello", "num": 1},
                )
            if response.status_code in {401, 403}:
                return _error("tool_api_key_invalid", "Unauthorized (check API key)")
            if response.status_code >= 400:
                return _error("tool_provider_unreachable", f"Serper returned HTTP {response.status_code}")
            return _ok("Serper provider is reachable")
        except Exception as exc:  # noqa: BLE001
            return _error("tool_provider_unreachable", f"Request failed: {type(exc).__name__}")

    if provider == "bing":
        if not (payload.api_key or "").strip():
            return _error("tool_api_key_missing", "Bing API key is required")
        try:
            with httpx.Client(timeout=payload.timeout_seconds, follow_redirects=True) as client:
                response = client.get(
                    "https://api.bing.microsoft.com/v7.0/search",
                    headers={"Accept": "application/json", "Ocp-Apim-Subscription-Key": payload.api_key},
                    params={"q": "hello", "count": 1},
                )
            if response.status_code in {401, 403}:
                return _error("tool_api_key_invalid", "Unauthorized (check API key)")
            if response.status_code >= 400:
                return _error("tool_provider_unreachable", f"Bing returned HTTP {response.status_code}")
            return _ok("Bing provider is reachable")
        except Exception as exc:  # noqa: BLE001
            return _error("tool_provider_unreachable", f"Request failed: {type(exc).__name__}")

    if provider == "google_cse":
        if not (payload.api_key or "").strip():
            return _error("tool_api_key_missing", "Google CSE api_key is required")
        if not (payload.cx or "").strip():
            return _missing("cx")
        try:
            with httpx.Client(timeout=payload.timeout_seconds, follow_redirects=True) as client:
                response = client.get(
                    "https://www.googleapis.com/customsearch/v1",
                    params={"q": "hello", "num": 1, "key": payload.api_key, "cx": payload.cx},
                )
            if response.status_code in {401, 403}:
                return _error("tool_api_key_invalid", "Unauthorized (check API key)")
            if response.status_code >= 400:
                return _error("tool_provider_unreachable", f"Google CSE returned HTTP {response.status_code}")
            return _ok("Google CSE provider is reachable")
        except Exception as exc:  # noqa: BLE001
            return _error("tool_provider_unreachable", f"Request failed: {type(exc).__name__}")

    if provider == "firecrawl":
        if not (payload.api_key or "").strip():
            return _error("tool_api_key_missing", "Firecrawl API key is required")
        endpoint_base = (payload.base_url or "https://api.firecrawl.dev").rstrip("/")
        try:
            with httpx.Client(timeout=payload.timeout_seconds, follow_redirects=True) as client:
                response = client.post(
                    f"{endpoint_base}/v1/scrape",
                    headers={"Content-Type": "application/json", "Authorization": f"Bearer {payload.api_key}"},
                    json={"url": "https://example.com", "formats": ["markdown"]},
                )
            if response.status_code in {401, 403}:
                return _error("tool_api_key_invalid", "Unauthorized (check API key)")
            if response.status_code >= 400:
                return _error("tool_provider_unreachable", f"Firecrawl returned HTTP {response.status_code}")
            return _ok("Firecrawl provider is reachable")
        except Exception as exc:  # noqa: BLE001
            return _error("tool_provider_unreachable", f"Request failed: {type(exc).__name__}")

    if provider == "browserless":
        if not (payload.api_key or "").strip():
            return _error("tool_api_key_missing", "Browserless API key is required")
        endpoint_base = (payload.base_url or "https://chrome.browserless.io").rstrip("/")
        try:
            with httpx.Client(timeout=payload.timeout_seconds, follow_redirects=True) as client:
                response = client.post(
                    f"{endpoint_base}/content",
                    params={"token": payload.api_key},
                    json={"url": "https://example.com"},
                )
            if response.status_code in {401, 403}:
                return _error("tool_api_key_invalid", "Unauthorized (check API key)")
            if response.status_code >= 400:
                return _error("tool_provider_unreachable", f"Browserless returned HTTP {response.status_code}")
            return _ok("Browserless provider is reachable")
        except Exception as exc:  # noqa: BLE001
            return _error("tool_provider_unreachable", f"Request failed: {type(exc).__name__}")

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
