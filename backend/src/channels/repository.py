from __future__ import annotations

import json
import secrets
import sqlite3
from datetime import UTC, datetime, timedelta
from typing import Any

from src.channels.db import ChannelDatabase
from src.config.paths import Paths

SUPPORTED_CHANNEL_PLATFORMS = {"lark", "dingtalk"}
SUPPORTED_CHANNEL_MODES = {"webhook", "stream"}


class ChannelRepositoryNotFoundError(Exception):
    """Raised when a requested channel row does not exist."""


def _utcnow() -> str:
    return datetime.now(UTC).isoformat()


def _parse_utc(value: str | None) -> datetime | None:
    if not value:
        return None
    normalized = value.replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def _row_to_dict(row: sqlite3.Row | None) -> dict[str, Any] | None:
    if row is None:
        return None
    data = dict(row)
    for key in ("enabled",):
        if key in data and data[key] is not None:
            data[key] = bool(data[key])
    return data


def _ensure_platform(platform: str) -> str:
    normalized = platform.strip().lower()
    if normalized not in SUPPORTED_CHANNEL_PLATFORMS:
        raise ValueError(f"Unsupported channel platform: {platform}")
    return normalized


def _ensure_mode(mode: str | None) -> str:
    normalized = str(mode or "webhook").strip().lower() or "webhook"
    if normalized not in SUPPORTED_CHANNEL_MODES:
        raise ValueError(f"Unsupported channel mode: {mode}")
    return normalized


