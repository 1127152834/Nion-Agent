import logging
from typing import Any

import httpx
from langchain.tools import tool

from src.community._search_utils import (
    _as_dict,
    _as_positive_int,
    _as_string,
    _dedupe,
    _get_provider_cfg,
    _get_search_settings_payload,
    _safe_exc_message,
    _split_items,
)
from src.community.jina_ai.jina_client import JinaClient
from src.config import get_app_config
from src.utils.readability import ReadabilityExtractor

logger = logging.getLogger(__name__)

DEFAULT_TIMEOUT_SECONDS = 10
BUILTIN_WEB_FETCH_PROVIDER = "direct"

readability_extractor = ReadabilityExtractor()


def _fetch_direct_html(url: str, timeout_seconds: int) -> str:
    headers = {
        "User-Agent": ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    }
    try:
        with httpx.Client(timeout=timeout_seconds, follow_redirects=True) as client:
            response = client.get(url, headers=headers)
    except httpx.TimeoutException as exc:
        raise RuntimeError("timeout") from exc
    except httpx.HTTPError as exc:
        raise RuntimeError(f"network error: {type(exc).__name__}") from exc

    status = int(getattr(response, "status_code", 0) or 0)
    if status >= 400:
        raise RuntimeError(f"HTTP {status}")
    html = response.text or ""
    if not html.strip():
        raise RuntimeError("direct fetch returned empty content")
    return html


def _is_error_payload(content: str) -> bool:
    return content.strip().lower().startswith("error:")


def _article_has_meaningful_content(article) -> bool:
    html_content = getattr(article, "html_content", "")
    if not html_content or not str(html_content).strip():
        return False
    normalized = str(html_content).strip().lower()
    return "no content could be extracted from this page" not in normalized


def _markdown_from_html(html: str) -> tuple[str, bool]:
    article = readability_extractor.extract_article(html)
    markdown = article.to_markdown()[:4096]
    return markdown, _article_has_meaningful_content(article)


def _build_web_fetch_chain_from_search_settings(settings: dict[str, Any]) -> tuple[list[str], int, dict[str, Any]]:
    web_settings = _as_dict(settings.get("web_fetch"))
    providers = [_as_string(item).lower() for item in _split_items(web_settings.get("providers"))]
    chain = _dedupe([provider for provider in providers if provider])
    if not chain:
        chain = ["jina"]
    if BUILTIN_WEB_FETCH_PROVIDER not in chain:
        chain.append(BUILTIN_WEB_FETCH_PROVIDER)
    timeout_seconds = _as_positive_int(web_settings.get("timeout_seconds"), DEFAULT_TIMEOUT_SECONDS)
    provider_configs = _as_dict(settings.get("provider_configs"))
    return chain, timeout_seconds, provider_configs


def _build_web_fetch_chain_legacy() -> tuple[list[str], int, dict[str, Any]]:
    config = get_app_config().get_tool_config("web_fetch")
    extra = config.model_extra if config is not None else {}
    timeout_seconds = _as_positive_int(extra.get("timeout"), DEFAULT_TIMEOUT_SECONDS)
    api_key = _as_string(extra.get("api_key"))
    provider_configs: dict[str, Any] = {}
    if api_key:
        provider_configs["jina"] = {"api_key": api_key}
    return _dedupe(["jina", BUILTIN_WEB_FETCH_PROVIDER]), timeout_seconds, provider_configs


def _fetch_firecrawl_scrape(
    url: str,
    *,
    timeout_seconds: int,
    api_key: str,
    base_url: str,
) -> str:
    if not api_key:
        raise ValueError("missing Firecrawl api_key")

    endpoint_base = (base_url or "https://api.firecrawl.dev").rstrip("/")
    try:
        with httpx.Client(timeout=timeout_seconds, follow_redirects=True) as client:
            response = client.post(
                f"{endpoint_base}/v1/scrape",
                headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
                json={"url": url, "formats": ["markdown"]},
            )
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

    data = payload.get("data") if isinstance(payload.get("data"), dict) else payload
    if not isinstance(data, dict):
        raise RuntimeError("invalid payload")

    markdown = _as_string(data.get("markdown") or data.get("content"))
    if not markdown:
        raise RuntimeError("no content")

    title = ""
    metadata = data.get("metadata")
    if isinstance(metadata, dict):
        title = _as_string(metadata.get("title"))
    markdown = markdown[:4096]
    if title and not markdown.lstrip().startswith("#"):
        markdown = f"# {title}\n\n{markdown}"
    return markdown[:4096]


