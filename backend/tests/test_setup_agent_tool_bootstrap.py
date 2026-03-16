from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import pytest


class _NoopProvider:
    """A safe default memory provider stub for this test module.

    Why: setup_agent performs a best-effort OpenViking managed resources sync
    after writing assets. In unit tests we must not touch real OpenViking stores,
    trigger embedding, or make any external network requests.

    Tests that need to validate sync behavior explicitly patch
    `get_default_memory_provider` with their own dummy openviking provider.
    """

    name = "noop"


@pytest.fixture(autouse=True)
def _disable_openviking_sync_by_default():
    with patch(
        "src.tools.builtins.setup_agent_tool.get_default_memory_provider",
        return_value=_NoopProvider(),
    ):
        yield


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


def test_setup_agent_custom_rejects_soul_mixed_identity_content_without_creating_agent_dir(tmp_path: Path):
    from src.tools.builtins.setup_agent_tool import setup_agent

    mixed_soul = """# Soul

## 主要任务与范围（做什么）
- 你要做很多事（这段内容应当属于 IDENTITY，而不是 SOUL）
"""

    with patch("src.tools.builtins.setup_agent_tool.get_paths", return_value=_paths(tmp_path)):
        result = setup_agent.func(
            soul=mixed_soul,
            description="desc",
            runtime=_runtime(agent_name="writer", agent_display_name="写作助手"),
            target="custom",
            identity="custom identity",
        )

    agent_dir = tmp_path / "agents" / "writer"
    assert not agent_dir.exists()
    assert result.update.get("messages")
    msg = (result.update["messages"][0].content or "").lower()
    assert "soul" in msg
    assert "identity" in msg


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


def test_setup_agent_default_rejects_soul_mixed_identity_content_without_writing_default_assets(tmp_path: Path):
    from src.tools.builtins.setup_agent_tool import setup_agent

    mixed_soul = """# Soul

## 边界与禁区（不做什么）
- 这段内容应当属于 IDENTITY，而不是 SOUL
"""

    with (
        patch("src.tools.builtins.setup_agent_tool.get_paths", return_value=_paths(tmp_path)),
        patch("src.config.default_agent.get_paths", return_value=_paths(tmp_path)),
    ):
        result = setup_agent.func(
            soul=mixed_soul,
            description="ignored",
            runtime=_runtime(agent_name=None),
            target="default",
            identity="default identity",
        )

    default_dir = tmp_path / "agents" / "_default"
    assert not default_dir.exists()
    assert result.update.get("messages")
    msg = (result.update["messages"][0].content or "").lower()
    assert "soul" in msg
    assert "identity" in msg


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


def test_setup_agent_custom_writes_memory_items_and_returns_results(tmp_path: Path):
    from src.tools.builtins.setup_agent_tool import setup_agent

    memory_items = [
        {"content": "项目背景：Nion-Agent 智能体系统重构", "tier": "profile"},
        {"content": "偏好：默认中文输出，结论优先", "tier": "preference", "confidence": 0.8},
    ]

    with (
        patch("src.tools.builtins.setup_agent_tool.get_paths", return_value=_paths(tmp_path)),
        patch(
            "src.tools.builtins.setup_agent_tool.store_memory_action",
            create=True,
            side_effect=[{"memory_id": "m1"}, {"memory_id": "m2"}],
        ) as store,
    ):
        result = setup_agent.func(
            soul="custom soul",
            description="desc",
            runtime=_runtime(agent_name="writer", agent_display_name="写作助手"),
            target="custom",
            identity="custom identity",
            memory_items=memory_items,
        )

    assert store.call_count == 2

    first = store.call_args_list[0].kwargs
    assert first["scope"] == "agent"
    assert first["agent_name"] == "writer"
    assert first["content"] == "项目背景：Nion-Agent 智能体系统重构"
    assert first["metadata"]["tier"] == "profile"

    second = store.call_args_list[1].kwargs
    assert second["scope"] == "agent"
    assert second["agent_name"] == "writer"
    assert second["content"] == "偏好：默认中文输出，结论优先"
    assert second["confidence"] == 0.8
    assert second["metadata"]["tier"] == "preference"

    assert result.update.get("memory_results") == [{"memory_id": "m1"}, {"memory_id": "m2"}]


