"""Persistence and query service for RSS feeds/entries."""

import hashlib
import json
import threading
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from src.config.paths import get_paths
from src.database.models.rss import Entry, Feed, ParsedFeedResult, Summary, Translation
from src.services.rss_parser import parse_rss_feed

_LOCK = threading.Lock()


def _now() -> datetime:
    return datetime.now(UTC)


def _stable_id(*parts: str) -> str:
    raw = "::".join(part.strip().lower() for part in parts)
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:24]


def _rss_dir() -> Path:
    path = get_paths().base_dir / "rss"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _feeds_file() -> Path:
    return _rss_dir() / "feeds.json"


def _entries_file() -> Path:
    return _rss_dir() / "entries.json"


def _summaries_file() -> Path:
    return _rss_dir() / "summaries.json"


def _translations_file() -> Path:
    return _rss_dir() / "translations.json"


def _read_json(path: Path, default: dict[str, Any]) -> dict[str, Any]:
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return default


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_suffix(".tmp")
    temp_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    temp_path.replace(path)


def _load_feeds() -> dict[str, Feed]:
    raw = _read_json(_feeds_file(), {})
    return {feed_id: Feed.model_validate(item) for feed_id, item in raw.items()}


def _load_entries() -> dict[str, Entry]:
    raw = _read_json(_entries_file(), {})
    return {entry_id: Entry.model_validate(item) for entry_id, item in raw.items()}


def _save_state(feeds: dict[str, Feed], entries: dict[str, Entry]) -> None:
    _write_json(_feeds_file(), {feed_id: feed.model_dump(mode="json") for feed_id, feed in feeds.items()})
    _write_json(_entries_file(), {entry_id: entry.model_dump(mode="json") for entry_id, entry in entries.items()})


def _load_summaries() -> dict[str, Summary]:
    raw = _read_json(_summaries_file(), {})
    return {entry_id: Summary.model_validate(item) for entry_id, item in raw.items()}


def _save_summaries(summaries: dict[str, Summary]) -> None:
    _write_json(_summaries_file(), {entry_id: summary.model_dump(mode="json") for entry_id, summary in summaries.items()})


def _translation_key(entry_id: str, language: str) -> str:
    return f"{entry_id}::{language.strip().lower()}"


def _load_translations() -> dict[str, Translation]:
    raw = _read_json(_translations_file(), {})
    return {key: Translation.model_validate(item) for key, item in raw.items()}


def _save_translations(translations: dict[str, Translation]) -> None:
    _write_json(_translations_file(), {key: translation.model_dump(mode="json") for key, translation in translations.items()})


def _entry_identity(parsed: ParsedFeedResult, feed_id: str, payload: Any) -> str:
    entry_url = str(payload.url or "").strip()
    if entry_url:
        return _stable_id("entry", feed_id, entry_url)
    return _stable_id("entry", feed_id, payload.title, payload.published_at.isoformat())


def _parse_cursor(cursor: str | None) -> datetime | None:
    if not cursor:
        return None
    normalized = cursor.strip()
    if not normalized:
        return None
    if normalized.endswith("Z"):
        normalized = normalized[:-1] + "+00:00"
    return datetime.fromisoformat(normalized)


def add_feed(url: str, category: str = "general") -> tuple[Feed, int]:
    """Subscribe to a feed and ingest its entries."""

    parsed = parse_rss_feed(url)
    now = _now()

    with _LOCK:
        feeds = _load_feeds()
        entries = _load_entries()

        existing = next((feed for feed in feeds.values() if feed.url == url), None)
        feed_id = existing.id if existing else _stable_id("feed", url)

        feed = Feed(
            id=feed_id,
            title=parsed.title,
            url=parsed.url,
            site_url=parsed.site_url,
            description=parsed.description,
            image=parsed.image,
            category=existing.category if existing else category,
            created_at=existing.created_at if existing else now,
            updated_at=now,
            last_refreshed_at=now,
            entry_count=existing.entry_count if existing else 0,
        )

        imported_entries = 0
        for item in parsed.entries:
            entry_id = _entry_identity(parsed, feed_id, item)
            previous = entries.get(entry_id)
            entries[entry_id] = Entry(
                id=entry_id,
                feed_id=feed_id,
                title=item.title,
                url=item.url,
                content=item.content,
                description=item.description,
                author=item.author,
                published_at=item.published_at,
                read=previous.read if previous else False,
                starred=previous.starred if previous else False,
                created_at=previous.created_at if previous else now,
                updated_at=now,
            )
            if previous is None:
                imported_entries += 1

        feed.entry_count = sum(1 for entry in entries.values() if entry.feed_id == feed_id)
        feeds[feed_id] = feed
        _save_state(feeds, entries)
        return feed, imported_entries


