"""Tests for custom agent support."""

from __future__ import annotations

import base64
import json
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_paths(base_dir: Path):
    """Return a Paths instance pointing to base_dir."""
    from nion.config.paths import Paths

    return Paths(base_dir=base_dir)


def _write_agent(base_dir: Path, name: str, config: dict, soul: str = "You are helpful.") -> None:
    """Write an agent directory with agent.json and SOUL.md."""
    agent_dir = base_dir / "agents" / name
    agent_dir.mkdir(parents=True, exist_ok=True)

    config_copy = dict(config)
    if "name" not in config_copy:
        config_copy["name"] = name

    with open(agent_dir / "agent.json", "w", encoding="utf-8") as f:
        json.dump(config_copy, f, ensure_ascii=False)

    (agent_dir / "SOUL.md").write_text(soul, encoding="utf-8")


def _tiny_png_bytes() -> bytes:
    """Return a valid 1x1 PNG used by avatar upload tests."""
    return base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/6mQAAAAASUVORK5CYII=")


# ===========================================================================
# 1. Paths class – agent path methods
# ===========================================================================


class TestPaths:
    def test_agents_dir(self, tmp_path):
        paths = _make_paths(tmp_path)
        assert paths.agents_dir == tmp_path / "agents"

    def test_agent_dir(self, tmp_path):
        paths = _make_paths(tmp_path)
        assert paths.agent_dir("code-reviewer") == tmp_path / "agents" / "code-reviewer"

    def test_openviking_scope_dir(self, tmp_path):
        paths = _make_paths(tmp_path)
        assert paths.openviking_scope_dir("code-reviewer") == tmp_path / "openviking" / "agent-code-reviewer"

    def test_user_md_file(self, tmp_path):
        paths = _make_paths(tmp_path)
        assert paths.user_md_file == tmp_path / "USER.md"

    def test_openviking_global_and_agent_paths_are_different(self, tmp_path):
        paths = _make_paths(tmp_path)
        assert paths.openviking_scope_dir(None) != paths.openviking_scope_dir("my-agent")
        assert paths.openviking_scope_dir(None) == tmp_path / "openviking" / "global"
        assert paths.openviking_scope_dir("my-agent") == tmp_path / "openviking" / "agent-my-agent"


# ===========================================================================
# 2. AgentConfig – Pydantic parsing
# ===========================================================================


class TestAgentConfig:
    def test_minimal_config(self):
        from nion.config.agents_config import AgentConfig

        cfg = AgentConfig(name="my-agent")
        assert cfg.name == "my-agent"
        assert cfg.description == ""
        assert cfg.model is None
        assert cfg.tool_groups is None

    def test_full_config(self):
        from nion.config.agents_config import AgentConfig

        cfg = AgentConfig(
            name="code-reviewer",
            description="Specialized for code review",
            model="deepseek-v3",
            tool_groups=["file:read", "bash"],
        )
        assert cfg.name == "code-reviewer"
        assert cfg.model == "deepseek-v3"
        assert cfg.tool_groups == ["file:read", "bash"]

    def test_config_from_dict(self):
        from nion.config.agents_config import AgentConfig

        data = {"name": "test-agent", "description": "A test", "model": "gpt-4"}
        cfg = AgentConfig(**data)
        assert cfg.name == "test-agent"
        assert cfg.model == "gpt-4"
        assert cfg.tool_groups is None


# ===========================================================================
# 3. load_agent_config
# ===========================================================================


