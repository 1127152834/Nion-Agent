import json
import logging
import os
from typing import Any

import httpx
from langchain.tools import tool

from nion.community._search_utils import (
    _as_dict,
    _as_positive_int,
    _as_string,
    _dedupe,
    _get_provider_cfg,
    _get_search_settings_payload,
    _safe_exc_message,
    _split_items,
)
from nion.config import get_app_config

logger = logging.getLogger(__name__)

SUPPORTED_PROVIDERS = {"auto", "tavily", "searxng"}
DEFAULT_PROVIDER = "auto"
DEFAULT_MAX_RESULTS = 5
DEFAULT_SEARXNG_TIMEOUT_SECONDS = 10
BUILTIN_WEB_SEARCH_PROVIDER = "searxng_public"
DEFAULT_PUBLIC_SEARXNG_INSTANCES = [
    "https://search.inetol.net",
    "https://search.abohiccups.com",
    "https://search.wdpserver.com",
]


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


def _extract_list(payload: dict[str, Any], paths: list[tuple[str, ...]]) -> list[dict[str, Any]]:
    for path in paths:
        cursor: Any = payload
        for key in path:
            if not isinstance(cursor, dict):
                cursor = None
                break
            cursor = cursor.get(key)
        if isinstance(cursor, list):
            return [item for item in cursor if isinstance(item, dict)]
    return []


def _http_request_json(
    *,
    method: str,
    url: str,
    headers: dict[str, str] | None = None,
    params: dict[str, Any] | None = None,
    json_body: dict[str, Any] | None = None,
    timeout_seconds: int,
) -> dict[str, Any]:
    """Make a JSON HTTP request with safe, user-facing errors (no secrets in messages)."""
    try:
        with httpx.Client(timeout=timeout_seconds, follow_redirects=True) as client:
            response = client.request(method, url, headers=headers, params=params, json=json_body)
    except httpx.TimeoutException as exc:
        raise RuntimeError("timeout") from exc
    except httpx.HTTPError as exc:
        raise RuntimeError(f"network error: {type(exc).__name__}") from exc

    status = int(getattr(response, "status_code", 0) or 0)
    if status in {401, 403}:
        raise RuntimeError("unauthorized (check api_key)")
    if status >= 400:
        raise RuntimeError(f"HTTP {status}")

    try:
        payload = response.json()
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError("invalid json response") from exc
    if not isinstance(payload, dict):
        raise RuntimeError("invalid json response")
    return payload


def _search_brave(query: str, max_results: int, api_key: str, timeout_seconds: int) -> list[dict[str, str]]:
    if not api_key:
        raise ValueError("missing Brave api_key")

    payload = _http_request_json(
        method="GET",
        url="https://api.search.brave.com/res/v1/web/search",
        headers={"Accept": "application/json", "X-Subscription-Token": api_key},
        params={"q": query, "count": max_results},
        timeout_seconds=timeout_seconds,
    )
    raw_results = _extract_list(payload, [("web", "results"), ("results",)])
    return _normalize_results(raw_results, max_results)


def _search_metaso(
    query: str,
    max_results: int,
    api_key: str,
    timeout_seconds: int,
    base_url: str,
) -> list[dict[str, str]]:
    if not api_key:
        raise ValueError("missing MetaSo api_key")

    endpoint_base = (base_url or "https://api.ecn.ai").rstrip("/")
    payload = _http_request_json(
        method="POST",
        url=f"{endpoint_base}/metaso/search",
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
        json_body={
            "q": query,
            "scope": "webpage",
            "includeSummary": True,
            "size": max_results,
        },
        timeout_seconds=timeout_seconds,
    )
    raw_results = _extract_list(payload, [("data", "results"), ("results",), ("data", "items"), ("items",)])
    return _normalize_results(raw_results, max_results)


def _search_serpapi(
    query: str,
    max_results: int,
    api_key: str,
    timeout_seconds: int,
    engine: str,
) -> list[dict[str, str]]:
    if not api_key:
        raise ValueError("missing SerpAPI api_key")

    payload = _http_request_json(
        method="GET",
        url="https://serpapi.com/search.json",
        params={
            "q": query,
            "engine": engine or "google",
            "num": max_results,
            "api_key": api_key,
        },
        timeout_seconds=timeout_seconds,
    )
    raw_results = _extract_list(payload, [("organic_results",)])
    return _normalize_results(raw_results, max_results)


