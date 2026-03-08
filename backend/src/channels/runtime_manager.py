from __future__ import annotations

import json
import logging
import os
import re
import threading
from collections.abc import Callable
from contextlib import contextmanager, nullcontext
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Protocol
from urllib.request import getproxies

import httpx

from src.channels.incoming_service import ChannelInboundResult, ChannelInboundService
from src.channels.repository import SUPPORTED_CHANNEL_PLATFORMS, ChannelRepository
from src.channels.webhook_service import IncomingWebhookEvent, extract_incoming_event

logger = logging.getLogger(__name__)


def _utcnow() -> str:
    return datetime.now(UTC).isoformat()


def _safe_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    return str(value).strip()


def _resolve_dingtalk_proxy_mode(credentials: dict[str, str]) -> str:
    normalized = _safe_text(
        credentials.get("proxy_mode")
        or os.getenv("NION_DINGTALK_PROXY_MODE")
        or "auto"
    ).lower()
    if normalized not in {"auto", "direct", "system"}:
        return "auto"
    return normalized


class ChannelStreamFatalError(RuntimeError):
    """A non-retriable stream runtime error."""


class ChannelStreamDriver(Protocol):
    def run_forever(
        self,
        *,
        platform: str,
        credentials: dict[str, str],
        stop_event: threading.Event,
        on_connected: Callable[[], None],
        on_disconnected: Callable[[str | None], None],
        on_active_users: Callable[[int], None],
        on_event: Callable[[IncomingWebhookEvent], None],
    ) -> None:
        ...


class _UnavailableStreamDriver:
    def __init__(self, platform: str, reason: str):
        self._platform = platform
        self._reason = reason

    def run_forever(
        self,
        *,
        platform: str,
        credentials: dict[str, str],
        stop_event: threading.Event,
        on_connected: Callable[[], None],
        on_disconnected: Callable[[str | None], None],
        on_active_users: Callable[[int], None],
        on_event: Callable[[IncomingWebhookEvent], None],
    ) -> None:
        _ = credentials
        _ = stop_event
        _ = on_connected
        _ = on_disconnected
        _ = on_active_users
        _ = on_event
        raise ChannelStreamFatalError(
            f"stream driver '{self._platform}' unavailable: {self._reason}"
        )


