from __future__ import annotations

from pathlib import Path

from src.cli.manifests import load_cli_install_manifest
from src.config.paths import get_paths


def resolve_managed_cli_command(tool_id: str, argv: list[str]) -> list[str]:
    """
    Resolve the managed CLI entrypoint into a host-absolute shim path.

    Managed CLIs are installed under the Nion app data directory (e.g. ~/.nion/clis).
    The install manifest records the shim location (shim_rel) under that root.
    """
    manifest = load_cli_install_manifest(tool_id)
    if manifest is None or not manifest.bins:
        raise RuntimeError(f"Managed CLI manifest missing or has no bins: {tool_id}")

    shim_rel = manifest.bins[0].shim_rel
    rel = str(Path(shim_rel)).lstrip("/").replace("\\", "/")
    shim_abs = (get_paths().clis_root_dir / rel).resolve()

    return [str(shim_abs), *argv]