def refresh_feed(feed_id: str) -> tuple[Feed, int]:
    """Refresh a single feed and ingest newly published entries."""

    with _LOCK:
        feeds = _load_feeds()
        feed = feeds.get(feed_id)
        if feed is None:
            raise KeyError(f"Feed not found: {feed_id}")
        refresh_url = feed.url

    return add_feed(refresh_url, category=feed.category)


def list_feeds() -> list[Feed]:
    with _LOCK:
        feeds = list(_load_feeds().values())
    return sorted(feeds, key=lambda item: item.updated_at, reverse=True)


def get_feed(feed_id: str) -> Feed | None:
    with _LOCK:
        return _load_feeds().get(feed_id)


def delete_feed(feed_id: str) -> bool:
    with _LOCK:
        feeds = _load_feeds()
        if feed_id not in feeds:
            return False
        del feeds[feed_id]

        entries = _load_entries()
        entries = {entry_id: entry for entry_id, entry in entries.items() if entry.feed_id != feed_id}
        _save_state(feeds, entries)
        return True


def list_entries(
    *,
    feed_id: str | None = None,
    limit: int = 20,
    cursor: str | None = None,
    unread: bool | None = None,
    starred: bool | None = None,
) -> tuple[list[Entry], str | None]:
    with _LOCK:
        entries = list(_load_entries().values())

    items = entries
    if feed_id:
        items = [item for item in items if item.feed_id == feed_id]
    if unread is not None:
        items = [item for item in items if item.read is (not unread)]
    if starred is not None:
        items = [item for item in items if item.starred is starred]

    cursor_dt = _parse_cursor(cursor)
    if cursor_dt is not None:
        items = [item for item in items if item.published_at < cursor_dt]

    items.sort(key=lambda item: item.published_at, reverse=True)
    page = items[:limit]
    next_cursor = None
    if len(items) > limit and page:
        next_cursor = page[-1].published_at.isoformat().replace("+00:00", "Z")
    return page, next_cursor


def get_entry(entry_id: str) -> Entry | None:
    with _LOCK:
        return _load_entries().get(entry_id)


def update_entry(entry_id: str, *, read: bool | None = None, starred: bool | None = None) -> Entry:
    with _LOCK:
        feeds = _load_feeds()
        entries = _load_entries()
        entry = entries.get(entry_id)
        if entry is None:
            raise KeyError(f"Entry not found: {entry_id}")

        if read is not None:
            entry.read = read
        if starred is not None:
            entry.starred = starred
        entry.updated_at = _now()
        entries[entry_id] = entry

        feed = feeds.get(entry.feed_id)
        if feed:
            feed.updated_at = _now()
            feeds[feed.id] = feed

        _save_state(feeds, entries)
        return entry


def get_summary(entry_id: str) -> Summary | None:
    with _LOCK:
        return _load_summaries().get(entry_id)


def upsert_summary(entry_id: str, summary_text: str) -> Summary:
    with _LOCK:
        summaries = _load_summaries()
        now = _now()
        existing = summaries.get(entry_id)
        summary = Summary(
            id=existing.id if existing else _stable_id("summary", entry_id),
            entry_id=entry_id,
            summary=summary_text.strip(),
            created_at=existing.created_at if existing else now,
            updated_at=now,
        )
        summaries[entry_id] = summary
        _save_summaries(summaries)
        return summary


def get_translation(entry_id: str, language: str) -> Translation | None:
    key = _translation_key(entry_id, language)
    with _LOCK:
        return _load_translations().get(key)


def upsert_translation(entry_id: str, language: str, content: str) -> Translation:
    normalized_language = language.strip().lower()
    key = _translation_key(entry_id, normalized_language)
    with _LOCK:
        translations = _load_translations()
        now = _now()
        existing = translations.get(key)
        translation = Translation(
            id=existing.id if existing else _stable_id("translation", entry_id, normalized_language),
            entry_id=entry_id,
            language=normalized_language,
            content=content.strip(),
            created_at=existing.created_at if existing else now,
            updated_at=now,
        )
        translations[key] = translation
        _save_translations(translations)
        return translation
