from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient

import src.gateway.routers.openviking as openviking_router


class _DummyProvider:
    name = "openviking"

    def __init__(self) -> None:
        self.calls: list[tuple[str, str | None]] = []

    def get_memory_items(self, *, scope: str = "global", agent_name: str | None = None):
        self.calls.append((scope, agent_name))
        return [{"memory_id": "m1", "summary": "demo", "uri": "viking://manifest/m1"}]


def test_BE_GATEWAY_MEM_501_items_default_agent_aliases_to_global(monkeypatch):
    provider = _DummyProvider()
    monkeypatch.setattr(openviking_router, "get_default_memory_provider", lambda: provider)

    app = FastAPI()
    app.include_router(openviking_router.router)
    client = TestClient(app)

    res = client.get("/api/openviking/items?scope=agent&agent_name=_default")
    assert res.status_code == 200
    payload = res.json()

    assert provider.calls == [("global", None)]
    assert payload["scope"] == "global"
    assert payload["items"] and payload["items"][0]["memory_id"] == "m1"