class _LarkStreamDriver:
    """Best-effort Lark stream driver based on official lark-oapi python SDK."""

    def _build_event_handler(
        self,
        lark_sdk: Any,
        credentials: dict[str, str],
        on_event: Callable[[IncomingWebhookEvent], None],
        on_active_users: Callable[[int], None],
    ) -> Any:
        verification_token = _safe_text(credentials.get("verification_token"))
        encrypt_key = _safe_text(credentials.get("encrypt_key"))
        active_users: set[str] = set()

        def _message_handler(data: Any) -> None:
            payload = self._coerce_lark_payload(data)
            incoming = extract_incoming_event("lark", payload)
            if incoming.external_user_id:
                active_users.add(incoming.external_user_id)
                on_active_users(len(active_users))
            on_event(incoming)

        dispatcher_builder = getattr(
            getattr(lark_sdk, "EventDispatcherHandler", None),
            "builder",
            None,
        )
        if dispatcher_builder is None:
            raise ChannelStreamFatalError(
                "lark-oapi EventDispatcherHandler.builder not found"
            )
        dispatcher = (
            dispatcher_builder(verification_token, encrypt_key)
            .register_p2_im_message_receive_v1(_message_handler)
            .build()
        )
        return dispatcher

    def _coerce_lark_payload(self, data: Any) -> dict[str, Any]:
        if isinstance(data, dict):
            if "event" in data:
                return data
            return {"event": data}

        payload: dict[str, Any] = {}
        header = getattr(data, "header", None)
        if header is not None:
            payload["header"] = {
                "event_id": _safe_text(getattr(header, "event_id", None)),
            }
        event = getattr(data, "event", None)
        if event is not None:
            message = getattr(event, "message", None)
            sender = getattr(event, "sender", None)
            payload["event"] = {
                "message": {
                    "chat_id": _safe_text(getattr(message, "chat_id", None)),
                    "chat_type": _safe_text(getattr(message, "chat_type", None)),
                    "content": _safe_text(getattr(message, "content", None)),
                },
                "sender": {
                    "sender_id": {
                        "open_id": _safe_text(
                            getattr(getattr(sender, "sender_id", None), "open_id", None)
                        ),
                        "user_id": _safe_text(
                            getattr(getattr(sender, "sender_id", None), "user_id", None)
                        ),
                    },
                    "sender_name": _safe_text(getattr(sender, "sender_name", None)),
                },
            }
        return payload

    def run_forever(
        self,
        *,
        platform: str,
        credentials: dict[str, str],
        stop_event: threading.Event,
        on_connected: Callable[[], None],
        on_disconnected: Callable[[str | None], None],
        on_active_users: Callable[[int], None],
        on_event: Callable[[IncomingWebhookEvent], None],
    ) -> None:
        _ = platform
        app_id = _safe_text(credentials.get("app_id") or credentials.get("cli_a"))
        app_secret = _safe_text(credentials.get("app_secret") or credentials.get("secret"))
        if not app_id or not app_secret:
            raise ChannelStreamFatalError("missing app_id/app_secret")

        try:
            import lark_oapi as lark  # type: ignore[import-not-found]
        except Exception as exc:  # pragma: no cover - depends on optional dependency
            raise ChannelStreamFatalError(
                "missing dependency 'lark-oapi', install it before enabling stream mode"
            ) from exc

        ws_client: Any | None = None
        ws_thread: threading.Thread | None = None
        failure: Exception | None = None

        def _run_client() -> None:
            nonlocal ws_client, failure
            try:
                event_handler = self._build_event_handler(
                    lark,
                    credentials,
                    on_event,
                    on_active_users,
                )
                ws_client = lark.ws.Client(
                    app_id,
                    app_secret,
                    event_handler=event_handler,
                    log_level=getattr(lark, "LogLevel", object()).INFO
                    if hasattr(getattr(lark, "LogLevel", object()), "INFO")
                    else None,
                )
                on_connected()
                ws_client.start()
            except Exception as exc:  # pragma: no cover - external SDK path
                failure = exc

        ws_thread = threading.Thread(
            target=_run_client,
            name="channel-lark-stream-worker",
            daemon=True,
        )
        ws_thread.start()

        while not stop_event.is_set():
            if failure is not None:
                on_disconnected(str(failure))
                raise RuntimeError(str(failure))
            if not ws_thread.is_alive():
                break
            stop_event.wait(0.5)

        if ws_client is not None and hasattr(ws_client, "stop"):
            try:
                ws_client.stop()
            except Exception:  # pragma: no cover - best effort
                pass

        if ws_thread.is_alive():
            ws_thread.join(timeout=2.0)
        on_disconnected(None)


