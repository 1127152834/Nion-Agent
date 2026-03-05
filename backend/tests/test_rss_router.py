from datetime import UTC, datetime, timedelta
from unittest.mock import patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.config.paths import Paths
from src.database.models.rss import ParsedEntry, ParsedFeedResult
from src.gateway.routers.rss import router


def _make_app() -> FastAPI:
    app = FastAPI()
    app.include_router(router)
    return app


def _parsed_feed(url: str, entry_specs: list[tuple[str, str, datetime]]) -> ParsedFeedResult:
    return ParsedFeedResult(
        title="Demo Feed",
        url=url,
        site_url="https://demo.example.com",
        description="Demo description",
        image=None,
        entries=[
            ParsedEntry(
                title=title,
                url=entry_url,
                content=f"<p>{title}</p>",
                description=f"{title} summary",
                author="demo",
                published_at=published_at,
            )
            for title, entry_url, published_at in entry_specs
        ],
    )


@pytest.fixture()
def rss_client(tmp_path):
    app = _make_app()
    paths = Paths(base_dir=tmp_path)
    with patch("src.services.rss_store.get_paths", return_value=paths):
        with TestClient(app) as client:
            yield client


def test_add_feed_and_entry_lifecycle(rss_client):
    now = datetime(2026, 3, 5, 12, 0, tzinfo=UTC)
    parsed = _parsed_feed(
        "https://example.com/feed.xml",
        [
            ("Entry 1", "https://example.com/1", now),
            ("Entry 2", "https://example.com/2", now - timedelta(hours=1)),
        ],
    )

    with patch("src.services.rss_store.parse_rss_feed", return_value=parsed):
        add_resp = rss_client.post(
            "/api/rss/feeds",
            json={"url": "https://example.com/feed.xml", "category": "tech"},
        )

    assert add_resp.status_code == 201
    add_data = add_resp.json()
    assert add_data["imported_entries"] == 2
    feed_id = add_data["feed"]["id"]

    feeds_resp = rss_client.get("/api/rss/feeds")
    assert feeds_resp.status_code == 200
    assert len(feeds_resp.json()["feeds"]) == 1

    entries_resp = rss_client.get("/api/rss/entries", params={"feed_id": feed_id})
    assert entries_resp.status_code == 200
    entries = entries_resp.json()["entries"]
    assert len(entries) == 2
    assert entries[0]["title"] == "Entry 1"

    entry_id = entries[0]["id"]
    update_resp = rss_client.put(f"/api/rss/entries/{entry_id}", json={"read": True, "starred": True})
    assert update_resp.status_code == 200
    assert update_resp.json()["read"] is True
    assert update_resp.json()["starred"] is True

    get_entry_resp = rss_client.get(f"/api/rss/entries/{entry_id}")
    assert get_entry_resp.status_code == 200
    assert get_entry_resp.json()["read"] is True

    delete_resp = rss_client.delete(f"/api/rss/feeds/{feed_id}")
    assert delete_resp.status_code == 204
    assert rss_client.get(f"/api/rss/feeds/{feed_id}").status_code == 404


def test_refresh_feed_imports_only_new_entries(rss_client):
    now = datetime(2026, 3, 5, 15, 0, tzinfo=UTC)
    first = _parsed_feed(
        "https://example.com/feed.xml",
        [("Old Entry", "https://example.com/old", now - timedelta(hours=2))],
    )
    second = _parsed_feed(
        "https://example.com/feed.xml",
        [
            ("Old Entry", "https://example.com/old", now - timedelta(hours=2)),
            ("New Entry", "https://example.com/new", now),
        ],
    )

    with patch("src.services.rss_store.parse_rss_feed", side_effect=[first, second]):
        add_resp = rss_client.post("/api/rss/feeds", json={"url": "https://example.com/feed.xml"})
        feed_id = add_resp.json()["feed"]["id"]
        refresh_resp = rss_client.post(f"/api/rss/feeds/{feed_id}/refresh")

    assert refresh_resp.status_code == 200
    assert refresh_resp.json()["imported_entries"] == 1

    entries_resp = rss_client.get("/api/rss/entries", params={"feed_id": feed_id})
    entries = entries_resp.json()["entries"]
    assert [entry["title"] for entry in entries] == ["New Entry", "Old Entry"]