def _fetch_browserless_html(
    url: str,
    *,
    timeout_seconds: int,
    api_key: str,
    base_url: str,
) -> str:
    if not api_key:
        raise ValueError("missing Browserless api_key")

    endpoint_base = (base_url or "https://chrome.browserless.io").rstrip("/")
    endpoint = f"{endpoint_base}/content"
    try:
        with httpx.Client(timeout=timeout_seconds, follow_redirects=True) as client:
            response = client.post(endpoint, params={"token": api_key}, json={"url": url})
    except httpx.TimeoutException as exc:
        raise RuntimeError("timeout") from exc
    except httpx.HTTPError as exc:
        raise RuntimeError(f"network error: {type(exc).__name__}") from exc

    status = int(getattr(response, "status_code", 0) or 0)
    if status in {401, 403}:
        raise RuntimeError("unauthorized (check api_key)")
    if status >= 400:
        raise RuntimeError(f"HTTP {status}")

    html = response.text or ""
    if not html.strip():
        raise RuntimeError("empty response")
    return html


@tool("web_fetch", parse_docstring=True)
def web_fetch_tool(url: str) -> str:
    """Fetch the contents of a web page at a given URL.
    Only fetch EXACT URLs that have been provided directly by the user or have been returned in results from the web_search and web_fetch tools.
    This tool can NOT access content that requires authentication, such as private Google Docs or pages behind login walls.
    Do NOT add www. to URLs that do NOT have them.
    URLs must include the schema: https://example.com is a valid URL while example.com is an invalid URL.

    Args:
        url: The URL to fetch the contents of.
    """
    search_settings = _get_search_settings_payload()
    if search_settings:
        provider_chain, timeout_seconds, provider_configs = _build_web_fetch_chain_from_search_settings(search_settings)
    else:
        provider_chain, timeout_seconds, provider_configs = _build_web_fetch_chain_legacy()

    errors: list[str] = []
    best_effort_markdown: str | None = None

    for provider in provider_chain:
        try:
            if provider == "jina":
                cfg = _get_provider_cfg(provider_configs, "jina")
                provider_timeout = _as_positive_int(cfg.get("timeout_seconds"), timeout_seconds)
                api_key = _as_string(cfg.get("api_key"))
                html = JinaClient().crawl(url, return_format="html", timeout=provider_timeout, api_key=api_key or None)
                if _is_error_payload(html):
                    raise RuntimeError("jina provider error")
                markdown, ok = _markdown_from_html(html)
                if markdown and best_effort_markdown is None:
                    best_effort_markdown = markdown
                if ok:
                    return markdown
                raise RuntimeError("jina extracted content is empty")

            if provider == "firecrawl_scrape":
                cfg = _get_provider_cfg(provider_configs, "firecrawl")
                markdown = _fetch_firecrawl_scrape(
                    url,
                    timeout_seconds=timeout_seconds,
                    api_key=_as_string(cfg.get("api_key")),
                    base_url=_as_string(cfg.get("base_url")),
                )
                if markdown.strip():
                    return markdown[:4096]
                raise RuntimeError("firecrawl returned empty content")

            if provider == "browserless":
                cfg = _get_provider_cfg(provider_configs, "browserless")
                html = _fetch_browserless_html(
                    url,
                    timeout_seconds=timeout_seconds,
                    api_key=_as_string(cfg.get("api_key")),
                    base_url=_as_string(cfg.get("base_url")),
                )
                markdown, ok = _markdown_from_html(html)
                if markdown and best_effort_markdown is None:
                    best_effort_markdown = markdown
                if ok:
                    return markdown
                raise RuntimeError("browserless extracted content is empty")

            if provider == BUILTIN_WEB_FETCH_PROVIDER:
                html = _fetch_direct_html(url, timeout_seconds=timeout_seconds)
                markdown, ok = _markdown_from_html(html)
                if ok:
                    return markdown
                if best_effort_markdown:
                    return best_effort_markdown
                raise RuntimeError("direct fetch extracted content is empty")

            errors.append(f"{provider}: unsupported provider")
        except Exception as exc:  # noqa: BLE001
            message = _safe_exc_message(exc)
            logger.warning("web_fetch provider '%s' failed: %s", provider, message)
            errors.append(f"{provider}: {message}")

    if best_effort_markdown:
        return best_effort_markdown
    return f"Error: web_fetch failed ({'; '.join(errors)})"