class _DingTalkStreamDriver:
    """Best-effort DingTalk stream driver based on dingtalk-stream SDK."""

    @staticmethod
    def _extract_payload(callback_message: Any) -> dict[str, Any]:
        data = getattr(callback_message, "data", None)
        if isinstance(data, bytes | bytearray):
            try:
                data = data.decode("utf-8")
            except Exception:
                data = None
        if isinstance(data, str):
            try:
                parsed = json.loads(data)
            except json.JSONDecodeError:
                parsed = {}
            if isinstance(parsed, dict):
                return parsed
        if isinstance(data, dict):
            return data
        if isinstance(callback_message, dict):
            return callback_message
        return {}

    @staticmethod
    def _resolve_proxy_mode(credentials: dict[str, str]) -> str:
        normalized = _safe_text(
            credentials.get("proxy_mode")
            or os.getenv("NION_DINGTALK_PROXY_MODE")
            or "auto"
        ).lower()
        if normalized not in {"auto", "direct", "system"}:
            return "auto"
        return normalized

    @staticmethod
    def _has_socks_proxy() -> bool:
        try:
            proxies = getproxies()
        except Exception:
            return False
        for proxy_url in proxies.values():
            if _safe_text(proxy_url).lower().startswith("socks"):
                return True
        return False

    @classmethod
    def _ensure_proxy_dependency(cls, proxy_mode: str) -> None:
        if proxy_mode == "direct":
            return
        if not cls._has_socks_proxy():
            return
        try:
            import python_socks  # type: ignore[import-not-found] # noqa: F401
        except Exception as exc:
            raise ChannelStreamFatalError(
                "proxy_dependency_missing: SOCKS proxy detected but python-socks is missing"
            ) from exc

    @staticmethod
    @contextmanager
    def _direct_proxy_env_context():
        proxy_keys = (
            "http_proxy",
            "https_proxy",
            "all_proxy",
            "HTTP_PROXY",
            "HTTPS_PROXY",
            "ALL_PROXY",
            "no_proxy",
            "NO_PROXY",
        )
        snapshot = {key: os.environ.get(key) for key in proxy_keys}
        try:
            for key in proxy_keys:
                os.environ.pop(key, None)
            os.environ["NO_PROXY"] = "*"
            os.environ["no_proxy"] = "*"
            yield
        finally:
            for key, value in snapshot.items():
                if value is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = value

    @staticmethod
    def _is_websocket_connected(client: Any) -> bool:
        websocket = getattr(client, "websocket", None)
        if websocket is None:
            return False
        closed = getattr(websocket, "closed", None)
        if isinstance(closed, bool):
            return not closed
        return True

    def run_forever(
        self,
        *,
        platform: str,
        credentials: dict[str, str],
        stop_event: threading.Event,
        on_connected: Callable[[], None],
        on_disconnected: Callable[[str | None], None],
        on_active_users: Callable[[int], None],
        on_event: Callable[[IncomingWebhookEvent], None],
    ) -> None:
        _ = platform
        client_id = _safe_text(credentials.get("client_id") or credentials.get("app_key"))
        client_secret = _safe_text(
            credentials.get("client_secret") or credentials.get("app_secret")
        )
        if not client_id or not client_secret:
            raise ChannelStreamFatalError("missing client_id/client_secret")

        try:
            import dingtalk_stream  # type: ignore[import-not-found]
        except Exception as exc:  # pragma: no cover - depends on optional dependency
            raise ChannelStreamFatalError(
                "missing dependency 'dingtalk-stream', install it before enabling stream mode"
            ) from exc

        proxy_mode = self._resolve_proxy_mode(credentials)
        self._ensure_proxy_dependency(proxy_mode)
        active_users: set[str] = set()
        ack_ok: Any | None = None
        if hasattr(dingtalk_stream, "AckMessage") and hasattr(
            dingtalk_stream.AckMessage,
            "STATUS_OK",
        ):
            ack_ok = dingtalk_stream.AckMessage.STATUS_OK

        topics: list[str] = []
        if hasattr(dingtalk_stream, "ChatbotMessage"):
            chatbot_message_cls = dingtalk_stream.ChatbotMessage
            topic_get = _safe_text(getattr(chatbot_message_cls, "TOPIC", None))
            topic_delegate = _safe_text(getattr(chatbot_message_cls, "DELEGATE_TOPIC", None))
            if topic_get:
                topics.append(topic_get)
            if topic_delegate:
                topics.append(topic_delegate)
        # Some DingTalk AI agent apps may route inbound messages via graph invoke callback.
        topics.append("/v1.0/graph/api/invoke")
        topic_robot = _safe_text(getattr(dingtalk_stream, "TOPIC_ROBOT", None))
        if topic_robot:
            topics.append(topic_robot)
        topic_card = _safe_text(getattr(dingtalk_stream, "TOPIC_CARD", None))
        if topic_card:
            topics.append(topic_card)
        extra_topics_raw = _safe_text(os.getenv("NION_DINGTALK_STREAM_EXTRA_TOPICS"))
        if extra_topics_raw:
            for topic in (item.strip() for item in extra_topics_raw.split(",")):
                if topic:
                    topics.append(topic)

        # Keep order while deduplicating.
        seen_topics: set[str] = set()
        normalized_topics: list[str] = []
        for topic in topics:
            if topic in seen_topics:
                continue
            seen_topics.add(topic)
            normalized_topics.append(topic)

        if not normalized_topics:
            raise ChannelStreamFatalError(
                "dingtalk-stream topic constant for chatbot messages not found"
            )

        class _MessageHandler(dingtalk_stream.CallbackHandler):  # type: ignore[attr-defined]
            async def process(self, callback_message: Any) -> Any:
                payload = _DingTalkStreamDriver._extract_payload(callback_message)
                incoming = extract_incoming_event("dingtalk", payload)
                headers = getattr(callback_message, "headers", None)
                topic = ""
                if isinstance(headers, dict):
                    topic = _safe_text(headers.get("topic") or headers.get("eventType"))
                else:
                    topic = _safe_text(getattr(headers, "topic", None))
                logger.info(
                    "dingtalk stream inbound topic=%s event_id=%s user=%s chat=%s text=%s",
                    topic or "-",
                    incoming.event_id or "-",
                    incoming.external_user_id or "-",
                    incoming.chat_id or "-",
                    (incoming.text or "").strip()[:120],
                )
                if incoming.external_user_id:
                    active_users.add(incoming.external_user_id)
                    on_active_users(len(active_users))
                if incoming.external_user_id and incoming.chat_id and incoming.text:
                    on_event(incoming)
                return ack_ok, "ok"

        event_handler_cls = getattr(dingtalk_stream, "EventHandler", None)
        event_handler: Any | None = None
        if event_handler_cls is not None:

            class _EventHandler(event_handler_cls):  # type: ignore[misc, valid-type]
                async def process(self, event_message: Any) -> Any:
                    payload = _DingTalkStreamDriver._extract_payload(event_message)
                    if not payload:
                        return ack_ok, "ok"
                    incoming = extract_incoming_event("dingtalk", payload)
                    headers = getattr(event_message, "headers", None)
                    if isinstance(headers, dict):
                        topic = _safe_text(headers.get("topic") or headers.get("eventType"))
                    else:
                        topic = _safe_text(getattr(headers, "topic", None))
                    logger.info(
                        "dingtalk stream event topic=%s event_id=%s user=%s chat=%s text=%s",
                        topic or "-",
                        incoming.event_id or "-",
                        incoming.external_user_id or "-",
                        incoming.chat_id or "-",
                        (incoming.text or "").strip()[:120],
                    )
                    if incoming.external_user_id and incoming.chat_id:
                        active_users.add(incoming.external_user_id)
                        on_active_users(len(active_users))
                    if incoming.external_user_id and incoming.chat_id and incoming.text:
                        on_event(incoming)
                    return ack_ok, "ok"

            event_handler = _EventHandler()

        try:
            credential = dingtalk_stream.Credential(client_id, client_secret)
            client = dingtalk_stream.DingTalkStreamClient(credential)
        except Exception as exc:  # pragma: no cover - SDK API mismatch path
            raise ChannelStreamFatalError(f"failed to initialize dingtalk stream client: {exc}") from exc

        try:
            logger.info(
                "dingtalk stream subscribe topics=%s",
                ", ".join(normalized_topics),
            )
            for topic in normalized_topics:
                client.register_callback_handler(topic, _MessageHandler())
            if event_handler is not None and hasattr(client, "register_all_event_handler"):
                client.register_all_event_handler(event_handler)
        except Exception as exc:  # pragma: no cover - SDK API mismatch path
            raise ChannelStreamFatalError(f"failed to register dingtalk callback handler: {exc}") from exc

        run_error: Exception | None = None
        proxy_context = (
            self._direct_proxy_env_context()
            if proxy_mode == "direct"
            else nullcontext()
        )

        def _run_client() -> None:
            nonlocal run_error
            try:
                with proxy_context:
                    if hasattr(client, "start_forever"):
                        client.start_forever()
                    elif hasattr(client, "start"):
                        client.start()
                    else:
                        raise RuntimeError("DingTalkStreamClient has no start method")
            except Exception as exc:  # pragma: no cover - external SDK path
                run_error = exc

        worker_thread = threading.Thread(
            target=_run_client,
            name="channel-dingtalk-stream-worker",
            daemon=True,
        )
        worker_thread.start()

        connected = False
        while not stop_event.is_set():
            current_connected = self._is_websocket_connected(client)
            if current_connected and not connected:
                connected = True
                on_connected()
            elif not current_connected and connected:
                connected = False
                on_disconnected("websocket disconnected")
            if run_error is not None:
                on_disconnected(str(run_error))
                raise RuntimeError(str(run_error))
            if not worker_thread.is_alive():
                break
            stop_event.wait(0.5)

        if hasattr(client, "stop"):
            try:
                client.stop()
            except Exception:  # pragma: no cover - best effort
                pass
        if hasattr(client, "disconnect"):
            try:
                client.disconnect()
            except Exception:  # pragma: no cover - best effort
                pass
        if worker_thread.is_alive():
            worker_thread.join(timeout=2.0)
        on_disconnected(None)


