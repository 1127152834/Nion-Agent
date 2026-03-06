from __future__ import annotations

import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from src.config.paths import Paths, get_paths


class ChannelDatabase:
    """SQLite storage for channel bridge data (Lark/DingTalk)."""

    def __init__(self, *, db_path: Path | None = None, paths: Paths | None = None):
        base_paths = paths or get_paths()
        self._db_path = (db_path or (base_paths.base_dir / "channels.db")).resolve()
        self._db_path.parent.mkdir(parents=True, exist_ok=True)

    @property
    def db_path(self) -> Path:
        return self._db_path

    def connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self._db_path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        return conn

    @contextmanager
    def transaction(self) -> Iterator[sqlite3.Connection]:
        conn = self.connect()
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def init_schema(self) -> None:
        with self.transaction() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS channel_integrations (
                    platform TEXT PRIMARY KEY CHECK(platform IN ('lark', 'dingtalk')),
                    enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0, 1)),
                    mode TEXT NOT NULL DEFAULT 'webhook' CHECK(mode IN ('webhook', 'stream')),
                    credentials_json TEXT NOT NULL DEFAULT '{}',
                    default_workspace_id TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS channel_pairing_codes (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    platform TEXT NOT NULL CHECK(platform IN ('lark', 'dingtalk')),
                    code TEXT NOT NULL,
                    expires_at TEXT NOT NULL,
                    consumed_at TEXT,
                    created_at TEXT NOT NULL,
                    UNIQUE(platform, code)
                );
                CREATE INDEX IF NOT EXISTS idx_channel_pairing_codes_platform_expires
                  ON channel_pairing_codes(platform, expires_at DESC);

                CREATE TABLE IF NOT EXISTS channel_pair_requests (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    platform TEXT NOT NULL CHECK(platform IN ('lark', 'dingtalk')),
                    code TEXT NOT NULL,
                    external_user_id TEXT NOT NULL,
                    external_user_name TEXT,
                    chat_id TEXT NOT NULL,
                    conversation_type TEXT,
                    session_webhook TEXT,
                    source_event_id TEXT,
                    status TEXT NOT NULL CHECK(status IN ('pending', 'approved', 'rejected')),
                    note TEXT,
                    created_at TEXT NOT NULL,
                    handled_at TEXT,
                    handled_by TEXT
                );
                CREATE INDEX IF NOT EXISTS idx_channel_pair_requests_platform_status
                  ON channel_pair_requests(platform, status, created_at DESC);
                CREATE INDEX IF NOT EXISTS idx_channel_pair_requests_platform_event
                  ON channel_pair_requests(platform, source_event_id);

                CREATE TABLE IF NOT EXISTS channel_authorized_users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    platform TEXT NOT NULL CHECK(platform IN ('lark', 'dingtalk')),
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
                CREATE INDEX IF NOT EXISTS idx_channel_authorized_users_platform_active
                  ON channel_authorized_users(platform, revoked_at, granted_at DESC);
                CREATE INDEX IF NOT EXISTS idx_channel_authorized_users_workspace
                  ON channel_authorized_users(platform, workspace_id);

                CREATE TABLE IF NOT EXISTS channel_chat_threads (
                    platform TEXT NOT NULL CHECK(platform IN ('lark', 'dingtalk')),
                    chat_id TEXT NOT NULL,
                    external_user_id TEXT,
                    thread_id TEXT NOT NULL,
                    workspace_id TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY (platform, chat_id)
                );
                CREATE INDEX IF NOT EXISTS idx_channel_chat_threads_thread
                  ON channel_chat_threads(thread_id);

                CREATE TABLE IF NOT EXISTS channel_message_logs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    platform TEXT NOT NULL CHECK(platform IN ('lark', 'dingtalk')),
                    chat_id TEXT NOT NULL,
                    external_user_id TEXT,
                    source_event_id TEXT,
                    request_text TEXT NOT NULL,
                    thread_id TEXT,
                    workspace_id TEXT,
                    run_status TEXT NOT NULL CHECK(run_status IN ('pending', 'succeeded', 'failed')),
                    response_text TEXT,
                    delivery_status TEXT NOT NULL CHECK(delivery_status IN ('pending', 'delivered', 'skipped', 'failed')),
                    error_message TEXT,
                    error_code TEXT,
                    delivery_path TEXT,
                    render_mode TEXT,
                    fallback_reason TEXT,
                    stream_chunk_count INTEGER NOT NULL DEFAULT 0,
                    media_attempted_count INTEGER NOT NULL DEFAULT 0,
                    media_sent_count INTEGER NOT NULL DEFAULT 0,
                    media_failed_count INTEGER NOT NULL DEFAULT 0,
                    media_manifest_json TEXT,
                    media_fallback_reason TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_channel_message_logs_platform_created
                  ON channel_message_logs(platform, created_at DESC);

                CREATE TABLE IF NOT EXISTS channel_event_dedup (
                    platform TEXT NOT NULL CHECK(platform IN ('lark', 'dingtalk')),
                    event_id TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    PRIMARY KEY (platform, event_id)
                );
                """
            )

            # Backward-compatible migration for existing databases created
            # before the `mode` column was introduced.
            columns = {
                str(row[1])
                for row in conn.execute("PRAGMA table_info(channel_integrations)").fetchall()
            }
            if "mode" not in columns:
                conn.execute(
                    "ALTER TABLE channel_integrations ADD COLUMN mode TEXT NOT NULL DEFAULT 'webhook'"
                )

            authorized_user_columns = {
                str(row[1])
                for row in conn.execute("PRAGMA table_info(channel_authorized_users)").fetchall()
            }
            if "workspace_id" not in authorized_user_columns:
                conn.execute(
                    "ALTER TABLE channel_authorized_users ADD COLUMN workspace_id TEXT"
                )

            message_log_columns = {
                str(row[1])
                for row in conn.execute("PRAGMA table_info(channel_message_logs)").fetchall()
            }
            if "delivery_path" not in message_log_columns:
                conn.execute(
                    "ALTER TABLE channel_message_logs ADD COLUMN delivery_path TEXT"
                )
            if "render_mode" not in message_log_columns:
                conn.execute(
                    "ALTER TABLE channel_message_logs ADD COLUMN render_mode TEXT"
                )
            if "fallback_reason" not in message_log_columns:
                conn.execute(
                    "ALTER TABLE channel_message_logs ADD COLUMN fallback_reason TEXT"
                )
            if "stream_chunk_count" not in message_log_columns:
                conn.execute(
                    "ALTER TABLE channel_message_logs ADD COLUMN stream_chunk_count INTEGER NOT NULL DEFAULT 0"
                )
            if "media_attempted_count" not in message_log_columns:
                conn.execute(
                    "ALTER TABLE channel_message_logs ADD COLUMN media_attempted_count INTEGER NOT NULL DEFAULT 0"
                )
            if "media_sent_count" not in message_log_columns:
                conn.execute(
                    "ALTER TABLE channel_message_logs ADD COLUMN media_sent_count INTEGER NOT NULL DEFAULT 0"
                )
            if "media_failed_count" not in message_log_columns:
                conn.execute(
                    "ALTER TABLE channel_message_logs ADD COLUMN media_failed_count INTEGER NOT NULL DEFAULT 0"
                )
            if "media_manifest_json" not in message_log_columns:
                conn.execute(
                    "ALTER TABLE channel_message_logs ADD COLUMN media_manifest_json TEXT"
                )
            if "media_fallback_reason" not in message_log_columns:
                conn.execute(
                    "ALTER TABLE channel_message_logs ADD COLUMN media_fallback_reason TEXT"
                )
            if "error_code" not in message_log_columns:
                conn.execute(
                    "ALTER TABLE channel_message_logs ADD COLUMN error_code TEXT"
                )

            pair_request_columns = {
                str(row[1])
                for row in conn.execute("PRAGMA table_info(channel_pair_requests)").fetchall()
            }
            if "session_webhook" not in pair_request_columns:
                conn.execute(
                    "ALTER TABLE channel_pair_requests ADD COLUMN session_webhook TEXT"
                )