class TestLoadAgentConfig:
    def test_load_valid_config(self, tmp_path):
        config_dict = {"name": "code-reviewer", "description": "Code review agent", "model": "deepseek-v3"}
        _write_agent(tmp_path, "code-reviewer", config_dict)

        with patch("nion.config.agents_config.get_paths", return_value=_make_paths(tmp_path)):
            from nion.config.agents_config import load_agent_config

            cfg = load_agent_config("code-reviewer")

        assert cfg.name == "code-reviewer"
        assert cfg.description == "Code review agent"
        assert cfg.model == "deepseek-v3"

    def test_load_missing_agent_raises(self, tmp_path):
        with patch("nion.config.agents_config.get_paths", return_value=_make_paths(tmp_path)):
            from nion.config.agents_config import load_agent_config

            with pytest.raises(FileNotFoundError):
                load_agent_config("nonexistent-agent")

    def test_load_missing_config_yaml_raises(self, tmp_path):
        # Create directory without agent.json
        (tmp_path / "agents" / "broken-agent").mkdir(parents=True)

        with patch("nion.config.agents_config.get_paths", return_value=_make_paths(tmp_path)):
            from nion.config.agents_config import load_agent_config

            with pytest.raises(FileNotFoundError):
                load_agent_config("broken-agent")

    def test_load_config_infers_name_from_dir(self, tmp_path):
        """Config without 'name' field should use directory name."""
        agent_dir = tmp_path / "agents" / "inferred-name"
        agent_dir.mkdir(parents=True)
        (agent_dir / "agent.json").write_text(json.dumps({"description": "My agent"}), encoding="utf-8")
        (agent_dir / "SOUL.md").write_text("Hello")

        with patch("nion.config.agents_config.get_paths", return_value=_make_paths(tmp_path)):
            from nion.config.agents_config import load_agent_config

            cfg = load_agent_config("inferred-name")

        assert cfg.name == "inferred-name"

    def test_load_config_with_tool_groups(self, tmp_path):
        config_dict = {"name": "restricted", "tool_groups": ["file:read", "file:write"]}
        _write_agent(tmp_path, "restricted", config_dict)

        with patch("nion.config.agents_config.get_paths", return_value=_make_paths(tmp_path)):
            from nion.config.agents_config import load_agent_config

            cfg = load_agent_config("restricted")

        assert cfg.tool_groups == ["file:read", "file:write"]

    def test_legacy_prompt_file_field_ignored(self, tmp_path):
        """Unknown fields like the old prompt_file should be silently ignored."""
        agent_dir = tmp_path / "agents" / "legacy-agent"
        agent_dir.mkdir(parents=True)
        (agent_dir / "agent.json").write_text(
            json.dumps({"name": "legacy-agent", "prompt_file": "system.md"}),
            encoding="utf-8",
        )
        (agent_dir / "SOUL.md").write_text("Soul content")

        with patch("nion.config.agents_config.get_paths", return_value=_make_paths(tmp_path)):
            from nion.config.agents_config import load_agent_config

            cfg = load_agent_config("legacy-agent")

        assert cfg.name == "legacy-agent"


# ===========================================================================
# 4. load_agent_soul
# ===========================================================================


class TestLoadAgentSoul:
    def test_reads_soul_file(self, tmp_path):
        expected_soul = "You are a specialized code review expert."
        _write_agent(tmp_path, "code-reviewer", {"name": "code-reviewer"}, soul=expected_soul)

        with patch("nion.config.agents_config.get_paths", return_value=_make_paths(tmp_path)):
            from nion.config.agents_config import AgentConfig, load_agent_soul

            cfg = AgentConfig(name="code-reviewer")
            soul = load_agent_soul(cfg.name)

        assert soul == expected_soul

    def test_missing_soul_file_returns_none(self, tmp_path):
        agent_dir = tmp_path / "agents" / "no-soul"
        agent_dir.mkdir(parents=True)
        (agent_dir / "agent.json").write_text(json.dumps({"name": "no-soul"}), encoding="utf-8")
        # No SOUL.md created

        with patch("nion.config.agents_config.get_paths", return_value=_make_paths(tmp_path)):
            from nion.config.agents_config import AgentConfig, load_agent_soul

            cfg = AgentConfig(name="no-soul")
            soul = load_agent_soul(cfg.name)

        assert soul is None

    def test_empty_soul_file_returns_none(self, tmp_path):
        agent_dir = tmp_path / "agents" / "empty-soul"
        agent_dir.mkdir(parents=True)
        (agent_dir / "agent.json").write_text(json.dumps({"name": "empty-soul"}), encoding="utf-8")
        (agent_dir / "SOUL.md").write_text("   \n   ")

        with patch("nion.config.agents_config.get_paths", return_value=_make_paths(tmp_path)):
            from nion.config.agents_config import AgentConfig, load_agent_soul

            cfg = AgentConfig(name="empty-soul")
            soul = load_agent_soul(cfg.name)

        assert soul is None


# ===========================================================================
# 5. list_custom_agents
# ===========================================================================


