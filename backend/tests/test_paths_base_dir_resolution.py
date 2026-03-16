"""Tests for Paths base_dir resolution priority.

These tests intentionally assert the runtime data directory default does NOT
depend on the current working directory, so local development cannot
accidentally write application state into the repository checkout.
"""

from __future__ import annotations

from pathlib import Path

from nion.config.paths import Paths


def test_base_dir_prefers_constructor_argument(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("NION_HOME", str(tmp_path / "env-home"))
    explicit = tmp_path / "explicit-home"
    paths = Paths(base_dir=explicit)
    assert paths.base_dir == explicit.resolve()


def test_base_dir_prefers_env_over_home(monkeypatch, tmp_path: Path) -> None:
    env_home = tmp_path / "env-home"
    monkeypatch.setenv("NION_HOME", str(env_home))
    paths = Paths()
    assert paths.base_dir == env_home.resolve()


def test_base_dir_defaults_to_user_home(monkeypatch, tmp_path: Path) -> None:
    # Ensure the env override is not set; default should be $HOME/.nion.
    monkeypatch.delenv("NION_HOME", raising=False)
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    paths = Paths()
    assert paths.base_dir == (tmp_path / ".nion").resolve()
