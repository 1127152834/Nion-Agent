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


def test_summarize_and_translate_entry_with_cache(rss_client):
    now = datetime(2026, 3, 5, 15, 0, tzinfo=UTC)
    parsed = _parsed_feed(
        "https://example.com/feed.xml",
        [("AI Entry", "https://example.com/ai", now)],
    )

    with patch("src.services.rss_store.parse_rss_feed", return_value=parsed):
        add_resp = rss_client.post("/api/rss/feeds", json={"url": "https://example.com/feed.xml"})
        feed_id = add_resp.json()["feed"]["id"]

    entries_resp = rss_client.get("/api/rss/entries", params={"feed_id": feed_id})
    entry_id = entries_resp.json()["entries"][0]["id"]

    with patch("src.gateway.routers.rss.rss_ai.summarize_entry_content", return_value="summary v1") as summarize_mock:
        first_summary = rss_client.post(f"/api/rss/entries/{entry_id}/summarize")
        second_summary = rss_client.post(f"/api/rss/entries/{entry_id}/summarize")

    assert first_summary.status_code == 200
    assert first_summary.json() == {
        "entry_id": entry_id,
        "summary": "summary v1",
        "cached": False,
    }
    assert second_summary.status_code == 200
    assert second_summary.json() == {
        "entry_id": entry_id,
        "summary": "summary v1",
        "cached": True,
    }
    summarize_mock.assert_called_once()

    with patch("src.gateway.routers.rss.rss_ai.translate_entry_content", return_value="translation v1") as translate_mock:
        first_translation = rss_client.post(
            f"/api/rss/entries/{entry_id}/translate",
            json={"target_language": "zh-CN"},
        )
        second_translation = rss_client.post(
            f"/api/rss/entries/{entry_id}/translate",
            json={"target_language": "zh-CN"},
        )

    assert first_translation.status_code == 200
    assert first_translation.json() == {
        "entry_id": entry_id,
        "language": "zh-cn",
        "content": "translation v1",
        "cached": False,
    }
    assert second_translation.status_code == 200
    assert second_translation.json() == {
        "entry_id": entry_id,
        "language": "zh-cn",
        "content": "translation v1",
        "cached": True,
    }
    translate_mock.assert_called_once()


def test_discover_sources_support_keyword_and_category(rss_client):
    response = rss_client.get("/api/rss/discover/sources")
    assert response.status_code == 200
    payload = response.json()
    assert payload["sources"]
    assert payload["categories"]

    programming_response = rss_client.get(
        "/api/rss/discover/sources",
        params={"category": "programming"},
    )
    assert programming_response.status_code == 200
    programming_payload = programming_response.json()
    assert programming_payload["sources"]
    assert all(item["category"] == "programming" for item in programming_payload["sources"])

    search_response = rss_client.get(
        "/api/rss/discover/sources",
        params={"q": "hacker news"},
    )
    assert search_response.status_code == 200
    search_payload = search_response.json()
    assert any("hacker news" in item["title"].lower() for item in search_payload["sources"])

    zh_response = rss_client.get(
        "/api/rss/discover/sources",
        params={"language": "zh"},
    )
    assert zh_response.status_code == 200
    zh_payload = zh_response.json()
    assert zh_payload["sources"]
    assert all(item["language"] == "zh" for item in zh_payload["sources"])


def test_list_rsshub_routes(rss_client):
    response = rss_client.get("/api/rss/discover/rsshub/routes")
    assert response.status_code == 200
    payload = response.json()
    assert payload["routes"]
    assert any(item["route"].startswith("/") for item in payload["routes"])
    assert all("route_template" in item for item in payload["routes"])
    assert all("params" in item for item in payload["routes"])
    assert any(item["params"] for item in payload["routes"])

    programming_response = rss_client.get(
        "/api/rss/discover/rsshub/routes",
        params={"category": "programming"},
    )
    assert programming_response.status_code == 200
    programming_payload = programming_response.json()
    assert programming_payload["routes"]
    assert all(item["category"] == "programming" for item in programming_payload["routes"])


def test_preview_discover_source(rss_client):
    now = datetime(2026, 3, 6, 9, 0, tzinfo=UTC)
    parsed = _parsed_feed(
        "https://example.com/preview.xml",
        [
            ("Preview 1", "https://example.com/p1", now),
            ("Preview 2", "https://example.com/p2", now - timedelta(hours=1)),
        ],
    )
    parsed.title = "Preview Feed"

    with patch("src.gateway.routers.rss.parse_rss_feed", return_value=parsed):
        response = rss_client.get(
            "/api/rss/discover/preview",
            params={"url": "https://example.com/preview.xml", "limit": 1},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["title"] == "Preview Feed"
    assert payload["feed_url"] == "https://example.com/preview.xml"
    assert len(payload["entries"]) == 1
    assert payload["entries"][0]["title"] == "Preview 1"


def test_parse_opml_for_import_preview(rss_client):
    content = b"""<?xml version='1.0' encoding='UTF-8'?>
<opml version='2.0'>
  <body>
    <outline text='Tech'>
      <outline text='Hacker News' type='rss' xmlUrl='https://hnrss.org/frontpage' htmlUrl='https://news.ycombinator.com/' />
      <outline text='Lobsters' type='rss' xmlUrl='https://lobste.rs/rss' htmlUrl='https://lobste.rs/' />
    </outline>
  </body>
</opml>
"""

    response = rss_client.post(
        "/api/rss/discover/opml/parse",
        files={"file": ("subscriptions.opml", content, "text/xml")},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] == 2
    assert {item["title"] for item in payload["sources"]} == {"Hacker News", "Lobsters"}
