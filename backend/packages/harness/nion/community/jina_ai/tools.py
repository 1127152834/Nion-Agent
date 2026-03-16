import logging

import requests
from langchain.tools import tool

from nion.community.jina_ai.jina_client import JinaClient
from nion.config import get_app_config
from nion.utils.readability import ReadabilityExtractor

readability_extractor = ReadabilityExtractor()
logger = logging.getLogger(__name__)


def _is_error_payload(content: str) -> bool:
    return content.strip().lower().startswith("error:")


def _article_has_meaningful_content(article) -> bool:
    html_content = getattr(article, "html_content", "")
    if not html_content or not str(html_content).strip():
        return False
    normalized = str(html_content).strip().lower()
    return "no content could be extracted from this page" not in normalized


def _fetch_direct_html(url: str, timeout: int) -> str:
    headers = {
        "User-Agent": ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    }
    response = requests.get(url, headers=headers, timeout=timeout, allow_redirects=True)
    response.raise_for_status()
    if not response.text or not response.text.strip():
        raise ValueError("Direct fetch returned empty content")
    return response.text


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
    jina_client = JinaClient()
    timeout = 10
    api_key = None
    config = get_app_config().get_tool_config("web_fetch")
    if config is not None:
        if "timeout" in config.model_extra:
            timeout = config.model_extra.get("timeout")
        if "api_key" in config.model_extra:
            raw_api_key = config.model_extra.get("api_key")
            if isinstance(raw_api_key, str) and raw_api_key.strip():
                api_key = raw_api_key.strip()

    errors: list[str] = []
    best_effort_markdown: str | None = None

    jina_content = jina_client.crawl(url, return_format="html", timeout=timeout, api_key=api_key)
    if _is_error_payload(jina_content):
        errors.append(f"jina: {jina_content}")
    else:
        try:
            article = readability_extractor.extract_article(jina_content)
            best_effort_markdown = article.to_markdown()[:4096]
            if _article_has_meaningful_content(article):
                return best_effort_markdown
            errors.append("jina: extracted content is empty")
        except Exception as exc:  # noqa: BLE001
            errors.append(f"jina_extract: {exc}")

    try:
        direct_html = _fetch_direct_html(url, timeout=timeout)
        article = readability_extractor.extract_article(direct_html)
        markdown = article.to_markdown()[:4096]
        if _article_has_meaningful_content(article):
            return markdown
        if best_effort_markdown:
            return best_effort_markdown
        errors.append("direct_fetch: extracted content is empty")
    except Exception as exc:  # noqa: BLE001
        logger.warning("Direct web fetch fallback failed for %s: %s", url, exc)
        errors.append(f"direct_fetch: {exc}")

    if best_effort_markdown:
        return best_effort_markdown
    return f"Error: web_fetch failed ({'; '.join(errors)})"
