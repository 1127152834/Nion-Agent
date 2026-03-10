from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.gateway import config as gateway_config_module
from src.gateway.routers import runtime_topology


def _make_client(monkeypatch, *, desktop: bool) -> TestClient:
    monkeypatch.setenv("NION_DESKTOP_RUNTIME", "1" if desktop else "0")
    monkeypatch.setenv("GATEWAY_HOST", "127.0.0.1")
    monkeypatch.setenv("GATEWAY_PORT", "8001")
    monkeypatch.setenv(
        "CORS_ORIGINS",
        "http://localhost:3000,http://127.0.0.1:3000",
    )
    monkeypatch.setenv("LANGGRAPH_SERVER_BASE_URL", "http://localhost:2024")
    gateway_config_module._gateway_config = None

    app = FastAPI()
    app.include_router(runtime_topology.router)
    return TestClient(app)


def test_runtime_topology_reports_desktop_mode(monkeypatch) -> None:
    client = _make_client(monkeypatch, desktop=True)

    response = client.get("/api/runtime/topology")

    assert response.status_code == 200
    payload = response.json()
    assert payload["runtime_mode"] == "desktop"
    assert payload["gateway_host"] == "127.0.0.1"
    assert payload["gateway_port"] == 8001
    assert payload["langgraph_upstream"] == "http://localhost:2024"
    assert payload["gateway_facade_path"] == "/api/langgraph"
    assert payload["frontend_allowed_origins"] == [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ]


def test_runtime_topology_reports_web_mode(monkeypatch) -> None:
    client = _make_client(monkeypatch, desktop=False)

    response = client.get("/api/runtime/topology")

    assert response.status_code == 200
    payload = response.json()
    assert payload["runtime_mode"] == "web"
    assert payload["browser_should_use_gateway_facade"] is True
