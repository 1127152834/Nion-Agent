from datetime import UTC, datetime

import pytest

from src.services.rss_parser import RSSParseError, parse_rss_feed


def test_parse_rss_feed_success(monkeypatch):
    parsed_payload = {
        "feed": {
            "title": "Example Feed",
            "link": "https://example.com",
            "description": "Example description",
            "image": {"href": "https://example.com/logo.png"},
        },
        "entries": [
            {
                "title": "Entry A",
                "link": "https://example.com/a",
                "summary": "Summary A",
                "author": "Alice",
                "published_parsed": (2026, 3, 5, 10, 0, 0, 0, 0, 0),
            },
            {
                "title": "Entry B",
                "link": "https://example.com/b",
                "content": [{"value": "<p>Body B</p>"}],
                "summary": "Summary B",
                "published_parsed": datetime(2026, 3, 5, 11, 0, tzinfo=UTC),
            },
        ],
    }

    monkeypatch.setattr("src.services.rss_parser.feedparser.parse", lambda _: parsed_payload)

    result = parse_rss_feed("https://example.com/feed.xml")
    assert result.title == "Example Feed"
    assert result.site_url == "https://example.com"
    assert result.image == "https://example.com/logo.png"
    assert len(result.entries) == 2
    assert result.entries[0].description == "Summary A"
    assert result.entries[1].content == "<p>Body B</p>"


def test_parse_rss_feed_requires_title(monkeypatch):
    monkeypatch.setattr("src.services.rss_parser.feedparser.parse", lambda _: {"feed": {}, "entries": []})

    with pytest.raises(RSSParseError):
        parse_rss_feed("https://example.com/feed.xml")


def test_parse_rss_feed_requires_entries(monkeypatch):
    payload = {"feed": {"title": "No Entries"}, "entries": []}
    monkeypatch.setattr("src.services.rss_parser.feedparser.parse", lambda _: payload)

    with pytest.raises(RSSParseError):
        parse_rss_feed("https://example.com/feed.xml")
