import json
import logging
import os
from typing import Any

import httpx
from langchain.tools import tool

from src.config import get_app_config

logger = logging.getLogger(__name__)

SUPPORTED_PROVIDERS = {"auto", "tavily", "searxng"}
DEFAULT_PROVIDER = "auto"
DEFAULT_MAX_RESULTS = 5
DEFAULT_SEARXNG_TIMEOUT_SECONDS = 10
DEFAULT_PUBLIC_SEARXNG_INSTANCES = [
    "https://search.inetol.net",
    "https://search.abohiccups.com",
    "https://search.wdpserver.com",
]


def _as_string(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    return str(value).strip()


def _as_positive_int(value: Any, default: int) -> int:
    if isinstance(value, int) and value > 0:
        return value
    if isinstance(value, str):
        try:
            parsed = int(value.strip())
            if parsed > 0:
                return parsed
        except Exception:
            pass
    return default


def _split_items(value: Any) -> list[str]:
    if isinstance(value, list):
        items = [item for item in value if isinstance(item, str)]
    elif isinstance(value, str):
        items = value.replace("\n", ",").split(",")
    else:
        return []
    return [item.strip() for item in items if item.strip()]


def _normalize_results(raw_results: list[dict[str, Any]], max_results: int) -> list[dict[str, str]]:
    normalized: list[dict[str, str]] = []
    for item in raw_results:
        title = _as_string(item.get("title") or item.get("name"))
        url = _as_string(item.get("url") or item.get("link") or item.get("href"))
        snippet = _as_string(item.get("content") or item.get("snippet") or item.get("description") or item.get("body"))
        if not url:
            continue
        normalized.append(
            {
                "title": title or url,
                "url": url,
                "snippet": snippet,
            }
        )
        if len(normalized) >= max_results:
            break
    return normalized


def _search_tavily(query: str, max_results: int, api_key: str) -> list[dict[str, str]]:
    if not api_key:
        raise ValueError("missing Tavily api_key")

    from tavily import TavilyClient

    client = TavilyClient(api_key=api_key)
    response = client.search(query, max_results=max_results)
    raw_results = response.get("results") if isinstance(response, dict) else None
    if not isinstance(raw_results, list):
        return []

    return _normalize_results(raw_results, max_results)


def _search_searxng(
    query: str,
    max_results: int,
    candidates: list[str],
    timeout_seconds: int,
    engines: str,
) -> list[dict[str, str]]:
    if not candidates:
        raise ValueError("missing SearXNG candidates")

    params: dict[str, str | int] = {"q": query, "format": "json"}
    if max_results > 0:
        params["count"] = max_results
    if engines:
        params["engines"] = engines

    errors: list[str] = []
    with httpx.Client(timeout=timeout_seconds, follow_redirects=True) as client:
        for base_url in candidates:
            try:
                base = base_url.rstrip("/")
                endpoint = base if base.endswith("/search") else f"{base}/search"
                response = client.get(endpoint, params=params)
                response.raise_for_status()
                content_type = str(response.headers.get("content-type", "")).lower()
                if "json" not in content_type:
                    raise ValueError(f"unexpected content-type: {content_type or 'unknown'}")

                payload = response.json()
                if not isinstance(payload, dict):
                    raise ValueError("unexpected payload")

                raw_results = payload.get("results")
                if not isinstance(raw_results, list):
                    raise ValueError("missing results")

                normalized = _normalize_results(raw_results, max_results)
                if normalized:
                    return normalized
                raise ValueError("no results")
            except Exception as exc:  # noqa: BLE001
                errors.append(f"{base_url}: {exc}")

    raise RuntimeError("; ".join(errors))


def _resolve_searxng_candidates(config_extra: dict[str, Any]) -> list[str]:
    configured_base = _as_string(config_extra.get("searxng_base_url"))
    env_base = _as_string(os.getenv("SEARXNG_BASE_URL"))
    configured_pool = _split_items(config_extra.get("searxng_public_instances"))
    env_pool = _split_items(os.getenv("SEARXNG_PUBLIC_INSTANCES"))

    merged: list[str] = []
    for candidate in [configured_base, env_base, *configured_pool, *env_pool]:
        if candidate and candidate not in merged:
            merged.append(candidate)

    if not merged:
        merged = DEFAULT_PUBLIC_SEARXNG_INSTANCES.copy()
    return merged


def _build_provider_chain(config_extra: dict[str, Any]) -> tuple[list[str], dict[str, Any]]:
    configured_provider = _as_string(config_extra.get("provider")).lower() or DEFAULT_PROVIDER
    if configured_provider not in SUPPORTED_PROVIDERS:
        configured_provider = DEFAULT_PROVIDER

    tavily_api_key = _as_string(config_extra.get("api_key")) or _as_string(os.getenv("TAVILY_API_KEY"))
    searxng_engines = _as_string(config_extra.get("searxng_engines"))
    searxng_timeout = _as_positive_int(config_extra.get("searxng_timeout"), DEFAULT_SEARXNG_TIMEOUT_SECONDS)

    if configured_provider == "auto":
        chain: list[str] = []
        if tavily_api_key:
            chain.append("tavily")
        chain.append("searxng")
    else:
        chain = [configured_provider]

    context = {
        "tavily_api_key": tavily_api_key,
        "searxng_candidates": _resolve_searxng_candidates(config_extra),
        "searxng_engines": searxng_engines,
        "searxng_timeout": searxng_timeout,
        "configured_provider": configured_provider,
    }
    return chain, context


@tool("web_search", parse_docstring=True)
def web_search_tool(query: str) -> str:
    """Search the web.

    Provider selection policy:
    - provider=auto (default): Tavily (if key) -> SearXNG public instances
    - provider=tavily|searxng: force that provider only

    Args:
        query: The query to search for.
    """
    config = get_app_config().get_tool_config("web_search")
    config_extra = config.model_extra if config is not None else {}

    max_results = _as_positive_int(config_extra.get("max_results"), DEFAULT_MAX_RESULTS)
    provider_chain, provider_context = _build_provider_chain(config_extra)

    errors: list[str] = []
    for provider in provider_chain:
        try:
            if provider == "tavily":
                results = _search_tavily(
                    query=query,
                    max_results=max_results,
                    api_key=provider_context["tavily_api_key"],
                )
            elif provider == "searxng":
                results = _search_searxng(
                    query=query,
                    max_results=max_results,
                    candidates=provider_context["searxng_candidates"],
                    timeout_seconds=provider_context["searxng_timeout"],
                    engines=provider_context["searxng_engines"],
                )
            else:
                errors.append(f"{provider}: unsupported provider")
                continue

            if results:
                return json.dumps(results, indent=2, ensure_ascii=False)

            errors.append(f"{provider}: no results")
        except Exception as exc:  # noqa: BLE001
            logger.warning("web_search provider '%s' failed: %s", provider, exc)
            errors.append(f"{provider}: {exc}")

        if provider_context["configured_provider"] != "auto":
            break

    if errors:
        return f"Error: web_search failed ({'; '.join(errors)})"
    return json.dumps([], ensure_ascii=False)
