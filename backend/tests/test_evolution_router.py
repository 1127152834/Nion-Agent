from __future__ import annotations

from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.config.paths import Paths
from src.gateway.routers.evolution import router


def _make_app() -> FastAPI:
    app = FastAPI()
    app.include_router(router)
    return app


def test_evolution_run_creates_report_and_returns_202(tmp_path):
    app = _make_app()
    paths = Paths(base_dir=tmp_path)

    with patch("src.evolution.store.get_paths", return_value=paths):
        with TestClient(app) as client:
            resp = client.post("/api/evolution/run?agent_name=_default")
            assert resp.status_code == 202
            payload = resp.json()
            assert payload["status"] == "completed"
            assert payload["report_id"]

            # reports endpoint should return the new record
            reports = client.get("/api/evolution/reports?agent_name=_default").json()
            assert len(reports) >= 1
            assert reports[0]["report_id"] == payload["report_id"]

