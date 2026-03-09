"""RSS parsing service."""

from datetime import UTC, datetime
from time import struct_time
from typing import Any

import feedparser

from src.database.models.rss import ParsedEntry, ParsedFeedResult


class RSSParseError(ValueError):
    """Raised when RSS parsing fails or produces unusable data."""


def _read_attr(obj: Any, key: str, default: Any = None) -> Any:
    if isinstance(obj, dict):
        return obj.get(key, default)
    return getattr(obj, key, default)


def _to_datetime(value: struct_time | tuple | list | datetime | None) -> datetime:
    if isinstance(value, datetime):
        return value if value.tzinfo is not None else value.replace(tzinfo=UTC)
    if isinstance(value, struct_time):
        return datetime(*value[:6], tzinfo=UTC)
    if isinstance(value, (tuple, list)) and len(value) >= 6:
        return datetime(*value[:6], tzinfo=UTC)
    return datetime.now(UTC)


def _entry_content(entry: Any) -> str:
    content = _read_attr(entry, "content")
    if isinstance(content, list) and content:
        first = content[0]
        if isinstance(first, dict):
            return str(first.get("value") or "").strip()
        value = _read_attr(first, "value", "")
        return str(value or "").strip()

    if isinstance(content, dict):
        return str(content.get("value") or "").strip()

    return ""


def _entry_description(entry: Any) -> str:
    summary = _read_attr(entry, "summary", "")
    if summary:
        return str(summary).strip()

    description = _read_attr(entry, "description", "")
    return str(description).strip()


def parse_rss_feed(url: str) -> ParsedFeedResult:
    """Parse an RSS/Atom feed URL."""

    parsed = feedparser.parse(url)
    feed = _read_attr(parsed, "feed", {})
    entries = _read_attr(parsed, "entries", []) or []

    title = str(_read_attr(feed, "title", "") or "").strip()
    if not title:
        raise RSSParseError("Feed title is missing or empty.")

    site_url = _read_attr(feed, "link")
    description = _read_attr(feed, "description", "")

    image = None
    image_obj = _read_attr(feed, "image")
    if image_obj:
        image = _read_attr(image_obj, "href") or _read_attr(image_obj, "url")

    parsed_entries: list[ParsedEntry] = []
    for item in entries:
        entry_url = str(_read_attr(item, "link", "") or "").strip()
        entry_title = str(_read_attr(item, "title", "") or "").strip() or entry_url
        if not entry_title:
            continue

        published_raw = _read_attr(item, "published_parsed") or _read_attr(item, "updated_parsed")
        parsed_entries.append(
            ParsedEntry(
                title=entry_title,
                url=entry_url or f"{url}#{len(parsed_entries)}",
                content=_entry_content(item),
                description=_entry_description(item),
                author=_read_attr(item, "author"),
                published_at=_to_datetime(published_raw),
            )
        )

    if not parsed_entries:
        raise RSSParseError("Feed parsed successfully but contains no entries.")

    return ParsedFeedResult(
        title=title,
        url=url,
        site_url=str(site_url).strip() if site_url else None,
        description=str(description).strip() if description else None,
        image=str(image).strip() if image else None,
        entries=parsed_entries,
    )
