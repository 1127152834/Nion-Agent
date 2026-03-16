from __future__ import annotations

import sqlite3
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any

from src.channels.bridge_service import ChannelAgentBridgeService
from src.channels.connection_service import ChannelConnectionService
from src.channels.db import ChannelDatabase
from src.channels.incoming_service import ChannelInboundService
from src.channels.repository import ChannelRepository
from src.channels.webhook_service import IncomingWebhookEvent, extract_incoming_event


class _FakeResponse:
    def __init__(self, *, status_code: int, payload: dict[str, Any], text: str = ""):
        self.status_code = status_code
        self._payload = payload
        self.text = text

    def json(self) -> dict[str, Any]:
        return self._payload


def test_telegram_webhook_event_extraction() -> None:
    payload = {
        "update_id": 10001,
        "message": {
            "message_id": 55,
            "chat": {"id": 9988, "type": "private"},
            "from": {"id": 123456, "username": "alice"},
            "text": "hello",
        },
    }

    incoming = extract_incoming_event("telegram", payload)

    assert incoming.platform == "telegram"
    assert incoming.event_id == "10001"
    assert incoming.external_user_id == "123456"
    assert incoming.external_user_name == "alice"
    assert incoming.chat_id == "9988"
    assert incoming.conversation_type == "private"
    assert incoming.text == "hello"


def test_telegram_connection_probe(monkeypatch) -> None:
    class _FakeClient:
        def __init__(self, *, timeout: float):
            self.timeout = timeout

        def __enter__(self) -> _FakeClient:
            return self

        def __exit__(self, exc_type, exc, tb) -> None:
            return None

        def get(self, endpoint: str) -> _FakeResponse:
            assert endpoint.endswith("/getMe")
            return _FakeResponse(
                status_code=200,
                payload={
                    "ok": True,
                    "result": {"id": 1, "username": "nion_bot"},
                },
            )

    monkeypatch.setattr("src.channels.connection_service.httpx.Client", _FakeClient)

    result = ChannelConnectionService().test_connection(
        "telegram",
        {"bot_token": "abc123"},
        timeout_seconds=8.0,
    )

    assert result["platform"] == "telegram"
    assert result["success"] is True
    assert "nion_bot" in result["message"]


def test_telegram_send_system_message(monkeypatch) -> None:
    captured: dict[str, Any] = {}

    class _FakeClient:
        def __init__(self, *, timeout: float):
            self.timeout = timeout

        def __enter__(self) -> _FakeClient:
            return self

        def __exit__(self, exc_type, exc, tb) -> None:
            return None

        def post(self, endpoint: str, *, json: dict[str, Any]) -> _FakeResponse:
            captured["endpoint"] = endpoint
            captured["payload"] = json
            return _FakeResponse(status_code=200, payload={"ok": True, "result": {"message_id": 1}})

    monkeypatch.setattr("src.channels.bridge_service.httpx.Client", _FakeClient)

    with TemporaryDirectory() as tmp_dir:
        db = ChannelDatabase(db_path=Path(tmp_dir) / "channels.db")
        repo = ChannelRepository(db=db)
        repo.init_schema()
        repo.upsert_integration(
            "telegram",
            enabled=True,
            mode="webhook",
            credentials={"bot_token": "abc123"},
        )

        service = ChannelAgentBridgeService(repo)
        incoming = IncomingWebhookEvent(
            platform="telegram",
            event_id="evt-1",
            external_user_id="1001",
            external_user_name="alice",
            chat_id="9988",
            conversation_type="private",
            session_webhook=None,
            text="hi",
        )
        result = service.send_system_message_with_meta(
            "telegram",
            incoming=incoming,
            text="pong",
        )

    assert result.delivered is True
    assert result.delivery_path == "telegram.api"
    assert str(captured["endpoint"]).endswith("/botabc123/sendMessage")
    assert captured["payload"]["chat_id"] == "9988"
    assert captured["payload"]["text"] == "pong"


def test_telegram_allowed_users_block_unauthorized_sender() -> None:
    with TemporaryDirectory() as tmp_dir:
        db = ChannelDatabase(db_path=Path(tmp_dir) / "channels.db")
        repo = ChannelRepository(db=db)
        repo.init_schema()
        repo.upsert_integration(
            "telegram",
            enabled=True,
            mode="webhook",
            credentials={"bot_token": "abc123", "allowed_users": "1001,1002"},
        )

        service = ChannelInboundService(repo)
        incoming = IncomingWebhookEvent(
            platform="telegram",
            event_id="evt-2",
            external_user_id="2001",
            external_user_name="mallory",
            chat_id="9988",
            conversation_type="private",
            session_webhook=None,
            text="hello",
        )
        result = service.handle_incoming_event("telegram", incoming)

    assert result.accepted is True
    assert result.action == "unauthorized_message_ignored"
    assert result.message == "telegram user not allowed"