class _TelegramStreamDriver:
    @staticmethod
    def _parse_allowed_users(credentials: dict[str, str]) -> set[str]:
        raw = _safe_text(credentials.get("allowed_users"))
        if not raw:
            return set()

        tokens: list[str] = []
        if raw.startswith("[") and raw.endswith("]"):
            try:
                parsed = json.loads(raw)
            except json.JSONDecodeError:
                parsed = None
            if isinstance(parsed, list):
                tokens = [str(item).strip() for item in parsed]
        if not tokens:
            tokens = [part.strip() for part in re.split(r"[\s,;]+", raw)]

        normalized: set[str] = set()
        for token in tokens:
            if not token:
                continue
            try:
                normalized.add(str(int(token)))
            except ValueError:
                normalized.add(token)
        return normalized

    def run_forever(
        self,
        *,
        platform: str,
        credentials: dict[str, str],
        stop_event: threading.Event,
        on_connected: Callable[[], None],
        on_disconnected: Callable[[str | None], None],
        on_active_users: Callable[[int], None],
        on_event: Callable[[IncomingWebhookEvent], None],
    ) -> None:
        _ = platform
        bot_token = _safe_text(credentials.get("bot_token"))
        if not bot_token:
            raise ChannelStreamFatalError("missing bot_token")

        endpoint = f"https://api.telegram.org/bot{bot_token}/getUpdates"
        allowed_users = self._parse_allowed_users(credentials)
        active_users: set[str] = set()

        offset_value = _safe_text(credentials.get("offset"))
        offset: int | None = None
        if offset_value:
            try:
                offset = int(offset_value)
            except ValueError:
                offset = None

        on_connected()
        timeout = httpx.Timeout(connect=10.0, read=25.0, write=10.0, pool=10.0)
        try:
            with httpx.Client(timeout=timeout) as client:
                while not stop_event.is_set():
                    params: dict[str, Any] = {
                        "timeout": 10,
                        "allowed_updates": json.dumps(
                            ["message", "edited_message", "channel_post", "callback_query"]
                        ),
                    }
                    if offset is not None:
                        params["offset"] = offset

                    response = client.get(endpoint, params=params)
                    if response.status_code >= 400:
                        error_message = f"http {response.status_code}: {_safe_text(response.text)}"
                        if response.status_code in {401, 403, 404}:
                            raise ChannelStreamFatalError(
                                f"telegram_auth_failed: {error_message}"
                            )
                        raise RuntimeError(error_message)

                    payload = response.json()
                    if not bool(payload.get("ok")):
                        error_code = int(payload.get("error_code") or 0)
                        description = _safe_text(
                            payload.get("description") or "telegram getUpdates failed"
                        )
                        if error_code in {401, 403, 404}:
                            raise ChannelStreamFatalError(
                                f"telegram_auth_failed: {description}"
                            )
                        raise RuntimeError(description)

                    updates = payload.get("result")
                    if not isinstance(updates, list):
                        continue

                    for update in updates:
                        if not isinstance(update, dict):
                            continue
                        update_id = update.get("update_id")
                        if isinstance(update_id, int):
                            offset = update_id + 1
                        incoming = extract_incoming_event("telegram", update)
                        user_id = _safe_text(incoming.external_user_id)
                        if not user_id or not incoming.chat_id or not incoming.text:
                            continue
                        if allowed_users and user_id not in allowed_users:
                            continue
                        active_users.add(user_id)
                        on_active_users(len(active_users))
                        on_event(incoming)
        except ChannelStreamFatalError as exc:
            on_disconnected(str(exc))
            raise
        except Exception as exc:
            on_disconnected(str(exc))
            raise

        on_disconnected(None)