def _search_serper(query: str, max_results: int, api_key: str, timeout_seconds: int) -> list[dict[str, str]]:
    if not api_key:
        raise ValueError("missing Serper api_key")

    payload = _http_request_json(
        method="POST",
        url="https://google.serper.dev/search",
        headers={"Content-Type": "application/json", "X-API-KEY": api_key},
        json_body={"q": query, "num": max_results},
        timeout_seconds=timeout_seconds,
    )
    raw_results = _extract_list(payload, [("organic",)])
    return _normalize_results(raw_results, max_results)


def _search_bing(query: str, max_results: int, api_key: str, timeout_seconds: int) -> list[dict[str, str]]:
    if not api_key:
        raise ValueError("missing Bing api_key")

    payload = _http_request_json(
        method="GET",
        url="https://api.bing.microsoft.com/v7.0/search",
        headers={"Accept": "application/json", "Ocp-Apim-Subscription-Key": api_key},
        params={"q": query, "count": max_results},
        timeout_seconds=timeout_seconds,
    )
    raw_results = _extract_list(payload, [("webPages", "value")])
    return _normalize_results(raw_results, max_results)


def _search_google_cse(
    query: str,
    max_results: int,
    api_key: str,
    timeout_seconds: int,
    cx: str,
) -> list[dict[str, str]]:
    if not api_key:
        raise ValueError("missing Google CSE api_key")
    if not cx:
        raise ValueError("missing Google CSE cx")

    payload = _http_request_json(
        method="GET",
        url="https://www.googleapis.com/customsearch/v1",
        params={"q": query, "num": max_results, "key": api_key, "cx": cx},
        timeout_seconds=timeout_seconds,
    )
    raw_results = _extract_list(payload, [("items",)])
    return _normalize_results(raw_results, max_results)


def _search_firecrawl(
    query: str,
    max_results: int,
    api_key: str,
    timeout_seconds: int,
    base_url: str,
) -> list[dict[str, str]]:
    if not api_key:
        raise ValueError("missing Firecrawl api_key")

    endpoint_base = (base_url or "https://api.firecrawl.dev").rstrip("/")
    payload = _http_request_json(
        method="POST",
        url=f"{endpoint_base}/v1/search",
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
        json_body={"query": query, "limit": max_results},
        timeout_seconds=timeout_seconds,
    )
    if isinstance(payload.get("data"), dict):
        data = payload.get("data")  # type: ignore[assignment]
        if isinstance(data, dict):
            raw_results = _extract_list(data, [("web",), ("results",)])
            if raw_results:
                return _normalize_results(raw_results, max_results)

    raw_results = _extract_list(payload, [("web",), ("results",), ("data", "web"), ("data", "results")])
    return _normalize_results(raw_results, max_results)