def test_init_schema_migrates_legacy_platform_check_to_include_telegram() -> None:
    with TemporaryDirectory() as tmp_dir:
        db_path = Path(tmp_dir) / "channels.db"
        with sqlite3.connect(db_path) as conn:
            conn.executescript(
                """
                CREATE TABLE channel_integrations (
                    platform TEXT PRIMARY KEY CHECK(platform IN ('lark', 'dingtalk')),
                    enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0, 1)),
                    credentials_json TEXT NOT NULL DEFAULT '{}',
                    default_workspace_id TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                """
            )

        db = ChannelDatabase(db_path=db_path)
        repo = ChannelRepository(db=db)
        repo.init_schema()
        result = repo.upsert_integration(
            "telegram",
            enabled=True,
            mode="stream",
            credentials={"bot_token": "abc123"},
        )

        assert result["platform"] == "telegram"
        assert result["mode"] == "stream"


def test_init_schema_adds_session_columns_to_legacy_channel_tables() -> None:
    with TemporaryDirectory() as tmp_dir:
        db_path = Path(tmp_dir) / "channels.db"
        with sqlite3.connect(db_path) as conn:
            conn.executescript(
                """
                CREATE TABLE channel_integrations (
                    platform TEXT PRIMARY KEY CHECK(platform IN ('lark', 'dingtalk', 'telegram')),
                    enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0, 1)),
                    mode TEXT NOT NULL DEFAULT 'webhook' CHECK(mode IN ('webhook', 'stream')),
                    credentials_json TEXT NOT NULL DEFAULT '{}',
                    default_workspace_id TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE channel_authorized_users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    platform TEXT NOT NULL CHECK(platform IN ('lark', 'dingtalk', 'telegram')),
                    external_user_id TEXT NOT NULL,
                    external_user_name TEXT,
                    chat_id TEXT,
                    conversation_type TEXT,
                    workspace_id TEXT,
                    granted_at TEXT NOT NULL,
                    revoked_at TEXT,
                    source_request_id INTEGER REFERENCES channel_pair_requests(id) ON DELETE SET NULL,
                    UNIQUE(platform, external_user_id)
                );
                """
            )

        db = ChannelDatabase(db_path=db_path)
        repo = ChannelRepository(db=db)
        repo.init_schema()

        with db.connect() as conn:
            integration_columns = {str(row[1]) for row in conn.execute("PRAGMA table_info(channel_integrations)").fetchall()}
            authorized_user_columns = {str(row[1]) for row in conn.execute("PRAGMA table_info(channel_authorized_users)").fetchall()}

        assert "session_json" in integration_columns
        assert "session_override_json" in authorized_user_columns


def test_channel_repository_session_round_trip_and_clear_override() -> None:
    with TemporaryDirectory() as tmp_dir:
        db = ChannelDatabase(db_path=Path(tmp_dir) / "channels.db")
        repo = ChannelRepository(db=db)
        repo.init_schema()

        integration = repo.upsert_integration(
            "telegram",
            enabled=True,
            mode="stream",
            credentials={"bot_token": "abc123"},
            session={
                "assistant_id": "channel_agent",
                "config": {"recursion_limit": 48},
                "context": {
                    "thinking_enabled": True,
                    "is_plan_mode": False,
                },
            },
        )
        assert integration["session"] == {
            "assistant_id": "channel_agent",
            "config": {"recursion_limit": 48},
            "context": {
                "thinking_enabled": True,
                "is_plan_mode": False,
            },
        }

        request = repo.create_pair_request(
            "telegram",
            code="654321",
            external_user_id="1001",
            external_user_name="alice",
            chat_id="9988",
            conversation_type="private",
            session_webhook=None,
            source_event_id="evt-override",
        )
        repo.approve_pair_request(
            "telegram",
            int(request["id"]),
            workspace_id="default",
        )
        authorized_user = repo.get_authorized_user("telegram", "1001")
        assert authorized_user is not None
        assert authorized_user["session_override"] is None

        updated = repo.update_authorized_user_session_override(
            "telegram",
            int(authorized_user["id"]),
            session_override={
                "assistant_id": "user_agent",
                "config": {"recursion_limit": 12},
                "context": {
                    "thinking_enabled": False,
                    "subagent_enabled": True,
                },
            },
        )
        assert updated["session_override"] == {
            "assistant_id": "user_agent",
            "config": {"recursion_limit": 12},
            "context": {
                "thinking_enabled": False,
                "subagent_enabled": True,
            },
        }
        assert repo.list_authorized_users("telegram")[0]["session_override"] == updated["session_override"]

        cleared = repo.update_authorized_user_session_override(
            "telegram",
            int(authorized_user["id"]),
            session_override=None,
        )
        assert cleared["session_override"] is None