class TestListCustomAgents:
    def test_empty_when_no_agents_dir(self, tmp_path):
        with patch("nion.config.agents_config.get_paths", return_value=_make_paths(tmp_path)):
            from nion.config.agents_config import list_custom_agents

            agents = list_custom_agents()

        assert agents == []

    def test_discovers_multiple_agents(self, tmp_path):
        _write_agent(tmp_path, "agent-a", {"name": "agent-a"})
        _write_agent(tmp_path, "agent-b", {"name": "agent-b", "description": "B"})

        with patch("nion.config.agents_config.get_paths", return_value=_make_paths(tmp_path)):
            from nion.config.agents_config import list_custom_agents

            agents = list_custom_agents()

        names = [a.name for a in agents]
        assert "agent-a" in names
        assert "agent-b" in names

    def test_skips_dirs_without_config_yaml(self, tmp_path):
        # Valid agent
        _write_agent(tmp_path, "valid-agent", {"name": "valid-agent"})
        # Invalid dir (no agent.json)
        (tmp_path / "agents" / "invalid-dir").mkdir(parents=True)

        with patch("nion.config.agents_config.get_paths", return_value=_make_paths(tmp_path)):
            from nion.config.agents_config import list_custom_agents

            agents = list_custom_agents()

        assert len(agents) == 1
        assert agents[0].name == "valid-agent"

    def test_skips_non_directory_entries(self, tmp_path):
        # Create the agents dir with a file (not a dir)
        agents_dir = tmp_path / "agents"
        agents_dir.mkdir(parents=True)
        (agents_dir / "not-a-dir.txt").write_text("hello")
        _write_agent(tmp_path, "real-agent", {"name": "real-agent"})

        with patch("nion.config.agents_config.get_paths", return_value=_make_paths(tmp_path)):
            from nion.config.agents_config import list_custom_agents

            agents = list_custom_agents()

        assert len(agents) == 1
        assert agents[0].name == "real-agent"

    def test_returns_sorted_by_name(self, tmp_path):
        _write_agent(tmp_path, "z-agent", {"name": "z-agent"})
        _write_agent(tmp_path, "a-agent", {"name": "a-agent"})
        _write_agent(tmp_path, "m-agent", {"name": "m-agent"})

        with patch("nion.config.agents_config.get_paths", return_value=_make_paths(tmp_path)):
            from nion.config.agents_config import list_custom_agents

            agents = list_custom_agents()

        names = [a.name for a in agents]
        assert names == sorted(names)


# ===========================================================================
# 8. Gateway API – Agents endpoints
# ===========================================================================


def _make_test_app(tmp_path: Path):
    """Create a FastAPI app with the agents router, patching paths to tmp_path."""
    from fastapi import FastAPI

    from app.gateway.routers.agents import router

    app = FastAPI()
    app.include_router(router)
    return app


@pytest.fixture()
def agent_client(tmp_path):
    """TestClient with agents router, using tmp_path as base_dir."""
    paths_instance = _make_paths(tmp_path)

    with (
        patch("nion.config.agents_config.get_paths", return_value=paths_instance),
        patch("nion.config.default_agent.get_paths", return_value=paths_instance),
        patch("app.gateway.routers.agents.get_paths", return_value=paths_instance),
    ):
        app = _make_test_app(tmp_path)
        with TestClient(app) as client:
            client._tmp_path = tmp_path  # type: ignore[attr-defined]
            yield client