def _default_stream_driver_factory(platform: str) -> ChannelStreamDriver:
    if platform == "lark":
        return _LarkStreamDriver()
    if platform == "dingtalk":
        return _DingTalkStreamDriver()
    if platform == "telegram":
        return _TelegramStreamDriver()
    return _UnavailableStreamDriver(platform, "unsupported platform")


@dataclass(slots=True)
class _RuntimeState:
    platform: str
    enabled: bool = False
    mode: str = "webhook"
    proxy_mode: str | None = None
    stream_health: str = "down"
    running: bool = False
    connected: bool = False
    active_users: int = 0
    reconnect_count: int = 0
    started_at: str | None = None
    last_ws_connected_at: str | None = None
    last_ws_disconnected_at: str | None = None
    last_event_at: str | None = None
    last_error: str | None = None
    last_error_code: str | None = None
    last_error_at: str | None = None
    last_delivery_path: str | None = None
    last_render_mode: str | None = None
    last_fallback_reason: str | None = None
    last_stream_chunk_at: str | None = None
    last_media_attempted_count: int = 0
    last_media_sent_count: int = 0
    last_media_failed_count: int = 0
    last_media_fallback_reason: str | None = None
    updated_at: str | None = None

    def snapshot(self) -> dict[str, Any]:
        return {
            "platform": self.platform,
            "enabled": self.enabled,
            "mode": self.mode,
            "proxy_mode": self.proxy_mode,
            "stream_health": self.stream_health,
            "running": self.running,
            "connected": self.connected,
            "active_users": self.active_users,
            "reconnect_count": self.reconnect_count,
            "started_at": self.started_at,
            "last_ws_connected_at": self.last_ws_connected_at,
            "last_ws_disconnected_at": self.last_ws_disconnected_at,
            "last_event_at": self.last_event_at,
            "last_error": self.last_error,
            "last_error_code": self.last_error_code,
            "last_error_at": self.last_error_at,
            "last_delivery_path": self.last_delivery_path,
            "last_render_mode": self.last_render_mode,
            "last_fallback_reason": self.last_fallback_reason,
            "last_stream_chunk_at": self.last_stream_chunk_at,
            "last_media_attempted_count": self.last_media_attempted_count,
            "last_media_sent_count": self.last_media_sent_count,
            "last_media_failed_count": self.last_media_failed_count,
            "last_media_fallback_reason": self.last_media_fallback_reason,
            "updated_at": self.updated_at,
        }


