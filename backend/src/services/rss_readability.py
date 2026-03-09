"""RSS readability extraction service."""

from __future__ import annotations

import requests

from src.utils.readability import ReadabilityExtractor

_extractor = ReadabilityExtractor()


class RSSReadabilityError(ValueError):
    """Raised when readability extraction for an RSS entry fails."""


def _fetch_html(url: str, timeout: int = 15) -> str:
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        ),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    }
    response = requests.get(
        url,
        headers=headers,
        timeout=timeout,
        allow_redirects=True,
    )
    response.raise_for_status()
    html = response.text.strip()
    if not html:
        raise RSSReadabilityError("Source page returned empty content.")
    return html


def extract_entry_content(url: str, timeout: int = 15) -> str:
    """Fetch and extract readable HTML content from an entry URL."""
    normalized_url = url.strip()
    if not normalized_url:
        raise RSSReadabilityError("Entry source URL is empty.")

    try:
        html = _fetch_html(normalized_url, timeout=timeout)
    except requests.RequestException as exc:
        raise RSSReadabilityError(f"Failed to fetch source webpage: {exc}") from exc

    try:
        article = _extractor.extract_article(html)
    except Exception as exc:  # noqa: BLE001
        raise RSSReadabilityError(f"Failed to extract readable content: {exc}") from exc

    content = str(getattr(article, "html_content", "") or "").strip()
    if not content:
        raise RSSReadabilityError("No readable content extracted from source page.")

    lowered = content.lower()
    if "no content could be extracted from this page" in lowered:
        raise RSSReadabilityError("No readable content extracted from source page.")

    return content