class TestAgentsAPI:
    def test_list_agents_empty(self, agent_client):
        response = agent_client.get("/api/agents")
        assert response.status_code == 200
        data = response.json()
        assert data["agents"] == []

    def test_create_agent(self, agent_client):
        payload = {
            "name": "code-reviewer",
            "description": "Reviews code",
            "soul": "You are a code reviewer.",
        }
        response = agent_client.post("/api/agents", json=payload)
        assert response.status_code == 201
        data = response.json()
        assert data["name"] == "code-reviewer"
        assert data["description"] == "Reviews code"
        assert data["soul"] == "You are a code reviewer."

    def test_create_agent_invalid_name(self, agent_client):
        payload = {"name": "Code Reviewer!", "soul": "test"}
        response = agent_client.post("/api/agents", json=payload)
        assert response.status_code == 422

    def test_create_duplicate_agent_409(self, agent_client):
        payload = {"name": "my-agent", "soul": "test"}
        agent_client.post("/api/agents", json=payload)

        # Second create should fail
        response = agent_client.post("/api/agents", json=payload)
        assert response.status_code == 409

    def test_list_agents_after_create(self, agent_client):
        agent_client.post("/api/agents", json={"name": "agent-one", "soul": "p1"})
        agent_client.post("/api/agents", json={"name": "agent-two", "soul": "p2"})

        response = agent_client.get("/api/agents")
        assert response.status_code == 200
        names = [a["name"] for a in response.json()["agents"]]
        assert "agent-one" in names
        assert "agent-two" in names

    def test_get_agent(self, agent_client):
        agent_client.post("/api/agents", json={"name": "test-agent", "soul": "Hello world"})

        response = agent_client.get("/api/agents/test-agent")
        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "test-agent"
        assert data["soul"] == "Hello world"

    def test_get_agent_identity_empty_by_default(self, agent_client):
        agent_client.post("/api/agents", json={"name": "identity-agent", "soul": "Hello world"})

        response = agent_client.get("/api/agents/identity-agent/identity")
        assert response.status_code == 200
        assert response.json()["content"] == ""

    def test_put_and_get_agent_identity(self, agent_client):
        agent_client.post("/api/agents", json={"name": "identity-update", "soul": "Hello world"})

        update = agent_client.put(
            "/api/agents/identity-update/identity",
            json={"content": "Custom identity content"},
        )
        assert update.status_code == 200
        assert update.json()["content"] == "Custom identity content"

        response = agent_client.get("/api/agents/identity-update/identity")
        assert response.status_code == 200
        assert response.json()["content"] == "Custom identity content"

    def test_get_missing_agent_identity_404(self, agent_client):
        response = agent_client.get("/api/agents/nonexistent/identity")
        assert response.status_code == 404

    def test_get_missing_agent_404(self, agent_client):
        response = agent_client.get("/api/agents/nonexistent")
        assert response.status_code == 404

    def test_update_agent_soul(self, agent_client):
        agent_client.post("/api/agents", json={"name": "update-me", "soul": "original"})

        response = agent_client.put("/api/agents/update-me", json={"soul": "updated"})
        assert response.status_code == 200
        assert response.json()["soul"] == "updated"

    def test_update_agent_description(self, agent_client):
        agent_client.post("/api/agents", json={"name": "desc-agent", "description": "old desc", "soul": "p"})

        response = agent_client.put("/api/agents/desc-agent", json={"description": "new desc"})
        assert response.status_code == 200
        assert response.json()["description"] == "new desc"

    def test_update_missing_agent_404(self, agent_client):
        response = agent_client.put("/api/agents/ghost-agent", json={"soul": "new"})
        assert response.status_code == 404

    def test_delete_agent(self, agent_client):
        agent_client.post("/api/agents", json={"name": "del-me", "soul": "bye"})

        response = agent_client.delete("/api/agents/del-me")
        assert response.status_code == 204

        # Verify it's gone
        response = agent_client.get("/api/agents/del-me")
        assert response.status_code == 404

    def test_delete_missing_agent_404(self, agent_client):
        response = agent_client.delete("/api/agents/does-not-exist")
        assert response.status_code == 404

    def test_delete_default_agent_forbidden(self, agent_client):
        response = agent_client.delete("/api/agents/_default")
        assert response.status_code == 403

    def test_create_agent_with_model_and_tool_groups(self, agent_client):
        payload = {
            "name": "specialized",
            "description": "Specialized agent",
            "model": "deepseek-v3",
            "tool_groups": ["file:read", "bash"],
            "soul": "You are specialized.",
        }
        response = agent_client.post("/api/agents", json=payload)
        assert response.status_code == 201
        data = response.json()
        assert data["model"] == "deepseek-v3"
        assert data["tool_groups"] == ["file:read", "bash"]

    def test_create_persists_files_on_disk(self, agent_client, tmp_path):
        agent_client.post("/api/agents", json={"name": "disk-check", "soul": "disk soul"})

        agent_dir = tmp_path / "agents" / "disk-check"
        assert agent_dir.exists()
        assert (agent_dir / "agent.json").exists()
        assert (agent_dir / "SOUL.md").exists()
        assert (agent_dir / "SOUL.md").read_text() == "disk soul"

    def test_delete_removes_files_from_disk(self, agent_client, tmp_path):
        agent_client.post("/api/agents", json={"name": "remove-me", "soul": "bye"})
        agent_dir = tmp_path / "agents" / "remove-me"
        assert agent_dir.exists()

        agent_client.delete("/api/agents/remove-me")
        assert not agent_dir.exists()

    def test_upload_and_get_agent_avatar(self, agent_client):
        agent_client.post("/api/agents", json={"name": "avatar-agent", "soul": "avatar"})
        upload = agent_client.post(
            "/api/agents/avatar-agent/avatar",
            files={"file": ("avatar.png", _tiny_png_bytes(), "image/png")},
        )
        assert upload.status_code == 200
        body = upload.json()
        assert body["avatar_url"] == "/api/agents/avatar-agent/avatar"

        fetched = agent_client.get(body["avatar_url"])
        assert fetched.status_code == 200
        assert fetched.headers["content-type"].startswith("image/png")
        assert fetched.content.startswith(b"\x89PNG")

    def test_delete_agent_avatar(self, agent_client):
        agent_client.post("/api/agents", json={"name": "avatar-delete", "soul": "avatar"})
        agent_client.post(
            "/api/agents/avatar-delete/avatar",
            files={"file": ("avatar.png", _tiny_png_bytes(), "image/png")},
        )

        deleted = agent_client.delete("/api/agents/avatar-delete/avatar")
        assert deleted.status_code == 200
        assert deleted.json()["avatar_url"] is None

        fetched = agent_client.get("/api/agents/avatar-delete/avatar")
        assert fetched.status_code == 404


