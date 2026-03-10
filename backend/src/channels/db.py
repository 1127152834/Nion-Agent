from __future__ import annotations

import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from src.config.paths import Paths, get_paths

_PLATFORM_CHECK_LEGACY = "check(platform in ('lark', 'dingtalk'))"
_PLATFORM_CHECK_CURRENT = "check(platform in ('lark', 'dingtalk', 'telegram'))"

_TABLE_DDL: dict[str, str] = {
    "channel_integrations": """
        CREATE TABLE channel_integrations (
            platform TEXT PRIMARY KEY CHECK(platform IN ('lark', 'dingtalk', 'telegram')),
            enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0, 1)),
            mode TEXT NOT NULL DEFAULT 'webhook' CHECK(mode IN ('webhook', 'stream')),
            credentials_json TEXT NOT NULL DEFAULT '{}',
            default_workspace_id TEXT,
            session_json TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
    """,
    "channel_pairing_codes": """
        CREATE TABLE channel_pairing_codes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            platform TEXT NOT NULL CHECK(platform IN ('lark', 'dingtalk', 'telegram')),
            code TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            consumed_at TEXT,
            created_at TEXT NOT NULL,
            UNIQUE(platform, code)
        )
    """,
    "channel_pair_requests": """
        CREATE TABLE channel_pair_requests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            platform TEXT NOT NULL CHECK(platform IN ('lark', 'dingtalk', 'telegram')),
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
        )
    """,
    "channel_authorized_users": """
        CREATE TABLE channel_authorized_users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            platform TEXT NOT NULL CHECK(platform IN ('lark', 'dingtalk', 'telegram')),
            external_user_id TEXT NOT NULL,
            external_user_name TEXT,
            chat_id TEXT,
            conversation_type TEXT,
            workspace_id TEXT,
            session_override_json TEXT,
            granted_at TEXT NOT NULL,
            revoked_at TEXT,
            source_request_id INTEGER REFERENCES channel_pair_requests(id) ON DELETE SET NULL,
            UNIQUE(platform, external_user_id)
        )
    """,
    "channel_chat_threads": """
        CREATE TABLE channel_chat_threads (
            platform TEXT NOT NULL CHECK(platform IN ('lark', 'dingtalk', 'telegram')),
            chat_id TEXT NOT NULL,
            external_user_id TEXT,
            thread_id TEXT NOT NULL,
            workspace_id TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (platform, chat_id)
        )
    """,
    "channel_message_logs": """
        CREATE TABLE channel_message_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            platform TEXT NOT NULL CHECK(platform IN ('lark', 'dingtalk', 'telegram')),
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
        )
    """,
    "channel_event_dedup": """
        CREATE TABLE channel_event_dedup (
            platform TEXT NOT NULL CHECK(platform IN ('lark', 'dingtalk', 'telegram')),
            event_id TEXT NOT NULL,
            created_at TEXT NOT NULL,
            PRIMARY KEY (platform, event_id)
        )
    """,
}

_INDEXES_DDL = """
    CREATE INDEX IF NOT EXISTS idx_channel_pairing_codes_platform_expires
      ON channel_pairing_codes(platform, expires_at DESC);
    CREATE INDEX IF NOT EXISTS idx_channel_pair_requests_platform_status
      ON channel_pair_requests(platform, status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_channel_pair_requests_platform_event
      ON channel_pair_requests(platform, source_event_id);
    CREATE INDEX IF NOT EXISTS idx_channel_authorized_users_platform_active
      ON channel_authorized_users(platform, revoked_at, granted_at DESC);
    CREATE INDEX IF NOT EXISTS idx_channel_authorized_users_workspace
      ON channel_authorized_users(platform, workspace_id);
    CREATE INDEX IF NOT EXISTS idx_channel_chat_threads_thread
      ON channel_chat_threads(thread_id);
    CREATE INDEX IF NOT EXISTS idx_channel_message_logs_platform_created
      ON channel_message_logs(platform, created_at DESC);
"""

_SCHEMA_DDL = f"""
    CREATE TABLE IF NOT EXISTS channel_integrations (
        platform TEXT PRIMARY KEY CHECK(platform IN ('lark', 'dingtalk', 'telegram')),
        enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0, 1)),
        mode TEXT NOT NULL DEFAULT 'webhook' CHECK(mode IN ('webhook', 'stream')),
        credentials_json TEXT NOT NULL DEFAULT '{{}}',
        default_workspace_id TEXT,
        session_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS channel_pairing_codes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        platform TEXT NOT NULL CHECK(platform IN ('lark', 'dingtalk', 'telegram')),
        code TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        consumed_at TEXT,
        created_at TEXT NOT NULL,
        UNIQUE(platform, code)
    );

    CREATE TABLE IF NOT EXISTS channel_pair_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        platform TEXT NOT NULL CHECK(platform IN ('lark', 'dingtalk', 'telegram')),
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

    CREATE TABLE IF NOT EXISTS channel_authorized_users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        platform TEXT NOT NULL CHECK(platform IN ('lark', 'dingtalk', 'telegram')),
        external_user_id TEXT NOT NULL,
        external_user_name TEXT,
        chat_id TEXT,
        conversation_type TEXT,
        workspace_id TEXT,
        session_override_json TEXT,
        granted_at TEXT NOT NULL,
        revoked_at TEXT,
        source_request_id INTEGER REFERENCES channel_pair_requests(id) ON DELETE SET NULL,
        UNIQUE(platform, external_user_id)
    );

    CREATE TABLE IF NOT EXISTS channel_chat_threads (
        platform TEXT NOT NULL CHECK(platform IN ('lark', 'dingtalk', 'telegram')),
        chat_id TEXT NOT NULL,
        external_user_id TEXT,
        thread_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (platform, chat_id)
    );

    CREATE TABLE IF NOT EXISTS channel_message_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        platform TEXT NOT NULL CHECK(platform IN ('lark', 'dingtalk', 'telegram')),
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

    CREATE TABLE IF NOT EXISTS channel_event_dedup (
        platform TEXT NOT NULL CHECK(platform IN ('lark', 'dingtalk', 'telegram')),
        event_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (platform, event_id)
    );
"""


