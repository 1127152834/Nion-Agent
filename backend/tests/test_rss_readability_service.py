from types import SimpleNamespace

import pytest

from src.services import rss_readability


def test_extract_entry_content_success(monkeypatch):
    monkeypatch.setattr(
        "src.services.rss_readability._fetch_html",
        lambda _url, timeout=15: "<html><body><article>ok</article></body></html>",
    )
    monkeypatch.setattr(
        "src.services.rss_readability._extractor",
        SimpleNamespace(
            extract_article=lambda _html: SimpleNamespace(
                html_content="<article><p>full text</p></article>"
            )
        ),
    )

    result = rss_readability.extract_entry_content("https://example.com/article")
    assert result == "<article><p>full text</p></article>"


def test_extract_entry_content_raises_when_empty(monkeypatch):
    monkeypatch.setattr(
        "src.services.rss_readability._fetch_html",
        lambda _url, timeout=15: "<html><body>empty</body></html>",
    )
    monkeypatch.setattr(
        "src.services.rss_readability._extractor",
        SimpleNamespace(
            extract_article=lambda _html: SimpleNamespace(html_content="")
        ),
    )

    with pytest.raises(
        rss_readability.RSSReadabilityError,
        match="No readable content extracted from source page.",
    ):
        rss_readability.extract_entry_content("https://example.com/article")
