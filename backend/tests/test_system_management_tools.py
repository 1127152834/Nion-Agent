"""Tests for system management chat tools."""

from __future__ import annotations

import asyncio
import importlib
import json
from types import SimpleNamespace

from src.config.extensions_config import ExtensionsConfig, McpServerConfig

system_tools = importlib.import_module("src.tools.builtins.system_manage_tools")


def _runtime(thread_id: str = "thread-test") -> SimpleNamespace:
    return SimpleNamespace(context={"thread_id": thread_id})


def test_skills_manage_disable_requires_confirmation():
    raw = system_tools.skills_manage_tool.func(
        runtime=_runtime(),
        action="set_enabled",
        skill_name="demo-skill",
        enabled=False,
    )
    payload = json.loads(raw)
    assert payload["success"] is False
    assert payload["requires_confirmation"] is True
    assert isinstance(payload["confirmation_token"], str)


def test_mcp_manage_overwrite_requires_confirmation(monkeypatch):
    cfg = ExtensionsConfig(
        mcpServers={
            "github": McpServerConfig(
                enabled=True,
                type="stdio",
                command="npx",
                args=["-y", "@modelcontextprotocol/server-github"],
                env={},
                description="github mcp",
            )
        }
    )
    monkeypatch.setattr(system_tools, "get_extensions_config", lambda: cfg)

    raw = system_tools.mcp_manage_tool.func(
        action="upsert",
        server_name="github",
        server_config_json=json.dumps(
            {
                "enabled": True,
                "type": "stdio",
                "command": "npx",
                "args": ["-y", "@modelcontextprotocol/server-github"],
                "env": {},
                "description": "github mcp",
            }
        ),
    )
    payload = json.loads(raw)
    assert payload["success"] is False
    assert payload["requires_confirmation"] is True


def test_models_manage_overwrite_requires_confirmation(monkeypatch):
    class FakeRepo:
        def read(self):
            return (
                {
                    "models": [
                        {
                            "name": "model-a",
                            "use": "langchain_openai.ChatOpenAI",
                            "model": "gpt-4o-mini",
                        }
                    ]
                },
                "1",
                None,
            )

    monkeypatch.setattr(system_tools, "ConfigRepository", lambda: FakeRepo())

    raw = system_tools.models_manage_tool.func(
        action="upsert",
        model_config_json=json.dumps(
            {
                "name": "model-a",
                "use": "langchain_openai.ChatOpenAI",
                "model": "gpt-4.1-mini",
            }
        ),
    )
    payload = json.loads(raw)
    assert payload["success"] is False
    assert payload["requires_confirmation"] is True


def test_run_async_works_inside_running_loop():
    async def _wrapper():
        return system_tools._run_async(asyncio.sleep(0, result="ok"))

    result = asyncio.run(_wrapper())
    assert result == "ok"
