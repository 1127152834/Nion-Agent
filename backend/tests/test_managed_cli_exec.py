from __future__ import annotations

import json
from pathlib import Path

import pytest

from nion.cli.managed_cli_exec import resolve_managed_cli_command


def test_resolve_managed_cli_command_uses_manifest_shim_path(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    # Arrange: fake ~/.nion paths
    from nion.config import paths as paths_mod

    fake_root = tmp_path / "nion"
    (fake_root / "clis" / "manifests").mkdir(parents=True)
    (fake_root / "clis" / "bin").mkdir(parents=True)

    shim_rel = "bin/xhs"
    shim_abs = fake_root / "clis" / shim_rel
    shim_abs.write_text("#!/bin/sh\necho ok\n", encoding="utf-8")
    shim_abs.chmod(0o755)

    manifest_json = {
        "tool_id": "xhs-cli",
        "version": "0.1.4",
        "os": "macos",
        "arch": "arm64",
        "bins": [
            {
                "name": "xhs",
                "shim_rel": shim_rel,
                "real_rel": "uv/tools/xhs-cli/bin/xhs",
            }
        ],
        "healthcheck_argv": [],
        "healthcheck_expect_contains": None,
    }
    (fake_root / "clis" / "manifests" / "xhs-cli.json").write_text(
        json.dumps(manifest_json),
        encoding="utf-8",
    )

    # Patch get_paths() singleton to point to fake root
    monkeypatch.setattr(paths_mod, "_paths", paths_mod.Paths(base_dir=fake_root))

    # Act
    cmd = resolve_managed_cli_command("xhs-cli", ["login"])

    # Assert
    assert cmd[0] == str(shim_abs)
    assert cmd[1:] == ["login"]


def test_resolve_managed_cli_command_raises_when_manifest_missing(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    from nion.config import paths as paths_mod

    fake_root = tmp_path / "nion"
    fake_root.mkdir(parents=True)
    monkeypatch.setattr(paths_mod, "_paths", paths_mod.Paths(base_dir=fake_root))

    with pytest.raises(RuntimeError):
        resolve_managed_cli_command("missing-cli", ["--version"])