def test_channel_bridge_resolve_run_settings_prefers_user_override_then_channel_default() -> None:
    with TemporaryDirectory() as tmp_dir:
        db = ChannelDatabase(db_path=Path(tmp_dir) / "channels.db")
        repo = ChannelRepository(db=db)
        repo.init_schema()
        repo.upsert_integration(
            "telegram",
            enabled=True,
            mode="stream",
            credentials={"bot_token": "abc123"},
            session={
                "assistant_id": "channel_agent",
                "config": {"recursion_limit": 40},
                "context": {
                    "thinking_enabled": True,
                    "is_plan_mode": False,
                },
            },
        )
        request = repo.create_pair_request(
            "telegram",
            code="123456",
            external_user_id="1001",
            external_user_name="alice",
            chat_id="9988",
            conversation_type="private",
            session_webhook=None,
            source_event_id="evt-run-settings",
        )
        repo.approve_pair_request("telegram", int(request["id"]), workspace_id="default")
        authorized_user = repo.get_authorized_user("telegram", "1001")
        assert authorized_user is not None
        authorized_user = repo.update_authorized_user_session_override(
            "telegram",
            int(authorized_user["id"]),
            session_override={
                "assistant_id": "user_agent",
                "config": {"recursion_limit": 18},
                "context": {
                    "thinking_enabled": False,
                    "subagent_enabled": True,
                },
            },
        )
        service = ChannelAgentBridgeService(repo)
        incoming = IncomingWebhookEvent(
            platform="telegram",
            event_id="evt-run-settings",
            external_user_id="1001",
            external_user_name="alice",
            chat_id="9988",
            conversation_type="private",
            session_webhook=None,
            text="hello",
        )

        assistant_id, run_config, run_context = service._resolve_run_settings(
            integration=repo.get_integration("telegram"),
            authorized_user=authorized_user,
            thread_id="thread-1",
            workspace_id="default",
            incoming=incoming,
        )

        assert assistant_id == "user_agent"
        assert run_config == {"recursion_limit": 18}
        assert run_context == {
            "thread_id": "thread-1",
            "workspace_id": "default",
            "user_id": "1001",
            "locale": "zh-CN",
            "thinking_enabled": False,
            "is_plan_mode": False,
            "subagent_enabled": True,
        }

        cleared_user = repo.update_authorized_user_session_override(
            "telegram",
            int(authorized_user["id"]),
            session_override=None,
        )
        fallback_assistant_id, fallback_run_config, fallback_run_context = service._resolve_run_settings(
            integration=repo.get_integration("telegram"),
            authorized_user=cleared_user,
            thread_id="thread-1",
            workspace_id="default",
            incoming=incoming,
        )

        assert fallback_assistant_id == "channel_agent"
        assert fallback_run_config == {"recursion_limit": 40}
        assert fallback_run_context == {
            "thread_id": "thread-1",
            "workspace_id": "default",
            "user_id": "1001",
            "locale": "zh-CN",
            "thinking_enabled": True,
            "is_plan_mode": False,
        }


def test_channel_bridge_resolve_run_settings_only_sends_explicit_fields() -> None:
    with TemporaryDirectory() as tmp_dir:
        db = ChannelDatabase(db_path=Path(tmp_dir) / "channels.db")
        repo = ChannelRepository(db=db)
        repo.init_schema()
        repo.upsert_integration(
            "telegram",
            enabled=True,
            mode="webhook",
            credentials={"bot_token": "abc123"},
            session={"assistant_id": "custom_agent"},
        )
        service = ChannelAgentBridgeService(repo)
        incoming = IncomingWebhookEvent(
            platform="telegram",
            event_id="evt-explicit-only",
            external_user_id="1001",
            external_user_name="alice",
            chat_id="9988",
            conversation_type="private",
            session_webhook=None,
            text="hello",
        )

        assistant_id, run_config, run_context = service._resolve_run_settings(
            integration=repo.get_integration("telegram"),
            authorized_user=None,
            thread_id="thread-2",
            workspace_id="default",
            incoming=incoming,
        )

        assert assistant_id == "custom_agent"
        assert run_config is None
        assert run_context == {
            "thread_id": "thread-2",
            "workspace_id": "default",
            "user_id": "1001",
            "locale": "zh-CN",
        }
