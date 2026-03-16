from __future__ import annotations

from src.cli.catalog import load_cli_catalog


def test_xhs_cli_login_marked_as_pty_interactive():
    catalog = load_cli_catalog()
    tools = catalog.get("tools", [])
    xhs_tool = next((t for t in tools if t.get("id") == "xhs-cli"), None)
    assert xhs_tool is not None

    interactive = xhs_tool.get("interactive_commands") or []
    login_cmd = next((c for c in interactive if c.get("pattern") == "login"), None)
    assert login_cmd is not None
    assert login_cmd.get("input_method") == "pty"
