from __future__ import annotations

import json
from pathlib import Path

import pytest

from src.tools.internal_tool_recall import recommend_internal_tools


def test_recommend_internal_tools_prefers_xhs_cli_for_xiaohongshu_login(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    extensions_config = {
        "mcpServers": {},
        "skills": {},
        "clis": {
            "xhs-cli": {"enabled": True, "source": "managed", "exec": None},
            # noise
            "ripgrep": {"enabled": True, "source": "managed", "exec": None},
        },
    }
    cfg_path = tmp_path / "extensions_config.json"
    cfg_path.write_text(json.dumps(extensions_config), encoding="utf-8")
    monkeypatch.setenv("NION_EXTENSIONS_CONFIG_PATH", str(cfg_path))

    hits = recommend_internal_tools("我要登录小红书", limit=3)
    assert any(h.tool_type == "cli" and h.tool_id == "xhs-cli" for h in hits)

