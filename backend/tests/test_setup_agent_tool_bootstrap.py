from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


def _paths(base_dir: Path):
    from src.config.paths import Paths

    return Paths(base_dir=base_dir)


def _runtime(*, agent_name: str | None, agent_display_name: str | None = None):
    context: dict[str, object] = {}
    if agent_name is not None:
        context["agent_name"] = agent_name
    if agent_display_name is not None:
        context["agent_display_name"] = agent_display_name
    # setup_agent 会读取 runtime.tool_call_id 来构造 ToolMessage
    return SimpleNamespace(context=context, tool_call_id="test-call")


def test_setup_agent_custom_creates_assets_and_user_profile_block(tmp_path: Path):
    from src.tools.builtins.setup_agent_tool import setup_agent

    with patch("src.tools.builtins.setup_agent_tool.get_paths", return_value=_paths(tmp_path)):
        _ = setup_agent.func(
            soul="# SOUL\ncustom soul",
            description="A custom agent for writing and editing.",
            runtime=_runtime(agent_name="writer", agent_display_name="写作助手"),
            target="custom",
            identity="# IDENTITY\ncustom identity",
            user_profile="# USER\nuser profile v1",
            user_profile_strategy="replace_generated_block",
        )

    agent_dir = tmp_path / "agents" / "writer"
    assert (agent_dir / "SOUL.md").read_text(encoding="utf-8") == "# SOUL\ncustom soul"
    assert (agent_dir / "IDENTITY.md").read_text(encoding="utf-8") == "# IDENTITY\ncustom identity"

    config = json.loads((agent_dir / "agent.json").read_text(encoding="utf-8"))
    assert config["name"] == "writer"
    assert config["description"] == "A custom agent for writing and editing."
    assert config["heartbeat_enabled"] is True
    assert config["evolution_enabled"] is True
    assert config["display_name"] == "写作助手"

    user_md = (tmp_path / "USER.md").read_text(encoding="utf-8")
    assert "<!-- nion:bootstrap:user_profile:start -->" in user_md
    assert "# USER\nuser profile v1" in user_md
    assert "<!-- nion:bootstrap:user_profile:end -->" in user_md


def test_setup_agent_custom_rejects_existing_agent_dir_without_mutation(tmp_path: Path):
    from src.tools.builtins.setup_agent_tool import setup_agent

    agent_dir = tmp_path / "agents" / "writer"
    agent_dir.mkdir(parents=True, exist_ok=True)
    sentinel = agent_dir / "sentinel.txt"
    sentinel.write_text("do-not-delete", encoding="utf-8")

    with patch("src.tools.builtins.setup_agent_tool.get_paths", return_value=_paths(tmp_path)):
        result = setup_agent.func(
            soul="new soul",
            description="new desc",
            runtime=_runtime(agent_name="writer", agent_display_name="写作助手"),
            target="custom",
            identity="identity must be provided to avoid falling back to default template",
        )

    # 不应删除/覆盖既有目录
    assert sentinel.exists()
    assert sentinel.read_text(encoding="utf-8") == "do-not-delete"
    # 失败应返回 ToolMessage（Command.update.messages）
    assert result.update.get("messages")
    assert "already exists" in (result.update["messages"][0].content or "").lower()


def test_setup_agent_custom_rejects_missing_identity_without_creating_agent_dir(tmp_path: Path):
    from src.tools.builtins.setup_agent_tool import setup_agent

    with patch("src.tools.builtins.setup_agent_tool.get_paths", return_value=_paths(tmp_path)):
        result = setup_agent.func(
            soul="custom soul",
            description="desc",
            runtime=_runtime(agent_name="writer", agent_display_name="写作助手"),
            target="custom",
            identity="   ",
        )

    agent_dir = tmp_path / "agents" / "writer"
    assert not agent_dir.exists()
    assert result.update.get("messages")
    assert "identity" in (result.update["messages"][0].content or "").lower()


def test_setup_agent_default_updates_assets_without_agent_name(tmp_path: Path):
    from src.tools.builtins.setup_agent_tool import setup_agent

    with (
        patch("src.tools.builtins.setup_agent_tool.get_paths", return_value=_paths(tmp_path)),
        patch("src.config.default_agent.get_paths", return_value=_paths(tmp_path)),
    ):
        _ = setup_agent.func(
            soul="# SOUL\ndefault soul v2",
            description="ignored",
            runtime=_runtime(agent_name=None),
            target="default",
            identity="# IDENTITY\ndefault identity v2",
            user_profile="# USER\nuser profile v2",
        )

    default_dir = tmp_path / "agents" / "_default"
    assert (default_dir / "SOUL.md").read_text(encoding="utf-8") == "# SOUL\ndefault soul v2"
    assert (default_dir / "IDENTITY.md").read_text(encoding="utf-8") == "# IDENTITY\ndefault identity v2"
    user_md = (tmp_path / "USER.md").read_text(encoding="utf-8")
    assert "# USER\nuser profile v2" in user_md


def test_user_profile_marker_replaces_existing_block(tmp_path: Path):
    from src.tools.builtins.setup_agent_tool import setup_agent

    existing = "manual header\n<!-- nion:bootstrap:user_profile:start -->\nold block\n<!-- nion:bootstrap:user_profile:end -->\nmanual footer\n"
    (tmp_path / "USER.md").write_text(existing, encoding="utf-8")

    with (
        patch("src.tools.builtins.setup_agent_tool.get_paths", return_value=_paths(tmp_path)),
        patch("src.config.default_agent.get_paths", return_value=_paths(tmp_path)),
    ):
        _ = setup_agent.func(
            soul="soul",
            description="desc",
            runtime=_runtime(agent_name=None),
            target="default",
            identity="identity is required for bootstrap updates (no silent default template)",
            user_profile="new block",
        )

    updated = (tmp_path / "USER.md").read_text(encoding="utf-8")
    assert "manual header" in updated
    assert "manual footer" in updated
    assert "old block" not in updated
    assert "new block" in updated


def test_setup_agent_default_rejects_missing_identity_without_writing_default_assets(tmp_path: Path):
    from src.tools.builtins.setup_agent_tool import setup_agent

    with (
        patch("src.tools.builtins.setup_agent_tool.get_paths", return_value=_paths(tmp_path)),
        patch("src.config.default_agent.get_paths", return_value=_paths(tmp_path)),
    ):
        result = setup_agent.func(
            soul="default soul",
            description="desc",
            runtime=_runtime(agent_name=None),
            target="default",
            identity=None,
        )

    default_dir = tmp_path / "agents" / "_default"
    assert not default_dir.exists()
    assert result.update.get("messages")
    assert "identity" in (result.update["messages"][0].content or "").lower()
