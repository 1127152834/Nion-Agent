"""Phase 4 tests for soul workspace files and identity cascade."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

MEMORY_DIR = Path(__file__).resolve().parents[1] / "src" / "agents" / "memory"


def _load_module(module_name: str, relative_path: str):
    module_path = MEMORY_DIR / relative_path
    assert module_path.exists(), f"Missing module file: {module_path}"

    spec = importlib.util.spec_from_file_location(module_name, module_path)
    assert spec is not None and spec.loader is not None

    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


def test_phase4_module_files_loadable() -> None:
    _load_module("memory_soul_workspace", "soul/workspace.py")
    _load_module("memory_soul_identity_cascade", "soul/identity_cascade.py")


def test_workspace_files_support_read_and_write(tmp_path) -> None:
    workspace_module = _load_module("memory_soul_workspace", "soul/workspace.py")

    ws = workspace_module.WorkspaceFiles.create_for_agent("memory-agent", tmp_path)

    ws.set_soul("# Soul\n\nBe concise.")
    ws.set_identity(name="Nion", tone="friendly", avatar="avatar.png", description="Assistant")
    ws.set_user(
        name="Alice",
        preferences={"language": "zh-CN", "style": "concise"},
        context={"role": "engineer"},
    )
    ws.update_memory_summary("Recent focus: memory system upgrade")

    assert ws.get_soul() == "# Soul\n\nBe concise."

    identity = ws.get_identity()
    assert identity is not None
    assert identity["name"] == "Nion"
    assert identity["tone"] == "friendly"

    user_info = ws.get_user()
    assert user_info is not None
    assert user_info["name"] == "Alice"
    assert user_info["preferences"]["style"] == "concise"

    assert ws.get_memory_summary() == "Recent focus: memory system upgrade"


def test_identity_cascade_resolves_with_workspace_highest_priority(tmp_path) -> None:
    workspace_module = _load_module("memory_soul_workspace", "soul/workspace.py")
    cascade_module = _load_module("memory_soul_identity_cascade", "soul/identity_cascade.py")

    ws = workspace_module.WorkspaceFiles.create_for_agent("agent-x", tmp_path)
    ws.set_identity(name="WorkspaceName", tone="workspace-tone", description="from workspace")

    cascade = cascade_module.IdentityCascade(
        global_config={"name": "GlobalName", "tone": "professional", "language": "zh-CN"}
    )

    resolved = cascade.resolve_identity(
        agent_name="agent-x",
        agent_config={
            "identity": {
                "name": "AgentName",
                "tone": "agent-tone",
                "avatar": "agent.png",
                "custom": {"style": "direct"},
            }
        },
        workspace_files=ws,
    )

    assert resolved.name == "WorkspaceName"
    assert resolved.tone == "workspace-tone"
    assert resolved.avatar == "agent.png"
    assert resolved.description == "from workspace"
    assert resolved.language == "zh-CN"
    assert resolved.custom["style"] == "direct"


def test_soul_resolver_fallback_order(tmp_path) -> None:
    workspace_module = _load_module("memory_soul_workspace", "soul/workspace.py")
    cascade_module = _load_module("memory_soul_identity_cascade", "soul/identity_cascade.py")

    ws = workspace_module.WorkspaceFiles.create_for_agent("agent-y", tmp_path)
    ws.set_soul("# Soul\n\nFrom workspace")

    class _Manager:
        def __init__(self, workspace):
            self.workspace = workspace

        def get_workspace(self, agent_name: str | None = None):  # noqa: ARG002
            return self.workspace

    resolver = cascade_module.SoulResolver(workspace_manager=_Manager(ws))

    assert resolver.resolve_soul("agent-y", bootstrap_soul="bootstrap") == "bootstrap"
    assert resolver.resolve_soul("agent-y") == "# Soul\n\nFrom workspace"

    resolver_no_ws = cascade_module.SoulResolver(workspace_manager=_Manager(None))
    default_soul = resolver_no_ws.resolve_soul("agent-y")
    assert "Identity" in default_soul
