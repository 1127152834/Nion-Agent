from types import SimpleNamespace

import pytest

pytest.importorskip("markdownify")
pytest.importorskip("readabilipy")

from nion.community.jina_ai import tools as jina_tools


class _FakeAppConfig:
    def __init__(self, extra: dict | None = None):
        self._tool = SimpleNamespace(model_extra=extra or {})

    def get_tool_config(self, name: str):
        if name == "web_fetch":
            return self._tool
        return None


def test_web_fetch_falls_back_to_direct_fetch(monkeypatch):
    monkeypatch.setattr(jina_tools, "get_app_config", lambda: _FakeAppConfig(extra={"timeout": 5}))
    monkeypatch.setattr(jina_tools.JinaClient, "crawl", lambda self, url, return_format, timeout, api_key=None: "Error: jina unavailable")
    monkeypatch.setattr(
        jina_tools,
        "_fetch_direct_html",
        lambda url, timeout: "<html><head><title>Demo</title></head><body><p>Hello fallback</p></body></html>",
    )

    result = jina_tools.web_fetch_tool.func("https://example.com")

    assert "Hello fallback" in result


def test_web_fetch_returns_error_when_all_strategies_fail(monkeypatch):
    monkeypatch.setattr(jina_tools, "get_app_config", lambda: _FakeAppConfig(extra={"timeout": 5}))
    monkeypatch.setattr(jina_tools.JinaClient, "crawl", lambda self, url, return_format, timeout, api_key=None: "Error: jina unavailable")

    def _raise_direct(url: str, timeout: int) -> str:
        raise RuntimeError("direct fetch unavailable")

    monkeypatch.setattr(jina_tools, "_fetch_direct_html", _raise_direct)

    result = jina_tools.web_fetch_tool.func("https://example.com")

    assert result.startswith("Error: web_fetch failed")