class ChannelRepository:
    def __init__(self, *, db: ChannelDatabase | None = None, paths: Paths | None = None):
        self._db = db or ChannelDatabase(paths=paths)

    def init_schema(self) -> None:
        self._db.init_schema()

    def get_integration(self, platform: str) -> dict[str, Any]:
        normalized = _ensure_platform(platform)
        with self._db.connect() as conn:
            row = conn.execute(
                "SELECT * FROM channel_integrations WHERE platform = ?",
                (normalized,),
            ).fetchone()
        data = _row_to_dict(row)
        if data is None:
            return {
                "platform": normalized,
                "enabled": False,
                "mode": "webhook",
                "credentials": {},
                "default_workspace_id": None,
                "created_at": None,
                "updated_at": None,
            }
        raw_credentials = str(data.get("credentials_json") or "{}")
        try:
            credentials = json.loads(raw_credentials)
        except json.JSONDecodeError:
            credentials = {}
        if not isinstance(credentials, dict):
            credentials = {}
        return {
            "platform": normalized,
            "enabled": bool(data.get("enabled")),
            "mode": _ensure_mode(str(data.get("mode") or "webhook")),
            "credentials": {str(k): str(v) for k, v in credentials.items()},
            "default_workspace_id": data.get("default_workspace_id"),
            "created_at": data.get("created_at"),
            "updated_at": data.get("updated_at"),
        }

    def list_integrations(self) -> list[dict[str, Any]]:
        return [self.get_integration(platform) for platform in sorted(SUPPORTED_CHANNEL_PLATFORMS)]

    def upsert_integration(
        self,
        platform: str,
        *,
        enabled: bool,
        mode: str = "webhook",
        credentials: dict[str, str],
        default_workspace_id: str | None = None,
    ) -> dict[str, Any]:
        normalized = _ensure_platform(platform)
        normalized_mode = _ensure_mode(mode)
        now = _utcnow()
        credentials_json = json.dumps(credentials, ensure_ascii=False, sort_keys=True)
        with self._db.transaction() as conn:
            conn.execute(
                """
                INSERT INTO channel_integrations(
                    platform, enabled, mode, credentials_json, default_workspace_id, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(platform)
                DO UPDATE SET
                    enabled = excluded.enabled,
                    mode = excluded.mode,
                    credentials_json = excluded.credentials_json,
                    default_workspace_id = excluded.default_workspace_id,
                    updated_at = excluded.updated_at
                """,
                (
                    normalized,
                    int(enabled),
                    normalized_mode,
                    credentials_json,
                    default_workspace_id,
                    now,
                    now,
                ),
            )
        return self.get_integration(normalized)

    def create_pairing_code(self, platform: str, *, ttl_minutes: int = 10) -> dict[str, Any]:
        normalized = _ensure_platform(platform)
        now_dt = datetime.now(UTC)
        now = now_dt.isoformat()
        expires_at = (now_dt + timedelta(minutes=max(1, ttl_minutes))).isoformat()

        last_error: sqlite3.Error | None = None
        for _ in range(20):
            code = f"{secrets.randbelow(1_000_000):06d}"
            try:
                with self._db.transaction() as conn:
                    cursor = conn.execute(
                        """
                        INSERT INTO channel_pairing_codes(platform, code, expires_at, created_at)
                        VALUES (?, ?, ?, ?)
                        """,
                        (normalized, code, expires_at, now),
                    )
                    row = conn.execute(
                        "SELECT * FROM channel_pairing_codes WHERE id = ?",
                        (cursor.lastrowid,),
                    ).fetchone()
                result = _row_to_dict(row)
                if result is None:
                    raise RuntimeError("Failed to create channel pairing code")
                return result
            except sqlite3.IntegrityError as exc:
                last_error = exc
        raise RuntimeError("Failed to generate unique pairing code") from last_error

    def consume_pairing_code(self, platform: str, code: str) -> dict[str, Any] | None:
        normalized = _ensure_platform(platform)
        normalized_code = code.strip()
        now_dt = datetime.now(UTC)
        now = now_dt.isoformat()
        with self._db.transaction() as conn:
            row = conn.execute(
                """
                SELECT * FROM channel_pairing_codes
                WHERE platform = ? AND code = ? AND consumed_at IS NULL
                ORDER BY id DESC LIMIT 1
                """,
                (normalized, normalized_code),
            ).fetchone()
            result = _row_to_dict(row)
            if result is None:
                return None
            expires_at = _parse_utc(str(result.get("expires_at") or ""))
            if expires_at is None or expires_at <= now_dt:
                return None
            conn.execute(
                "UPDATE channel_pairing_codes SET consumed_at = ? WHERE id = ?",
                (now, result["id"]),
            )
        result["consumed_at"] = now
        return result

    def mark_event_processed(self, platform: str, event_id: str) -> bool:
        normalized = _ensure_platform(platform)
        normalized_event_id = event_id.strip()
        if not normalized_event_id:
            return True
        with self._db.transaction() as conn:
            cursor = conn.execute(
                """
                INSERT OR IGNORE INTO channel_event_dedup(platform, event_id, created_at)
                VALUES (?, ?, ?)
                """,
                (normalized, normalized_event_id, _utcnow()),
            )
        return cursor.rowcount > 0

    def cleanup_event_dedup(self, *, max_age_seconds: int = 300) -> int:
        now_dt = datetime.now(UTC)
        cutoff = (now_dt - timedelta(seconds=max(60, int(max_age_seconds)))).isoformat()
        with self._db.transaction() as conn:
            cursor = conn.execute(
                "DELETE FROM channel_event_dedup WHERE created_at < ?",
                (cutoff,),
            )
        return int(cursor.rowcount)

    def create_pair_request(
        self,
        platform: str,
        *,
        code: str,
        external_user_id: str,
        external_user_name: str | None,
        chat_id: str,
        conversation_type: str | None,
        session_webhook: str | None,
        source_event_id: str | None,
    ) -> dict[str, Any]:
        normalized = _ensure_platform(platform)
        now = _utcnow()
        with self._db.transaction() as conn:
            normalized_session_webhook = (
                session_webhook.strip()
                if isinstance(session_webhook, str) and session_webhook.strip()
                else None
            )
            try:
                cursor = conn.execute(
                    """
                    INSERT INTO channel_pair_requests(
                        platform, code, external_user_id, external_user_name, chat_id,
                        conversation_type, session_webhook, source_event_id, status, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
                    """,
                    (
                        normalized,
                        code.strip(),
                        external_user_id.strip(),
                        external_user_name,
                        chat_id.strip(),
                        conversation_type,
                        normalized_session_webhook,
                        source_event_id,
                        now,
                    ),
                )
            except sqlite3.OperationalError as exc:
                # Compatibility fallback for processes still running against pre-migration schemas.
                if "session_webhook" not in str(exc).lower():
                    raise
                cursor = conn.execute(
                    """
                    INSERT INTO channel_pair_requests(
                        platform, code, external_user_id, external_user_name, chat_id,
                        conversation_type, source_event_id, status, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)
                    """,
                    (
                        normalized,
                        code.strip(),
                        external_user_id.strip(),
                        external_user_name,
                        chat_id.strip(),
                        conversation_type,
                        source_event_id,
                        now,
                    ),
                )
            row = conn.execute(
                "SELECT * FROM channel_pair_requests WHERE id = ?",
                (cursor.lastrowid,),
            ).fetchone()
        result = _row_to_dict(row)
        if result is None:
            raise RuntimeError("Failed to create channel pair request")
        return result

    def get_pending_pair_request(
        self,
        platform: str,
        *,
        external_user_id: str,
        chat_id: str,
    ) -> dict[str, Any] | None:
        normalized = _ensure_platform(platform)
        normalized_external_user_id = external_user_id.strip()
        normalized_chat_id = chat_id.strip()
        if not normalized_external_user_id and not normalized_chat_id:
            return None

        clauses: list[str] = []
        params: list[Any] = [normalized]
        if normalized_external_user_id:
            clauses.append("external_user_id = ?")
            params.append(normalized_external_user_id)
        if normalized_chat_id:
            clauses.append("chat_id = ?")
            params.append(normalized_chat_id)
        if not clauses:
            return None

        sql = (
            "SELECT * FROM channel_pair_requests "
            "WHERE platform = ? AND status = 'pending' AND ("
            + " OR ".join(clauses)
            + ") ORDER BY created_at DESC LIMIT 1"
        )
        with self._db.connect() as conn:
            row = conn.execute(sql, tuple(params)).fetchone()
        return _row_to_dict(row)

    def list_pair_requests(
        self,
        platform: str,
        *,
        status: str | None = None,
        limit: int = 50,
    ) -> list[dict[str, Any]]:
        normalized = _ensure_platform(platform)
        sql = "SELECT * FROM channel_pair_requests WHERE platform = ?"
        params: list[Any] = [normalized]
        if status:
            sql += " AND status = ?"
            params.append(status)
        sql += " ORDER BY created_at DESC LIMIT ?"
        params.append(max(1, min(limit, 500)))
        with self._db.connect() as conn:
            rows = conn.execute(sql, tuple(params)).fetchall()
        result: list[dict[str, Any]] = []
        for row in rows:
            converted = _row_to_dict(row)
            if converted is not None:
                result.append(converted)
        return result

    def _get_pair_request(self, conn: sqlite3.Connection, platform: str, request_id: int) -> dict[str, Any]:
        row = conn.execute(
            "SELECT * FROM channel_pair_requests WHERE platform = ? AND id = ?",
            (platform, request_id),
        ).fetchone()
        result = _row_to_dict(row)
        if result is None:
            raise ChannelRepositoryNotFoundError(f"channel pair request {request_id} not found")
        return result

    def approve_pair_request(
        self,
        platform: str,
        request_id: int,
        *,
        handled_by: str | None = None,
        note: str | None = None,
        workspace_id: str | None = None,
    ) -> dict[str, Any]:
        normalized = _ensure_platform(platform)
        now = _utcnow()
        normalized_workspace_id = (
            workspace_id.strip() if isinstance(workspace_id, str) and workspace_id.strip() else None
        )
        with self._db.transaction() as conn:
            request = self._get_pair_request(conn, normalized, request_id)
            conn.execute(
                """
                UPDATE channel_pair_requests
                SET status = 'approved', note = ?, handled_at = ?, handled_by = ?
                WHERE id = ?
                """,
                (note, now, handled_by, request_id),
            )
            conn.execute(
                """
                INSERT INTO channel_authorized_users(
                    platform, external_user_id, external_user_name, chat_id,
                    conversation_type, workspace_id, granted_at, revoked_at, source_request_id
                ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)
                ON CONFLICT(platform, external_user_id)
                DO UPDATE SET
                    external_user_name = excluded.external_user_name,
                    chat_id = excluded.chat_id,
                    conversation_type = excluded.conversation_type,
                    workspace_id = excluded.workspace_id,
                    granted_at = excluded.granted_at,
                    revoked_at = NULL,
                    source_request_id = excluded.source_request_id
                """,
                (
                    normalized,
                    str(request.get("external_user_id") or ""),
                    request.get("external_user_name"),
                    request.get("chat_id"),
                    request.get("conversation_type"),
                    normalized_workspace_id,
                    now,
                    request_id,
                ),
            )
            row = conn.execute(
                "SELECT * FROM channel_pair_requests WHERE id = ?",
                (request_id,),
            ).fetchone()
        result = _row_to_dict(row)
        if result is None:
            raise RuntimeError(f"Failed to approve pair request {request_id}")
        return result

    def reject_pair_request(
        self,
        platform: str,
        request_id: int,
        *,
        handled_by: str | None = None,
        note: str | None = None,
    ) -> dict[str, Any]:
        normalized = _ensure_platform(platform)
        now = _utcnow()
        with self._db.transaction() as conn:
            _ = self._get_pair_request(conn, normalized, request_id)
            conn.execute(
                """
                UPDATE channel_pair_requests
                SET status = 'rejected', note = ?, handled_at = ?, handled_by = ?
                WHERE id = ?
                """,
                (note, now, handled_by, request_id),
            )
            row = conn.execute(
                "SELECT * FROM channel_pair_requests WHERE id = ?",
                (request_id,),
            ).fetchone()
        result = _row_to_dict(row)
        if result is None:
            raise RuntimeError(f"Failed to reject pair request {request_id}")
        return result

    def list_authorized_users(self, platform: str, *, active_only: bool = True) -> list[dict[str, Any]]:
        normalized = _ensure_platform(platform)
        sql = "SELECT * FROM channel_authorized_users WHERE platform = ?"
        params: list[Any] = [normalized]
        if active_only:
            sql += " AND revoked_at IS NULL"
        sql += " ORDER BY granted_at DESC, id DESC"
        with self._db.connect() as conn:
            rows = conn.execute(sql, tuple(params)).fetchall()
        result: list[dict[str, Any]] = []
        for row in rows:
            converted = _row_to_dict(row)
            if converted is not None:
                result.append(converted)
        return result

    def revoke_authorized_user(self, platform: str, user_id: int, *, handled_by: str | None = None) -> bool:
        normalized = _ensure_platform(platform)
        now = _utcnow()
        with self._db.transaction() as conn:
            cursor = conn.execute(
                """
                UPDATE channel_authorized_users
                SET revoked_at = ?
                WHERE platform = ? AND id = ? AND revoked_at IS NULL
                """,
                (now, normalized, user_id),
            )
        _ = handled_by  # keep signature for future audit extension
        return cursor.rowcount > 0

    def is_authorized_user(self, platform: str, external_user_id: str) -> bool:
        return self.get_authorized_user(platform, external_user_id, active_only=True) is not None

    def get_authorized_user(
        self,
        platform: str,
        external_user_id: str,
        *,
        active_only: bool = True,
    ) -> dict[str, Any] | None:
        normalized = _ensure_platform(platform)
        normalized_external_user_id = external_user_id.strip()
        if not normalized_external_user_id:
            return None
        sql = """
            SELECT * FROM channel_authorized_users
            WHERE platform = ? AND external_user_id = ?
        """
        params: list[Any] = [normalized, normalized_external_user_id]
        if active_only:
            sql += " AND revoked_at IS NULL"
        sql += " ORDER BY granted_at DESC, id DESC LIMIT 1"
        with self._db.connect() as conn:
            row = conn.execute(
                sql,
                tuple(params),
            ).fetchone()
        return _row_to_dict(row)

    def get_authorized_user_by_chat(
        self,
        platform: str,
        chat_id: str,
        *,
        active_only: bool = True,
    ) -> dict[str, Any] | None:
        normalized = _ensure_platform(platform)
        normalized_chat_id = chat_id.strip()
        if not normalized_chat_id:
            return None
        sql = """
            SELECT * FROM channel_authorized_users
            WHERE platform = ? AND chat_id = ?
        """
        params: list[Any] = [normalized, normalized_chat_id]
        if active_only:
            sql += " AND revoked_at IS NULL"
        sql += " ORDER BY granted_at DESC, id DESC LIMIT 1"
        with self._db.connect() as conn:
            row = conn.execute(
                sql,
                tuple(params),
            ).fetchone()
        return _row_to_dict(row)

    def rebind_authorized_user_identity(
        self,
        platform: str,
        user_id: int,
        *,
        external_user_id: str,
        external_user_name: str | None = None,
        chat_id: str | None = None,
    ) -> dict[str, Any]:
        normalized = _ensure_platform(platform)
        normalized_external_user_id = external_user_id.strip()
        if not normalized_external_user_id:
            raise ValueError("external_user_id is required")
        normalized_chat_id = chat_id.strip() if isinstance(chat_id, str) and chat_id.strip() else None
        normalized_external_user_name = (
            external_user_name.strip()
            if isinstance(external_user_name, str) and external_user_name.strip()
            else None
        )
        with self._db.transaction() as conn:
            cursor = conn.execute(
                """
                UPDATE channel_authorized_users
                SET external_user_id = ?,
                    external_user_name = COALESCE(?, external_user_name),
                    chat_id = COALESCE(?, chat_id)
                WHERE platform = ? AND id = ? AND revoked_at IS NULL
                """,
                (
                    normalized_external_user_id,
                    normalized_external_user_name,
                    normalized_chat_id,
                    normalized,
                    user_id,
                ),
            )
            if cursor.rowcount == 0:
                raise ChannelRepositoryNotFoundError(
                    f"channel authorized user {user_id} not found"
                )
            row = conn.execute(
                "SELECT * FROM channel_authorized_users WHERE id = ?",
                (user_id,),
            ).fetchone()
        result = _row_to_dict(row)
        if result is None:
            raise ChannelRepositoryNotFoundError(f"channel authorized user {user_id} not found")
        return result

    def update_authorized_user_workspace(
        self,
        platform: str,
        user_id: int,
        *,
        workspace_id: str | None,
    ) -> dict[str, Any]:
        normalized = _ensure_platform(platform)
        normalized_workspace_id = (
            workspace_id.strip() if isinstance(workspace_id, str) and workspace_id.strip() else None
        )
        with self._db.transaction() as conn:
            cursor = conn.execute(
                """
                UPDATE channel_authorized_users
                SET workspace_id = ?
                WHERE platform = ? AND id = ? AND revoked_at IS NULL
                """,
                (
                    normalized_workspace_id,
                    normalized,
                    user_id,
                ),
            )
            if cursor.rowcount == 0:
                raise ChannelRepositoryNotFoundError(
                    f"channel authorized user {user_id} not found"
                )
            row = conn.execute(
                "SELECT * FROM channel_authorized_users WHERE id = ?",
                (user_id,),
            ).fetchone()
        result = _row_to_dict(row)
        if result is None:
            raise ChannelRepositoryNotFoundError(f"channel authorized user {user_id} not found")
        return result

    def get_chat_thread(self, platform: str, chat_id: str) -> dict[str, Any] | None:
        normalized = _ensure_platform(platform)
        with self._db.connect() as conn:
            row = conn.execute(
                "SELECT * FROM channel_chat_threads WHERE platform = ? AND chat_id = ?",
                (normalized, chat_id.strip()),
            ).fetchone()
        return _row_to_dict(row)

    def upsert_chat_thread(
        self,
        platform: str,
        *,
        chat_id: str,
        external_user_id: str | None,
        thread_id: str,
        workspace_id: str,
    ) -> dict[str, Any]:
        normalized = _ensure_platform(platform)
        now = _utcnow()
        with self._db.transaction() as conn:
            conn.execute(
                """
                INSERT INTO channel_chat_threads(
                    platform, chat_id, external_user_id, thread_id, workspace_id, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(platform, chat_id)
                DO UPDATE SET
                    external_user_id = excluded.external_user_id,
                    thread_id = excluded.thread_id,
                    workspace_id = excluded.workspace_id,
                    updated_at = excluded.updated_at
                """,
                (
                    normalized,
                    chat_id.strip(),
                    external_user_id.strip() if isinstance(external_user_id, str) else None,
                    thread_id.strip(),
                    workspace_id.strip(),
                    now,
                    now,
                ),
            )
            row = conn.execute(
                "SELECT * FROM channel_chat_threads WHERE platform = ? AND chat_id = ?",
                (normalized, chat_id.strip()),
            ).fetchone()
        result = _row_to_dict(row)
        if result is None:
            raise RuntimeError("Failed to upsert channel chat thread")
        return result

    def create_message_log(
        self,
        platform: str,
        *,
        chat_id: str,
        external_user_id: str | None,
        source_event_id: str | None,
        request_text: str,
        thread_id: str | None = None,
        workspace_id: str | None = None,
        delivery_path: str | None = None,
        render_mode: str | None = None,
        fallback_reason: str | None = None,
        stream_chunk_count: int | None = None,
        media_attempted_count: int | None = None,
        media_sent_count: int | None = None,
        media_failed_count: int | None = None,
        media_manifest_json: str | None = None,
        media_fallback_reason: str | None = None,
        error_code: str | None = None,
    ) -> dict[str, Any]:
        normalized = _ensure_platform(platform)
        now = _utcnow()
        normalized_stream_chunk_count = (
            max(0, int(stream_chunk_count)) if stream_chunk_count is not None else 0
        )
        normalized_media_attempted_count = (
            max(0, int(media_attempted_count)) if media_attempted_count is not None else 0
        )
        normalized_media_sent_count = (
            max(0, int(media_sent_count)) if media_sent_count is not None else 0
        )
        normalized_media_failed_count = (
            max(0, int(media_failed_count)) if media_failed_count is not None else 0
        )
        with self._db.transaction() as conn:
            cursor = conn.execute(
                """
                INSERT INTO channel_message_logs(
                    platform, chat_id, external_user_id, source_event_id, request_text,
                    thread_id, workspace_id, run_status, response_text,
                    delivery_status, error_message, error_code, delivery_path, render_mode, fallback_reason,
                    stream_chunk_count, media_attempted_count, media_sent_count, media_failed_count,
                    media_manifest_json, media_fallback_reason, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', NULL, 'pending', NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    normalized,
                    chat_id.strip(),
                    external_user_id.strip() if isinstance(external_user_id, str) else None,
                    source_event_id.strip() if isinstance(source_event_id, str) and source_event_id.strip() else None,
                    request_text,
                    thread_id,
                    workspace_id,
                    error_code,
                    delivery_path,
                    render_mode,
                    fallback_reason,
                    normalized_stream_chunk_count,
                    normalized_media_attempted_count,
                    normalized_media_sent_count,
                    normalized_media_failed_count,
                    media_manifest_json,
                    media_fallback_reason,
                    now,
                    now,
                ),
            )
            row = conn.execute(
                "SELECT * FROM channel_message_logs WHERE id = ?",
                (cursor.lastrowid,),
            ).fetchone()
        result = _row_to_dict(row)
        if result is None:
            raise RuntimeError("Failed to create channel message log")
        return result

    def finish_message_log(
        self,
        log_id: int,
        *,
        run_status: str,
        delivery_status: str,
        response_text: str | None = None,
        error_message: str | None = None,
        thread_id: str | None = None,
        workspace_id: str | None = None,
        delivery_path: str | None = None,
        render_mode: str | None = None,
        fallback_reason: str | None = None,
        stream_chunk_count: int | None = None,
        media_attempted_count: int | None = None,
        media_sent_count: int | None = None,
        media_failed_count: int | None = None,
        media_manifest_json: str | None = None,
        media_fallback_reason: str | None = None,
        error_code: str | None = None,
    ) -> dict[str, Any]:
        allowed_run_status = {"pending", "succeeded", "failed"}
        allowed_delivery_status = {"pending", "delivered", "skipped", "failed"}
        if run_status not in allowed_run_status:
            raise ValueError(f"Invalid run_status: {run_status}")
        if delivery_status not in allowed_delivery_status:
            raise ValueError(f"Invalid delivery_status: {delivery_status}")
        normalized_stream_chunk_count = (
            max(0, int(stream_chunk_count)) if stream_chunk_count is not None else None
        )
        normalized_media_attempted_count = (
            max(0, int(media_attempted_count)) if media_attempted_count is not None else None
        )
        normalized_media_sent_count = (
            max(0, int(media_sent_count)) if media_sent_count is not None else None
        )
        normalized_media_failed_count = (
            max(0, int(media_failed_count)) if media_failed_count is not None else None
        )

        now = _utcnow()
        with self._db.transaction() as conn:
            cursor = conn.execute(
                """
                UPDATE channel_message_logs
                SET run_status = ?, delivery_status = ?, response_text = ?, error_message = ?,
                    error_code = COALESCE(?, error_code),
                    thread_id = COALESCE(?, thread_id),
                    workspace_id = COALESCE(?, workspace_id),
                    delivery_path = COALESCE(?, delivery_path),
                    render_mode = COALESCE(?, render_mode),
                    fallback_reason = COALESCE(?, fallback_reason),
                    stream_chunk_count = COALESCE(?, stream_chunk_count),
                    media_attempted_count = COALESCE(?, media_attempted_count),
                    media_sent_count = COALESCE(?, media_sent_count),
                    media_failed_count = COALESCE(?, media_failed_count),
                    media_manifest_json = COALESCE(?, media_manifest_json),
                    media_fallback_reason = COALESCE(?, media_fallback_reason),
                    updated_at = ?
                WHERE id = ?
                """,
                (
                    run_status,
                    delivery_status,
                    response_text,
                    error_message,
                    error_code,
                    thread_id,
                    workspace_id,
                    delivery_path,
                    render_mode,
                    fallback_reason,
                    normalized_stream_chunk_count,
                    normalized_media_attempted_count,
                    normalized_media_sent_count,
                    normalized_media_failed_count,
                    media_manifest_json,
                    media_fallback_reason,
                    now,
                    log_id,
                ),
            )
            if cursor.rowcount == 0:
                raise ChannelRepositoryNotFoundError(f"channel message log {log_id} not found")
            row = conn.execute(
                "SELECT * FROM channel_message_logs WHERE id = ?",
                (log_id,),
            ).fetchone()
        result = _row_to_dict(row)
        if result is None:
            raise ChannelRepositoryNotFoundError(f"channel message log {log_id} not found")
        return result

    def reset_platform_data(self, platform: str) -> dict[str, int]:
        normalized = _ensure_platform(platform)
        stats: dict[str, int] = {
            "event_dedup": 0,
            "message_logs": 0,
            "chat_threads": 0,
            "authorized_users": 0,
            "pair_requests": 0,
            "pairing_codes": 0,
        }
        with self._db.transaction() as conn:
            for table_name, key_name in (
                ("channel_event_dedup", "event_dedup"),
                ("channel_message_logs", "message_logs"),
                ("channel_chat_threads", "chat_threads"),
                ("channel_authorized_users", "authorized_users"),
                ("channel_pair_requests", "pair_requests"),
                ("channel_pairing_codes", "pairing_codes"),
            ):
                cursor = conn.execute(
                    f"DELETE FROM {table_name} WHERE platform = ?",
                    (normalized,),
                )
                stats[key_name] = int(cursor.rowcount)
        return stats
