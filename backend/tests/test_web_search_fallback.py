from types import SimpleNamespace

from src.community.web_search import tools as web_search_tools


class _FakeAppConfig:
    def __init__(self, extra: dict | None = None):
        self._tool = SimpleNamespace(model_extra=extra or {})

    def get_tool_config(self, name: str):
        if name == "web_search":
            return self._tool
        return None


def test_web_search_auto_falls_back_to_searxng(monkeypatch):
    monkeypatch.delenv("TAVILY_API_KEY", raising=False)
    monkeypatch.setattr(web_search_tools, "get_app_config", lambda: _FakeAppConfig(extra={"provider": "auto"}))

    monkeypatch.setattr(
        web_search_tools,
        "_search_searxng",
        lambda query, max_results, candidates, timeout_seconds, engines: [
            {
                "title": "Example",
                "url": "https://example.com",
                "snippet": "demo",
            }
        ],
    )

    result = web_search_tools.web_search_tool.func("test")

    assert "https://example.com" in result


def test_provider_chain_auto_prefers_tavily_then_searxng(monkeypatch):
    monkeypatch.delenv("TAVILY_API_KEY", raising=False)
    chain, _ = web_search_tools._build_provider_chain({"provider": "auto", "api_key": "tavily-key"})
    assert chain == ["tavily", "searxng"]


def test_provider_chain_auto_without_tavily_uses_searxng_only(monkeypatch):
    monkeypatch.delenv("TAVILY_API_KEY", raising=False)
    chain, context = web_search_tools._build_provider_chain({"provider": "auto"})
    assert chain == ["searxng"]
    assert len(context["searxng_candidates"]) > 0


def test_search_settings_provider_chain_falls_back_to_builtin(monkeypatch):
    class _FakeAppConfigV2:
        def __init__(self):
            self.model_extra = {
                "search_settings": {
                    "provider_configs": {
                        "brave": {"api_key": "brave-key"},
                    },
                    "web_search": {
                        "providers": ["brave"],
                        "max_results": 3,
                    },
                }
            }

        def get_tool_config(self, name: str):
            return None

    monkeypatch.setattr(web_search_tools, "get_app_config", lambda: _FakeAppConfigV2())
    monkeypatch.setattr(web_search_tools, "_search_brave", lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("unauthorized")))
    monkeypatch.setattr(
        web_search_tools,
        "_search_searxng",
        lambda query, max_results, candidates, timeout_seconds, engines: [{"title": "Example", "url": "https://example.com", "snippet": "demo"}],
    )

    result = web_search_tools.web_search_tool.func("test")
    assert "https://example.com" in result
