from __future__ import annotations

from src.agents.lead_agent import agent as lead_agent_module
from src.agents.lead_agent import prompt as lead_prompt_module
from src.config.app_config import AppConfig
from src.config.model_config import ModelConfig
from src.config.sandbox_config import SandboxConfig


def _make_app_config(models: list[ModelConfig]) -> AppConfig:
    return AppConfig(
        models=models,
        sandbox=SandboxConfig(use="src.sandbox.local:LocalSandboxProvider"),
    )


def _make_model(name: str, *, supports_thinking: bool) -> ModelConfig:
    return ModelConfig(
        name=name,
        display_name=name,
        description=None,
        use="langchain_openai:ChatOpenAI",
        model=name,
        supports_thinking=supports_thinking,
        supports_vision=False,
    )


def test_apply_prompt_template_includes_rss_context(monkeypatch):
    monkeypatch.setattr(lead_prompt_module, "_get_memory_context", lambda _agent_name, **_: "")
    monkeypatch.setattr(lead_prompt_module, "get_skills_prompt_section", lambda _skills: "")
    monkeypatch.setattr(lead_prompt_module, "get_agent_soul", lambda _agent_name: "")

    prompt = lead_prompt_module.apply_prompt_template(
        rss_context=[
            {
                "type": "mainEntry",
                "entry_id": "entry-1",
                "title": "Example Entry",
                "url": "https://example.com/entry",
                "summary": "Example summary",
            }
        ]
    )

    assert "<rss_context>" in prompt
    assert "Example Entry" in prompt
    assert "https://example.com/entry" in prompt
    assert "entry-1" in prompt


def test_make_lead_agent_passes_rss_context_to_prompt(monkeypatch):
    app_config = _make_app_config([_make_model("safe-model", supports_thinking=False)])

    import src.tools as tools_module

    monkeypatch.setattr(lead_agent_module, "ensure_latest_app_config", lambda process_name=None: app_config)
    monkeypatch.setattr(tools_module, "get_available_tools", lambda **kwargs: [])
    monkeypatch.setattr(lead_agent_module, "_build_middlewares", lambda config, model_name, agent_name=None: [])
    monkeypatch.setattr(lead_agent_module, "create_chat_model", lambda **kwargs: object())
    monkeypatch.setattr(lead_agent_module, "create_agent", lambda **kwargs: kwargs)

    captured: dict[str, object] = {}

    def _fake_apply_prompt_template(**kwargs):
        captured["rss_context"] = kwargs.get("rss_context")
        return "prompt"

    monkeypatch.setattr(lead_agent_module, "apply_prompt_template", _fake_apply_prompt_template)

    rss_context = [
        {
            "type": "mainEntry",
            "entry_id": "entry-abc",
            "title": "Captured Entry",
            "summary": "Captured summary",
        }
    ]
    lead_agent_module.make_lead_agent(
        {
            "configurable": {
                "model_name": "safe-model",
                "thinking_enabled": False,
                "is_plan_mode": False,
                "subagent_enabled": False,
                "rss_context": rss_context,
            }
        }
    )

    assert captured["rss_context"] == rss_context


def test_apply_prompt_template_omits_memory_when_read_disabled(monkeypatch):
    monkeypatch.setattr(lead_prompt_module, "get_skills_prompt_section", lambda _skills: "")
    monkeypatch.setattr(lead_prompt_module, "get_agent_soul", lambda _agent_name: "")

    prompt = lead_prompt_module.apply_prompt_template(memory_read=False)

    assert "<memory>" not in prompt


def test_make_lead_agent_passes_memory_session_fields_to_prompt(monkeypatch):
    app_config = _make_app_config([_make_model("safe-model", supports_thinking=False)])

    import src.tools as tools_module

    monkeypatch.setattr(lead_agent_module, "ensure_latest_app_config", lambda process_name=None: app_config)
    monkeypatch.setattr(tools_module, "get_available_tools", lambda **kwargs: [])
    monkeypatch.setattr(lead_agent_module, "_build_middlewares", lambda config, model_name, agent_name=None: [])
    monkeypatch.setattr(lead_agent_module, "create_chat_model", lambda **kwargs: object())
    monkeypatch.setattr(lead_agent_module, "create_agent", lambda **kwargs: kwargs)

    captured: dict[str, object] = {}

    def _fake_apply_prompt_template(**kwargs):
        captured["session_mode"] = kwargs.get("session_mode")
        captured["memory_read"] = kwargs.get("memory_read")
        captured["memory_write"] = kwargs.get("memory_write")
        return "prompt"

    monkeypatch.setattr(lead_agent_module, "apply_prompt_template", _fake_apply_prompt_template)

    lead_agent_module.make_lead_agent(
        {
            "configurable": {
                "model_name": "safe-model",
                "thinking_enabled": False,
                "is_plan_mode": False,
                "subagent_enabled": False,
                "session_mode": "temporary_chat",
                "memory_read": True,
                "memory_write": False,
            }
        }
    )

    assert captured["session_mode"] == "temporary_chat"
    assert captured["memory_read"] is True
    assert captured["memory_write"] is False