class TestDefaultAgentAPI:
    def test_get_default_agent_config(self, agent_client):
        response = agent_client.get("/api/default-agent/config")
        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "_default"
        assert "heartbeat_enabled" in data
        assert "evolution_enabled" in data

    def test_update_default_agent_config(self, agent_client):
        payload = {
            "description": "Updated default",
            "model": "gpt-4.1",
            "tool_groups": ["file:read", "bash"],
            "heartbeat_enabled": False,
            "evolution_enabled": False,
        }
        response = agent_client.put("/api/default-agent/config", json=payload)
        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "_default"
        assert data["description"] == "Updated default"
        assert data["model"] == "gpt-4.1"
        assert data["tool_groups"] == ["file:read", "bash"]
        assert data["heartbeat_enabled"] is False
        assert data["evolution_enabled"] is False

    def test_default_soul_and_identity_alias_endpoints(self, agent_client):
        soul_payload = {"content": "Default soul alias content"}
        identity_payload = {"content": "Default identity alias content"}

        response = agent_client.put("/api/soul/default", json=soul_payload)
        assert response.status_code == 200
        assert response.json()["content"] == soul_payload["content"]

        response = agent_client.get("/api/default-agent/soul")
        assert response.status_code == 200
        assert response.json()["content"] == soul_payload["content"]

        response = agent_client.put("/api/soul/identity", json=identity_payload)
        assert response.status_code == 200
        assert response.json()["content"] == identity_payload["content"]

        response = agent_client.get("/api/default-agent/identity")
        assert response.status_code == 200
        assert response.json()["content"] == identity_payload["content"]

    def test_upload_and_get_default_agent_avatar(self, agent_client):
        upload = agent_client.post(
            "/api/default-agent/avatar",
            files={"file": ("avatar.png", _tiny_png_bytes(), "image/png")},
        )
        assert upload.status_code == 200
        body = upload.json()
        assert body["avatar_url"] == "/api/default-agent/avatar"

        fetched = agent_client.get(body["avatar_url"])
        assert fetched.status_code == 200
        assert fetched.headers["content-type"].startswith("image/png")


# ===========================================================================
# 9. Gateway API – User Profile endpoints
# ===========================================================================


class TestUserProfileAPI:
    def test_get_user_profile_empty(self, agent_client):
        response = agent_client.get("/api/user-profile")
        assert response.status_code == 200
        assert response.json()["content"] is None

    def test_put_user_profile(self, agent_client, tmp_path):
        content = "# User Profile\n\nI am a developer."
        response = agent_client.put("/api/user-profile", json={"content": content})
        assert response.status_code == 200
        assert response.json()["content"] == content

        # File should be written to disk
        user_md = tmp_path / "USER.md"
        assert user_md.exists()
        assert user_md.read_text(encoding="utf-8") == content

    def test_get_user_profile_after_put(self, agent_client):
        content = "# Profile\n\nI work on data science."
        agent_client.put("/api/user-profile", json={"content": content})

        response = agent_client.get("/api/user-profile")
        assert response.status_code == 200
        assert response.json()["content"] == content

    def test_put_empty_user_profile_returns_none(self, agent_client):
        response = agent_client.put("/api/user-profile", json={"content": ""})
        assert response.status_code == 200
        assert response.json()["content"] is None