def _build_provider_chain_from_search_settings(settings: dict[str, Any]) -> tuple[list[str], dict[str, Any]]:
    web_settings = _as_dict(settings.get("web_search"))
    configured_providers = [_as_string(item).lower() for item in _split_items(web_settings.get("providers"))]
    chain = _dedupe([provider for provider in configured_providers if provider])
    if not chain:
        chain = [BUILTIN_WEB_SEARCH_PROVIDER]
    if BUILTIN_WEB_SEARCH_PROVIDER not in chain:
        chain.append(BUILTIN_WEB_SEARCH_PROVIDER)

    max_results = _as_positive_int(web_settings.get("max_results"), DEFAULT_MAX_RESULTS)
    provider_configs = _as_dict(settings.get("provider_configs"))
    return chain, {"max_results": max_results, "provider_configs": provider_configs}


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
    - If `search_settings.web_search.providers` is configured: try providers in order (with builtin fallback).
    - Otherwise (legacy): provider=auto (default): Tavily (if key) -> SearXNG public instances.

    Args:
        query: The query to search for.
    """
    # Preferred: new consolidated config root.
    search_settings = _get_search_settings_payload()
    if search_settings:
        provider_chain, context = _build_provider_chain_from_search_settings(search_settings)
        max_results = context["max_results"]
        provider_configs = context["provider_configs"]

        errors: list[str] = []
        for provider in provider_chain:
            try:
                timeout_seconds = DEFAULT_SEARXNG_TIMEOUT_SECONDS

                if provider == "tavily":
                    cfg = _get_provider_cfg(provider_configs, "tavily")
                    results = _search_tavily(
                        query=query,
                        max_results=max_results,
                        api_key=_as_string(cfg.get("api_key")),
                    )
                elif provider == "brave":
                    cfg = _get_provider_cfg(provider_configs, "brave")
                    timeout_seconds = _as_positive_int(cfg.get("timeout_seconds"), timeout_seconds)
                    results = _search_brave(
                        query=query,
                        max_results=max_results,
                        api_key=_as_string(cfg.get("api_key")),
                        timeout_seconds=timeout_seconds,
                    )
                elif provider == "metaso":
                    cfg = _get_provider_cfg(provider_configs, "metaso")
                    timeout_seconds = _as_positive_int(cfg.get("timeout_seconds"), timeout_seconds)
                    results = _search_metaso(
                        query=query,
                        max_results=max_results,
                        api_key=_as_string(cfg.get("api_key")),
                        timeout_seconds=timeout_seconds,
                        base_url=_as_string(cfg.get("base_url")),
                    )
                elif provider == "serpapi":
                    cfg = _get_provider_cfg(provider_configs, "serpapi")
                    timeout_seconds = _as_positive_int(cfg.get("timeout_seconds"), timeout_seconds)
                    results = _search_serpapi(
                        query=query,
                        max_results=max_results,
                        api_key=_as_string(cfg.get("api_key")),
                        timeout_seconds=timeout_seconds,
                        engine=_as_string(cfg.get("engine")) or "google",
                    )
                elif provider == "serper":
                    cfg = _get_provider_cfg(provider_configs, "serper")
                    timeout_seconds = _as_positive_int(cfg.get("timeout_seconds"), timeout_seconds)
                    results = _search_serper(
                        query=query,
                        max_results=max_results,
                        api_key=_as_string(cfg.get("api_key")),
                        timeout_seconds=timeout_seconds,
                    )
                elif provider == "bing":
                    cfg = _get_provider_cfg(provider_configs, "bing")
                    timeout_seconds = _as_positive_int(cfg.get("timeout_seconds"), timeout_seconds)
                    results = _search_bing(
                        query=query,
                        max_results=max_results,
                        api_key=_as_string(cfg.get("api_key")),
                        timeout_seconds=timeout_seconds,
                    )
                elif provider == "google_cse":
                    cfg = _get_provider_cfg(provider_configs, "google_cse")
                    timeout_seconds = _as_positive_int(cfg.get("timeout_seconds"), timeout_seconds)
                    results = _search_google_cse(
                        query=query,
                        max_results=max_results,
                        api_key=_as_string(cfg.get("api_key")),
                        timeout_seconds=timeout_seconds,
                        cx=_as_string(cfg.get("cx")),
                    )
                elif provider == "firecrawl":
                    cfg = _get_provider_cfg(provider_configs, "firecrawl")
                    timeout_seconds = _as_positive_int(cfg.get("timeout_seconds"), timeout_seconds)
                    results = _search_firecrawl(
                        query=query,
                        max_results=max_results,
                        api_key=_as_string(cfg.get("api_key")),
                        timeout_seconds=timeout_seconds,
                        base_url=_as_string(cfg.get("base_url")),
                    )
                elif provider == "searxng_custom":
                    cfg = _get_provider_cfg(provider_configs, "searxng_custom")
                    base_url = _as_string(cfg.get("base_url"))
                    pool = _split_items(cfg.get("public_instances"))
                    candidates = _dedupe([item for item in [base_url, *pool] if item])
                    timeout_seconds = _as_positive_int(cfg.get("timeout_seconds"), timeout_seconds)
                    results = _search_searxng(
                        query=query,
                        max_results=max_results,
                        candidates=candidates,
                        timeout_seconds=timeout_seconds,
                        engines=_as_string(cfg.get("engines")),
                    )
                elif provider == BUILTIN_WEB_SEARCH_PROVIDER:
                    results = _search_searxng(
                        query=query,
                        max_results=max_results,
                        candidates=DEFAULT_PUBLIC_SEARXNG_INSTANCES.copy(),
                        timeout_seconds=DEFAULT_SEARXNG_TIMEOUT_SECONDS,
                        engines="",
                    )
                else:
                    errors.append(f"{provider}: unsupported provider")
                    continue

                if results:
                    return json.dumps(results, indent=2, ensure_ascii=False)
                errors.append(f"{provider}: no results")
            except Exception as exc:  # noqa: BLE001
                message = _safe_exc_message(exc)
                logger.warning("web_search provider '%s' failed: %s", provider, message)
                errors.append(f"{provider}: {message}")

        if errors:
            return f"Error: web_search failed ({'; '.join(errors)})"
        return json.dumps([], ensure_ascii=False)

    # Fallback: legacy tool config behaviour.
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