class ChannelDatabase:
    """SQLite storage for channel bridge data (Lark/DingTalk/Telegram)."""

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
            conn.executescript(_SCHEMA_DDL)
            self._ensure_indexes(conn)

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
            if "session_json" not in columns:
                conn.execute(
                    "ALTER TABLE channel_integrations ADD COLUMN session_json TEXT"
                )

            authorized_user_columns = {
                str(row[1])
                for row in conn.execute("PRAGMA table_info(channel_authorized_users)").fetchall()
            }
            if "workspace_id" not in authorized_user_columns:
                conn.execute(
                    "ALTER TABLE channel_authorized_users ADD COLUMN workspace_id TEXT"
                )
            if "session_override_json" not in authorized_user_columns:
                conn.execute(
                    "ALTER TABLE channel_authorized_users ADD COLUMN session_override_json TEXT"
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

            self._migrate_platform_check_constraints(conn)
            self._ensure_indexes(conn)

    @staticmethod
    def _table_sql(conn: sqlite3.Connection, table_name: str) -> str:
        row = conn.execute(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?",
            (table_name,),
        ).fetchone()
        if row is None or row[0] is None:
            return ""
        return str(row[0])

    @staticmethod
    def _normalize_sql(sql: str) -> str:
        return " ".join(sql.lower().split())

    def _needs_platform_check_migration(self, conn: sqlite3.Connection, table_name: str) -> bool:
        normalized = self._normalize_sql(self._table_sql(conn, table_name))
        if not normalized:
            return False
        if _PLATFORM_CHECK_CURRENT in normalized:
            return False
        return _PLATFORM_CHECK_LEGACY in normalized

    @staticmethod
    def _copy_shared_columns(
        conn: sqlite3.Connection,
        source_table: str,
        target_table: str,
    ) -> None:
        source_columns = {
            str(row[1]) for row in conn.execute(f"PRAGMA table_info({source_table})").fetchall()
        }
        target_columns = [
            str(row[1]) for row in conn.execute(f"PRAGMA table_info({target_table})").fetchall()
        ]
        shared_columns = [column for column in target_columns if column in source_columns]
        if not shared_columns:
            return
        quoted_columns = ", ".join(f'"{column}"' for column in shared_columns)
        conn.execute(
            f'INSERT INTO "{target_table}" ({quoted_columns}) '
            f'SELECT {quoted_columns} FROM "{source_table}"'
        )

    def _recreate_table_with_current_constraint(
        self,
        conn: sqlite3.Connection,
        table_name: str,
    ) -> None:
        ddl = _TABLE_DDL[table_name].strip()
        legacy_table = f"{table_name}__legacy"
        conn.execute(f'DROP TABLE IF EXISTS "{legacy_table}"')
        conn.execute(f'ALTER TABLE "{table_name}" RENAME TO "{legacy_table}"')
        conn.execute(ddl)
        self._copy_shared_columns(conn, legacy_table, table_name)
        conn.execute(f'DROP TABLE "{legacy_table}"')

    def _recreate_pair_and_authorized_tables(self, conn: sqlite3.Connection) -> None:
        pair_legacy = "channel_pair_requests__legacy"
        auth_legacy = "channel_authorized_users__legacy"

        conn.execute(f'DROP TABLE IF EXISTS "{pair_legacy}"')
        conn.execute(f'DROP TABLE IF EXISTS "{auth_legacy}"')
        conn.execute('ALTER TABLE "channel_pair_requests" RENAME TO "channel_pair_requests__legacy"')
        conn.execute('ALTER TABLE "channel_authorized_users" RENAME TO "channel_authorized_users__legacy"')

        conn.execute(_TABLE_DDL["channel_pair_requests"].strip())
        conn.execute(_TABLE_DDL["channel_authorized_users"].strip())

        self._copy_shared_columns(conn, pair_legacy, "channel_pair_requests")
        self._copy_shared_columns(conn, auth_legacy, "channel_authorized_users")

        conn.execute(f'DROP TABLE "{auth_legacy}"')
        conn.execute(f'DROP TABLE "{pair_legacy}"')

    def _migrate_platform_check_constraints(self, conn: sqlite3.Connection) -> None:
        needs_pair = self._needs_platform_check_migration(conn, "channel_pair_requests")
        needs_auth = self._needs_platform_check_migration(conn, "channel_authorized_users")
        migrated = False

        if needs_pair:
            # If parent table is rebuilt, rebuild child table as well to keep FK target correct.
            self._recreate_pair_and_authorized_tables(conn)
            migrated = True
            needs_auth = False
        elif needs_auth:
            self._recreate_table_with_current_constraint(conn, "channel_authorized_users")
            migrated = True

        for table_name in (
            "channel_integrations",
            "channel_pairing_codes",
            "channel_chat_threads",
            "channel_message_logs",
            "channel_event_dedup",
        ):
            if not self._needs_platform_check_migration(conn, table_name):
                continue
            self._recreate_table_with_current_constraint(conn, table_name)
            migrated = True

        if migrated:
            conn.execute("PRAGMA optimize")

    @staticmethod
    def _ensure_indexes(conn: sqlite3.Connection) -> None:
        conn.executescript(_INDEXES_DDL)