class _ChannelStreamWorker:
    def __init__(
        self,
        *,
        platform: str,
        credentials: dict[str, str],
        driver: ChannelStreamDriver,
        on_running: Callable[[bool], None],
        on_connected: Callable[[bool], None],
        on_active_users: Callable[[int], None],
        on_event: Callable[[IncomingWebhookEvent], None],
        on_error: Callable[[str, bool], None],
        on_reconnect: Callable[[], None],
    ):
        self._platform = platform
        self._credentials = credentials
        self._driver = driver
        self._on_running = on_running
        self._on_connected = on_connected
        self._on_active_users = on_active_users
        self._on_event = on_event
        self._on_error = on_error
        self._on_reconnect = on_reconnect
        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None

    @property
    def is_alive(self) -> bool:
        return self._thread is not None and self._thread.is_alive()

    def start(self) -> None:
        if self.is_alive:
            return
        self._stop_event.clear()
        self._thread = threading.Thread(
            target=self._run_loop,
            name=f"channel-stream-runtime-{self._platform}",
            daemon=True,
        )
        self._thread.start()

    def stop(self) -> None:
        self._stop_event.set()
        thread = self._thread
        if thread is not None and thread.is_alive():
            thread.join(timeout=3.0)
        self._thread = None

    def _run_loop(self) -> None:
        reconnect_backoff_seconds = 2.0
        self._on_running(True)
        while not self._stop_event.is_set():
            try:
                self._driver.run_forever(
                    platform=self._platform,
                    credentials=self._credentials,
                    stop_event=self._stop_event,
                    on_connected=lambda: self._on_connected(True),
                    on_disconnected=lambda _reason: self._on_connected(False),
                    on_active_users=self._on_active_users,
                    on_event=self._on_event,
                )
                if not self._stop_event.is_set():
                    self._on_error("stream disconnected unexpectedly", False)
            except ChannelStreamFatalError as exc:
                self._on_connected(False)
                self._on_error(str(exc), True)
                break
            except Exception as exc:  # pragma: no cover - network/sdk path
                self._on_connected(False)
                self._on_error(str(exc), False)

            if self._stop_event.wait(reconnect_backoff_seconds):
                break
            self._on_reconnect()
        self._on_running(False)
        self._on_connected(False)


