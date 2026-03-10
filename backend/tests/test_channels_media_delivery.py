from __future__ import annotations

import json
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any

from src.channels.bridge_service import ChannelAgentBridgeService
from src.channels.db import ChannelDatabase
from src.channels.repository import ChannelRepository
from src.channels.webhook_service import IncomingWebhookEvent
from src.config.paths import Paths


class _FakeResponse:
    def __init__(self, *, status_code: int, payload: dict[str, Any], text: str = ""):
        self.status_code = status_code
        self._payload = payload
        self.text = text

    def json(self) -> dict[str, Any]:
        return self._payload


def _make_service(tmp_dir: str) -> tuple[ChannelAgentBridgeService, Paths]:
    db = ChannelDatabase(db_path=Path(tmp_dir) / "channels.db")
    repo = ChannelRepository(db=db)
    repo.init_schema()
    paths = Paths(base_dir=tmp_dir)
    return ChannelAgentBridgeService(repo, paths=paths), paths


def _make_outputs_file(paths: Paths, thread_id: str, name: str, *, size_bytes: int = 8) -> str:
    outputs_dir = paths.sandbox_outputs_dir(thread_id)
    outputs_dir.mkdir(parents=True, exist_ok=True)
    file_path = outputs_dir / name
    file_path.write_bytes(b"x" * size_bytes)
    return f"/mnt/user-data/outputs/{name}"


def test_lark_media_delivery_success(monkeypatch) -> None:
    calls: list[tuple[str, dict[str, Any]]] = []

    class _FakeClient:
        def __init__(self, *, timeout: float):
            self.timeout = timeout

        def __enter__(self) -> "_FakeClient":
            return self

        def __exit__(self, exc_type, exc, tb) -> None:
            return None

        def post(self, url: str, **kwargs: Any) -> _FakeResponse:
            calls.append((url, kwargs))
            if "tenant_access_token/internal" in url:
                return _FakeResponse(status_code=200, payload={"code": 0, "tenant_access_token": "t1"})
            if "/im/v1/images" in url:
                return _FakeResponse(status_code=200, payload={"code": 0, "data": {"image_key": "img_1"}})
            if "/im/v1/files" in url:
                return _FakeResponse(status_code=200, payload={"code": 0, "data": {"file_key": "file_1"}})
            if "/im/v1/messages" in url:
                return _FakeResponse(status_code=200, payload={"code": 0, "data": {"message_id": "m1"}})
            return _FakeResponse(status_code=404, payload={"code": 1, "msg": "not found"})

    monkeypatch.setattr("src.channels.bridge_service.httpx.Client", _FakeClient)

    with TemporaryDirectory() as tmp_dir:
        service, paths = _make_service(tmp_dir)
        thread_id = "thread1"
        img = _make_outputs_file(paths, thread_id, "pic.png")
        doc = _make_outputs_file(paths, thread_id, "report.pdf")

        incoming = IncomingWebhookEvent(
            platform="lark",
            event_id="evt-1",
            external_user_id="u1",
            external_user_name="alice",
            chat_id="c1",
            conversation_type="private",
            session_webhook=None,
            text="hi",
        )

        report = service._deliver_lark_media_assets(
            credentials={"app_id": "app", "app_secret": "secret"},
            incoming=incoming,
            thread_id=thread_id,
            workspace_id="ws1",
            artifact_paths=[img, doc],
        )

    assert report.sent_count == 2
    assert report.failed_count == 0
    manifest = json.loads(report.manifest_json or "[]")
    assert any(item.get("status") == "sent" for item in manifest)

    message_calls = [
        kwargs["json"]
        for url, kwargs in calls
        if "/im/v1/messages" in url and isinstance(kwargs.get("json"), dict)
    ]
    assert all(payload.get("msg_type") != "text" for payload in message_calls)


def test_lark_media_delivery_skip_large_file_sends_fallback(monkeypatch) -> None:
    calls: list[tuple[str, dict[str, Any]]] = []

    class _FakeClient:
        def __init__(self, *, timeout: float):
            self.timeout = timeout

        def __enter__(self) -> "_FakeClient":
            return self

        def __exit__(self, exc_type, exc, tb) -> None:
            return None

        def post(self, url: str, **kwargs: Any) -> _FakeResponse:
            calls.append((url, kwargs))
            if "tenant_access_token/internal" in url:
                return _FakeResponse(status_code=200, payload={"code": 0, "tenant_access_token": "t1"})
            if "/im/v1/messages" in url:
                return _FakeResponse(status_code=200, payload={"code": 0, "data": {"message_id": "m1"}})
            return _FakeResponse(status_code=200, payload={"code": 0, "data": {}})

    monkeypatch.setattr("src.channels.bridge_service.httpx.Client", _FakeClient)
    monkeypatch.setenv("NION_CHANNEL_MEDIA_MAX_FILE_MB", "1")

    with TemporaryDirectory() as tmp_dir:
        service, paths = _make_service(tmp_dir)
        thread_id = "thread2"
        oversized = _make_outputs_file(paths, thread_id, "big.pdf", size_bytes=2 * 1024 * 1024)

        incoming = IncomingWebhookEvent(
            platform="lark",
            event_id="evt-2",
            external_user_id="u2",
            external_user_name="bob",
            chat_id="c2",
            conversation_type="private",
            session_webhook=None,
            text="hi",
        )

        report = service._deliver_lark_media_assets(
            credentials={"app_id": "app", "app_secret": "secret"},
            incoming=incoming,
            thread_id=thread_id,
            workspace_id="ws1",
            artifact_paths=[oversized],
        )

    assert report.sent_count == 0
    assert report.failed_count == 0
    assert report.fallback_reason == "media_skipped"
    message_calls = [
        kwargs["json"]
        for url, kwargs in calls
        if "/im/v1/messages" in url and isinstance(kwargs.get("json"), dict)
    ]
    assert any(payload.get("msg_type") == "text" for payload in message_calls)


def test_telegram_media_delivery_success(monkeypatch) -> None:
    calls: list[str] = []

    class _FakeClient:
        def __init__(self, *, timeout: float):
            self.timeout = timeout

        def __enter__(self) -> "_FakeClient":
            return self

        def __exit__(self, exc_type, exc, tb) -> None:
            return None

        def post(self, url: str, **kwargs: Any) -> _FakeResponse:
            calls.append(url)
            return _FakeResponse(status_code=200, payload={"ok": True, "result": {"message_id": 1}})

    monkeypatch.setattr("src.channels.bridge_service.httpx.Client", _FakeClient)

    with TemporaryDirectory() as tmp_dir:
        service, paths = _make_service(tmp_dir)
        thread_id = "thread3"
        img = _make_outputs_file(paths, thread_id, "pic.png")
        doc = _make_outputs_file(paths, thread_id, "notes.txt")

        incoming = IncomingWebhookEvent(
            platform="telegram",
            event_id="evt-3",
            external_user_id="u3",
            external_user_name="carol",
            chat_id="c3",
            conversation_type="private",
            session_webhook=None,
            text="hi",
        )

        report = service._deliver_telegram_media_assets(
            credentials={"bot_token": "bot123"},
            incoming=incoming,
            thread_id=thread_id,
            workspace_id="ws1",
            artifact_paths=[img, doc],
        )

    assert report.sent_count == 2
    assert report.failed_count == 0
    assert any("sendPhoto" in url for url in calls)
    assert any("sendDocument" in url for url in calls)
