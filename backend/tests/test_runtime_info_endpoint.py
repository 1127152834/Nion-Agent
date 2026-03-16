from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient

import src.config.paths as paths_mod
import src.gateway.routers.runtime_info as runtime_info


def test_BE_GATEWAY_RUNTIME_601_runtime_info_reports_base_dir(monkeypatch, tmp_path):
    # Ensure get_paths() resolves from NION_HOME during this test, even if another
    # test imported the singleton earlier in the same session.
    monkeypatch.setenv("NION_HOME", str(tmp_path))
    monkeypatch.setattr(paths_mod, "_paths", None)

    app = FastAPI()
    app.include_router(runtime_info.router)
    client = TestClient(app)

    res = client.get("/api/runtime/info")
    assert res.status_code == 200
    payload = res.json()

    assert payload["base_dir"] == str(tmp_path)
    assert payload["default_agent_name"] == "_default"
    assert payload["default_agent_normalized"] is None
    assert isinstance(payload["sentence_transformers_available"], bool)