class ChannelRuntimeManager:
    """Manage channel stream runtimes based on integration configurations."""

    def __init__(
        self,
        *,
        repo: ChannelRepository,
        stream_driver_factory: Callable[[str], ChannelStreamDriver] | None = None,
        on_inbound_result: Callable[[str, ChannelInboundResult], None] | None = None,
        on_runtime_state: Callable[[str, dict[str, Any]], None] | None = None,
        on_agent_event: Callable[[str, str, dict[str, Any]], None] | None = None,
    ):
        self._repo = repo
        self._on_agent_event = on_agent_event
        self._inbound_service = ChannelInboundService(
            self._repo,
            on_agent_event=self._forward_agent_event,
        )
        self._stream_driver_factory = stream_driver_factory or _default_stream_driver_factory
        self._on_inbound_result = on_inbound_result
        self._on_runtime_state = on_runtime_state
        self._workers: dict[str, _ChannelStreamWorker] = {}
        self._states: dict[str, _RuntimeState] = {
            platform: _RuntimeState(platform=platform, updated_at=_utcnow())
            for platform in sorted(SUPPORTED_CHANNEL_PLATFORMS)
        }
        self._lock = threading.RLock()

    def start(self) -> None:
        self.reconcile_all()

    def stop(self) -> None:
        with self._lock:
            platforms = list(self._workers.keys())
        for platform in platforms:
            self._stop_worker(platform)

    def reconcile_all(self) -> None:
        for platform in sorted(SUPPORTED_CHANNEL_PLATFORMS):
            self.reconcile_platform(platform)

    def reconcile_platform(self, platform: str) -> None:
        integration = self._repo.get_integration(platform)
        enabled = bool(integration.get("enabled"))
        mode = _safe_text(integration.get("mode") or "webhook").lower() or "webhook"
        credentials = integration.get("credentials", {})
        proxy_mode = _resolve_dingtalk_proxy_mode(credentials) if platform == "dingtalk" else None

        with self._lock:
            state = self._states[platform]
            state.enabled = enabled
            state.mode = mode
            state.proxy_mode = proxy_mode
            state.updated_at = _utcnow()

        should_run_stream = enabled and mode == "stream"
        if should_run_stream:
            self._ensure_worker(platform, credentials)
            return
        self._stop_worker(platform)

    def get_runtime_status(self, platform: str) -> dict[str, Any]:
        with self._lock:
            state = self._states[platform]
            return state.snapshot()

    def list_runtime_status(self) -> list[dict[str, Any]]:
        with self._lock:
            return [self._states[platform].snapshot() for platform in sorted(self._states.keys())]

    def record_inbound_result(self, platform: str, result: ChannelInboundResult) -> None:
        self._apply_inbound_result(platform, result)

    def _ensure_worker(self, platform: str, credentials: dict[str, str]) -> None:
        with self._lock:
            existing = self._workers.get(platform)
            if existing is not None and existing.is_alive:
                return
            state = self._states[platform]
            state.last_error = None
            state.last_error_code = None
            state.last_error_at = None
            state.active_users = 0
            state.started_at = _utcnow()
            state.stream_health = "degraded"
            state.updated_at = _utcnow()

            worker = _ChannelStreamWorker(
                platform=platform,
                credentials={str(k): str(v) for k, v in (credentials or {}).items()},
                driver=self._stream_driver_factory(platform),
                on_running=lambda running: self._handle_worker_running(platform, running),
                on_connected=lambda connected: self._handle_worker_connected(platform, connected),
                on_active_users=lambda count: self._update_state(platform, active_users=count),
                on_event=lambda incoming: self._handle_stream_incoming(platform, incoming),
                on_error=lambda error, fatal: self._handle_worker_error(platform, error, fatal),
                on_reconnect=lambda: self._increase_reconnect(platform),
            )
            self._workers[platform] = worker
            worker.start()

    def _stop_worker(self, platform: str) -> None:
        worker: _ChannelStreamWorker | None = None
        with self._lock:
            worker = self._workers.pop(platform, None)
        if worker is not None:
            worker.stop()
        self._update_state(
            platform,
            running=False,
            connected=False,
            active_users=0,
            stream_health="down",
            last_ws_disconnected_at=_utcnow(),
        )

    def _update_state(self, platform: str, **changes: Any) -> None:
        snapshot: dict[str, Any] | None = None
        with self._lock:
            state = self._states[platform]
            for key, value in changes.items():
                setattr(state, key, value)
            state.updated_at = _utcnow()
            snapshot = state.snapshot()
        if self._on_runtime_state is not None and snapshot is not None:
            try:
                self._on_runtime_state(platform, snapshot)
            except Exception:  # pragma: no cover - callback safety
                logger.debug("failed to emit runtime state callback for platform=%s", platform)

    def _handle_worker_running(self, platform: str, running: bool) -> None:
        health = "degraded" if running else "down"
        self._update_state(platform, running=running, stream_health=health)

    def _handle_worker_connected(self, platform: str, connected: bool) -> None:
        now = _utcnow()
        with self._lock:
            current_connected = self._states[platform].connected
        if connected and not current_connected:
            self._update_state(
                platform,
                connected=True,
                stream_health="healthy",
                last_ws_connected_at=now,
            )
            return
        if (not connected) and current_connected:
            self._update_state(
                platform,
                connected=False,
                stream_health="degraded",
                last_ws_disconnected_at=now,
            )
            return
        if connected:
            self._update_state(platform, connected=True, stream_health="healthy")
        else:
            self._update_state(platform, connected=False, stream_health="degraded")

    @staticmethod
    def _parse_error_code(message: str) -> tuple[str | None, str]:
        normalized = _safe_text(message)
        if ":" not in normalized:
            return None, normalized
        code, detail = normalized.split(":", 1)
        normalized_code = _safe_text(code).replace(" ", "_")
        if not normalized_code:
            return None, normalized
        return normalized_code, _safe_text(detail) or normalized

    def _handle_worker_error(self, platform: str, error: str, fatal: bool) -> None:
        error_code, normalized_error = self._parse_error_code(error)
        self._update_state(
            platform,
            last_error=normalized_error,
            last_error_code=error_code,
            last_error_at=_utcnow(),
            stream_health="degraded",
        )
        if fatal:
            self._update_state(
                platform,
                running=False,
                connected=False,
                stream_health="down",
                last_ws_disconnected_at=_utcnow(),
            )
            with self._lock:
                self._workers.pop(platform, None)

    def _increase_reconnect(self, platform: str) -> None:
        with self._lock:
            state = self._states[platform]
            state.reconnect_count += 1
            state.updated_at = _utcnow()

    def _handle_stream_incoming(self, platform: str, incoming: IncomingWebhookEvent) -> None:
        try:
            result = self._inbound_service.handle_incoming_event(platform, incoming)
            self._apply_inbound_result(platform, result)
            if self._on_inbound_result is not None:
                try:
                    self._on_inbound_result(platform, result)
                except Exception as callback_error:  # pragma: no cover - defensive logging
                    logger.warning(
                        "channel stream inbound callback failed platform=%s error=%s",
                        platform,
                        callback_error,
                    )
            logger.info(
                "channel stream inbound result platform=%s action=%s request_id=%s thread_id=%s",
                platform,
                result.action,
                result.request_id,
                result.thread_id,
            )
            if result.action in {"agent_failed", "invalid_payload"}:
                logger.warning(
                    "channel stream inbound handled with action=%s platform=%s message=%s",
                    result.action,
                    platform,
                    result.message,
                )
        except Exception as exc:  # pragma: no cover - defensive logging
            self._update_state(
                platform,
                last_error=str(exc),
                last_error_at=_utcnow(),
            )
            logger.exception("channel stream inbound handling failed platform=%s error=%s", platform, exc)

    def _forward_agent_event(
        self,
        platform: str,
        event_type: str,
        payload: dict[str, Any],
    ) -> None:
        if self._on_agent_event is None:
            return
        try:
            self._on_agent_event(platform, event_type, payload)
        except Exception:
            logger.debug(
                "failed to emit agent event callback platform=%s event=%s",
                platform,
                event_type,
            )

    def _apply_inbound_result(self, platform: str, result: ChannelInboundResult) -> None:
        self._update_state(
            platform,
            last_event_at=_utcnow(),
            last_delivery_path=result.delivery_path,
            last_render_mode=result.render_mode,
            last_fallback_reason=result.fallback_reason,
            last_stream_chunk_at=result.last_stream_chunk_at,
            last_media_attempted_count=result.media_attempted_count,
            last_media_sent_count=result.media_sent_count,
            last_media_failed_count=result.media_failed_count,
            last_media_fallback_reason=result.media_fallback_reason,
        )
