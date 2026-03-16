from __future__ import annotations

import json
from pathlib import Path

import pytest

from src.config.extensions_config import ExtensionsConfig


def _reset_paths_singleton(monkeypatch: pytest.MonkeyPatch) -> None:
    # get_paths() caches Paths() and would otherwise ignore test-time env changes.
    import src.config.paths as paths_module

    paths_module._paths = None  # type: ignore[attr-defined]


def test_resolve_config_path_prefers_nion_home(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    nion_home = tmp_path / "nion-home"
    nion_home.mkdir(parents=True, exist_ok=True)
    monkeypatch.setenv("NION_HOME", str(nion_home))
    monkeypatch.delenv("NION_EXTENSIONS_CONFIG_PATH", raising=False)
    _reset_paths_singleton(monkeypatch)

    # Place extensions_config.json under NION_HOME (canonical location).
    cfg_path = nion_home / "extensions_config.json"
    cfg_path.write_text(json.dumps({"mcpServers": {}, "skills": {}, "clis": {}}), encoding="utf-8")

    # Ensure CWD does not contain a legacy config file.
    other = tmp_path / "other-cwd"
    other.mkdir(parents=True, exist_ok=True)
    monkeypatch.chdir(other)

    resolved = ExtensionsConfig.resolve_config_path()
    assert resolved == cfg_path.resolve()


def test_from_file_returns_empty_config_when_env_path_missing(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    # If the env var points to a file that does not exist yet (first run),
    # the app should not crash; it should behave as "no extensions configured".
    missing = tmp_path / "does-not-exist" / "extensions_config.json"
    monkeypatch.setenv("NION_EXTENSIONS_CONFIG_PATH", str(missing))

    cfg = ExtensionsConfig.from_file()
    assert cfg.mcp_servers == {}
    assert cfg.skills == {}
    assert cfg.clis == {}


def test_resolve_config_path_falls_back_to_cwd(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    # When no canonical config exists, keep supporting the legacy "CWD/parent" lookup
    # for development workflows.
    monkeypatch.delenv("NION_EXTENSIONS_CONFIG_PATH", raising=False)

    # Point NION_HOME somewhere else without an extensions config.
    monkeypatch.setenv("NION_HOME", str(tmp_path / "nion-home"))
    _reset_paths_singleton(monkeypatch)

    cwd = tmp_path / "project" / "backend"
    cwd.mkdir(parents=True, exist_ok=True)
    legacy = cwd.parent / "extensions_config.json"
    legacy.write_text(json.dumps({"mcpServers": {"context7": {"enabled": True}}}), encoding="utf-8")
    monkeypatch.chdir(cwd)

    resolved = ExtensionsConfig.resolve_config_path()
    assert resolved == legacy.resolve()