def test_setup_agent_default_writes_memory_items_to_global_scope(tmp_path: Path):
    from src.tools.builtins.setup_agent_tool import setup_agent

    memory_items = [{"content": "偏好：重要变更必须先确认", "tier": "preference"}]

    with (
        patch("src.tools.builtins.setup_agent_tool.get_paths", return_value=_paths(tmp_path)),
        patch("src.config.default_agent.get_paths", return_value=_paths(tmp_path)),
        patch(
            "src.tools.builtins.setup_agent_tool.store_memory_action",
            create=True,
            side_effect=[{"memory_id": "g1"}],
        ) as store,
    ):
        result = setup_agent.func(
            soul="default soul",
            description="desc",
            runtime=_runtime(agent_name=None),
            target="default",
            identity="default identity",
            memory_items=memory_items,
        )

    assert store.call_count == 1
    args = store.call_args.kwargs
    assert args["scope"] == "global"
    assert args["agent_name"] is None
    assert args["content"] == "偏好：重要变更必须先确认"
    assert args["metadata"]["tier"] == "preference"
    assert result.update.get("memory_results") == [{"memory_id": "g1"}]


def test_setup_agent_custom_syncs_assets_to_openviking_managed_resources(tmp_path: Path):
    from src.tools.builtins.setup_agent_tool import setup_agent

    sync_calls: list[dict[str, object]] = []

    class _DummyProvider:
        name = "openviking"

        def sync_managed_resource(self, *, local_path, target_uri: str, agent_name: str | None, reason: str = "", **kwargs):  # noqa: ANN001
            sync_calls.append(
                {
                    "local_path": str(local_path),
                    "target_uri": target_uri,
                    "agent_name": agent_name,
                    "reason": reason,
                }
            )
            return {"ok": True}

    with (
        patch("src.tools.builtins.setup_agent_tool.get_paths", return_value=_paths(tmp_path)),
        patch("src.tools.builtins.setup_agent_tool.get_default_memory_provider", return_value=_DummyProvider()),
    ):
        _ = setup_agent.func(
            soul="# SOUL\ncustom soul",
            description="A custom agent for writing and editing.",
            runtime=_runtime(agent_name="writer", agent_display_name="写作助手"),
            target="custom",
            identity="# IDENTITY\ncustom identity",
            user_profile="# USER\nuser profile v1",
            user_profile_strategy="replace_generated_block",
        )

    assert any(
        call["target_uri"] == "viking://resources/nion/managed/agents/writer/SOUL.md"
        and call["agent_name"] == "writer"
        and call["reason"] == "nion_asset_sync"
        for call in sync_calls
    )
    assert any(call["target_uri"] == "viking://resources/nion/managed/agents/writer/IDENTITY.md" and call["agent_name"] == "writer" for call in sync_calls)
    assert any(call["target_uri"] == "viking://resources/nion/managed/agents/writer/agent.json" and call["agent_name"] == "writer" for call in sync_calls)
    assert any(call["target_uri"] == "viking://resources/nion/managed/user/USER.md" and call["agent_name"] is None for call in sync_calls)


def test_setup_agent_default_syncs_assets_to_openviking_managed_resources(tmp_path: Path):
    from src.tools.builtins.setup_agent_tool import setup_agent

    sync_calls: list[dict[str, object]] = []

    class _DummyProvider:
        name = "openviking"

        def sync_managed_resource(self, *, local_path, target_uri: str, agent_name: str | None, reason: str = "", **kwargs):  # noqa: ANN001
            sync_calls.append(
                {
                    "local_path": str(local_path),
                    "target_uri": target_uri,
                    "agent_name": agent_name,
                    "reason": reason,
                }
            )
            return {"ok": True}

    with (
        patch("src.tools.builtins.setup_agent_tool.get_paths", return_value=_paths(tmp_path)),
        patch("src.config.default_agent.get_paths", return_value=_paths(tmp_path)),
        patch("src.tools.builtins.setup_agent_tool.get_default_memory_provider", return_value=_DummyProvider()),
    ):
        _ = setup_agent.func(
            soul="# SOUL\ndefault soul v2",
            description="ignored",
            runtime=_runtime(agent_name=None),
            target="default",
            identity="# IDENTITY\ndefault identity v2",
            user_profile="# USER\nuser profile v2",
        )

    assert any(call["target_uri"] == "viking://resources/nion/managed/agents/_default/SOUL.md" and call["agent_name"] is None for call in sync_calls)
    assert any(call["target_uri"] == "viking://resources/nion/managed/agents/_default/IDENTITY.md" and call["agent_name"] is None for call in sync_calls)
    assert any(call["target_uri"] == "viking://resources/nion/managed/agents/_default/agent.json" and call["agent_name"] is None for call in sync_calls)
    assert any(call["target_uri"] == "viking://resources/nion/managed/user/USER.md" and call["agent_name"] is None for call in sync_calls)
