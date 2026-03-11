"""Test default agent initialization."""

import json
import shutil
import tempfile
from pathlib import Path

import pytest

from src.config.default_agent import DEFAULT_AGENT_NAME, ensure_default_agent
from src.config.paths import Paths


def test_ensure_default_agent_creates_files():
    """Test that ensure_default_agent creates all required files."""
    with tempfile.TemporaryDirectory() as tmpdir:
        paths = Paths(base_dir=tmpdir)

        # Monkey patch get_paths to use temp directory
        import src.config.default_agent
        original_get_paths = src.config.default_agent.get_paths
        src.config.default_agent.get_paths = lambda: paths

        try:
            ensure_default_agent()

            # Verify agent directory exists
            agent_dir = paths.agent_dir(DEFAULT_AGENT_NAME)
            assert agent_dir.exists()

            # Verify agent.json exists and has correct content
            config_file = paths.agent_config_file(DEFAULT_AGENT_NAME)
            assert config_file.exists()

            with open(config_file, encoding="utf-8") as f:
                config = json.load(f)

            assert config["name"] == DEFAULT_AGENT_NAME
            assert config["description"] == "Default system agent with core capabilities"
            assert config["heartbeat_enabled"] is True
            assert config["evolution_enabled"] is True

            # Verify SOUL.md exists
            soul_file = paths.agent_soul_file(DEFAULT_AGENT_NAME)
            assert soul_file.exists()
            assert len(soul_file.read_text(encoding="utf-8")) > 0

            # Verify IDENTITY.md exists
            identity_file = paths.agent_identity_file(DEFAULT_AGENT_NAME)
            assert identity_file.exists()
            assert len(identity_file.read_text(encoding="utf-8")) > 0

        finally:
            src.config.default_agent.get_paths = original_get_paths


def test_ensure_default_agent_idempotent():
    """Test that ensure_default_agent is idempotent."""
    with tempfile.TemporaryDirectory() as tmpdir:
        paths = Paths(base_dir=tmpdir)

        import src.config.default_agent
        original_get_paths = src.config.default_agent.get_paths
        src.config.default_agent.get_paths = lambda: paths

        try:
            # First call creates the agent
            ensure_default_agent()
            config_file = paths.agent_config_file(DEFAULT_AGENT_NAME)
            first_mtime = config_file.stat().st_mtime

            # Second call should not modify files
            ensure_default_agent()
            second_mtime = config_file.stat().st_mtime

            assert first_mtime == second_mtime

        finally:
            src.config.default_agent.get_paths = original_get_paths


def test_paths_agent_config_file():
    """Test that agent_config_file returns correct path."""
    with tempfile.TemporaryDirectory() as tmpdir:
        paths = Paths(base_dir=tmpdir)
        config_file = paths.agent_config_file("test-agent")

        # Use resolve() to handle symlinks (e.g., /var -> /private/var on macOS)
        expected = (Path(tmpdir) / "agents" / "test-agent" / "agent.json").resolve()
        assert config_file == expected


def test_paths_agent_heartbeat_file():
    """Test that agent_heartbeat_file returns correct path."""
    with tempfile.TemporaryDirectory() as tmpdir:
        paths = Paths(base_dir=tmpdir)
        heartbeat_file = paths.agent_heartbeat_file("test-agent")

        expected = (Path(tmpdir) / "agents" / "test-agent" / "heartbeat.json").resolve()
        assert heartbeat_file == expected


def test_paths_agent_evolution_file():
    """Test that agent_evolution_file returns correct path."""
    with tempfile.TemporaryDirectory() as tmpdir:
        paths = Paths(base_dir=tmpdir)
        evolution_file = paths.agent_evolution_file("test-agent")

        expected = (Path(tmpdir) / "agents" / "test-agent" / "evolution.json").resolve()
        assert evolution_file == expected
