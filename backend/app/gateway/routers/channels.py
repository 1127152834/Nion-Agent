from __future__ import annotations

import asyncio
import json
import logging
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Header, HTTPException, Query, Request, status
from fastapi.responses import JSONResponse, StreamingResponse

from app.channels.bridge_service import ChannelAgentBridgeService
from app.channels.connection_service import ChannelConnectionService
from app.channels.event_broker import ChannelEventBroker
from app.channels.incoming_service import ChannelInboundService
from app.channels.plugins.dingtalk.card_renderer import DingTalkPairingCardRenderer
from app.channels.repository import ChannelRepository, ChannelRepositoryNotFoundError
from app.channels.runtime_manager import ChannelRuntimeManager
from app.channels.webhook_service import (
    IncomingWebhookEvent,
    extract_incoming_event,
    get_lark_challenge,
    is_lark_challenge,
)
from nion.config.paths import get_paths
from app.gateway.schemas.channels import (
    ChannelAuthorizedUserResponse,
    ChannelAuthorizedUserRevokeRequest,
    ChannelAuthorizedUserRevokeResponse,
    ChannelAuthorizedUserSessionOverrideUpdateRequest,
    ChannelAuthorizedUserWorkspaceUpdateRequest,
    ChannelConfigResponse,
    ChannelConfigUpsertRequest,
    ChannelConnectionTestRequest,
    ChannelConnectionTestResponse,
    ChannelPairingCodeCreateRequest,
    ChannelPairingCodeResponse,
    ChannelPairRequestDecisionRequest,
    ChannelPairRequestResponse,
    ChannelPlatform,
    ChannelResetDataRequest,
    ChannelResetDataResponse,
    ChannelRuntimeStatusResponse,
    ChannelWebhookResponse,
)

router = APIRouter(prefix="/api/channels", tags=["channels"])
logger = logging.getLogger(__name__)


def _repo() -> ChannelRepository:
    repository = ChannelRepository(paths=get_paths())
    repository.init_schema()
    return repository


def _runtime_manager(request: Request) -> ChannelRuntimeManager | None:
    manager = getattr(request.app.state, "channel_runtime_manager", None)
    if isinstance(manager, ChannelRuntimeManager):
        return manager
    return None


def _event_broker(request: Request) -> ChannelEventBroker | None:
    broker = getattr(request.app.state, "channel_event_broker", None)
    if isinstance(broker, ChannelEventBroker):
        return broker
    return None


def _utcnow() -> str:
    return datetime.now(UTC).isoformat()


def _sse(event: str, data: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def _publish_channel_event(
    request: Request | None,
    platform: ChannelPlatform,
    *,
    event_type: str,
    payload: dict[str, Any] | None = None,
) -> None:
    if request is None:
        return
    broker = _event_broker(request)
    if broker is None:
        return
    broker.publish(platform, event_type, payload)


@router.get("/{platform}/config", response_model=ChannelConfigResponse, summary="Get channel integration config")
async def get_channel_config(platform: ChannelPlatform) -> ChannelConfigResponse:
    return ChannelConfigResponse(**_repo().get_integration(platform))


@router.put("/{platform}/config", response_model=ChannelConfigResponse, summary="Upsert channel integration config")
async def upsert_channel_config(
    platform: ChannelPlatform,
    payload: ChannelConfigUpsertRequest,
    request: Request,
) -> ChannelConfigResponse:
    updated = _repo().upsert_integration(
        platform,
        enabled=payload.enabled,
        mode=payload.mode,
        credentials={str(k): str(v) for k, v in payload.credentials.items()},
        default_workspace_id=payload.default_workspace_id,
        session=payload.session.model_dump(exclude_none=True) if payload.session is not None else None,
    )
    manager = _runtime_manager(request)
    if manager is not None:
        manager.reconcile_platform(platform)
    return ChannelConfigResponse(**updated)


@router.post("/{platform}/test", response_model=ChannelConnectionTestResponse, summary="Test channel connection")
async def test_channel_connection(platform: ChannelPlatform, payload: ChannelConnectionTestRequest) -> ChannelConnectionTestResponse:
    service = ChannelConnectionService()
    try:
        result = service.test_connection(
            platform,
            payload.credentials,
            timeout_seconds=payload.timeout_seconds,
        )
        return ChannelConnectionTestResponse(**result)
    except Exception as exc:
        return ChannelConnectionTestResponse(
            platform=platform,
            success=False,
            message=str(exc),
            latency_ms=None,
        )


@router.get(
    "/{platform}/runtime",
    response_model=ChannelRuntimeStatusResponse,
    summary="Get channel runtime status",
)
async def get_channel_runtime_status(
    platform: ChannelPlatform,
    request: Request,
) -> ChannelRuntimeStatusResponse:
    manager = _runtime_manager(request)
    if manager is None:
        config = _repo().get_integration(platform)
        return ChannelRuntimeStatusResponse(
            platform=platform,
            enabled=bool(config.get("enabled")),
            mode=str(config.get("mode") or "webhook"),
            proxy_mode=str(config.get("credentials", {}).get("proxy_mode") or "auto") if platform == "dingtalk" else None,
            stream_health="down",
            running=False,
            connected=False,
            active_users=0,
            reconnect_count=0,
            started_at=None,
            last_ws_connected_at=None,
            last_ws_disconnected_at=None,
            last_event_at=None,
            last_error=None,
            last_error_code=None,
            last_error_at=None,
            last_delivery_path=None,
            last_render_mode=None,
            last_fallback_reason=None,
            last_stream_chunk_at=None,
            last_media_attempted_count=0,
            last_media_sent_count=0,
            last_media_failed_count=0,
            last_media_fallback_reason=None,
            updated_at=None,
        )
    return ChannelRuntimeStatusResponse(**manager.get_runtime_status(platform))


@router.post(
    "/{platform}/reset-data",
    response_model=ChannelResetDataResponse,
    summary="Reset channel runtime data for platform",
)
async def reset_channel_data(
    platform: ChannelPlatform,
    payload: ChannelResetDataRequest,
) -> ChannelResetDataResponse:
    if (payload.confirm_text or "").strip().upper() != "RESET":
        raise HTTPException(status_code=400, detail="confirm_text must be RESET")
    deleted = _repo().reset_platform_data(platform)
    return ChannelResetDataResponse(platform=platform, deleted=deleted)


@router.post(
    "/{platform}/pairing-code",
    response_model=ChannelPairingCodeResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create pairing code",
)
async def create_pairing_code(platform: ChannelPlatform, payload: ChannelPairingCodeCreateRequest) -> ChannelPairingCodeResponse:
    created = _repo().create_pairing_code(platform, ttl_minutes=payload.ttl_minutes)
    return ChannelPairingCodeResponse(**created)


@router.get("/{platform}/pair-requests", response_model=list[ChannelPairRequestResponse], summary="List pairing requests")
async def list_pair_requests(
    platform: ChannelPlatform,
    status_filter: str | None = Query(default=None, alias="status"),
    limit: int = Query(default=50, ge=1, le=500),
) -> list[ChannelPairRequestResponse]:
    items = _repo().list_pair_requests(platform, status=status_filter, limit=limit)
    return [ChannelPairRequestResponse(**item) for item in items]


@router.post(
    "/{platform}/pair-requests/{request_id}/approve",
    response_model=ChannelPairRequestResponse,
    summary="Approve pairing request",
)
async def approve_pair_request(
    platform: ChannelPlatform,
    request_id: int,
    payload: ChannelPairRequestDecisionRequest,
    request: Request,
) -> ChannelPairRequestResponse:
    repository = _repo()
    try:
        updated = repository.approve_pair_request(
            platform,
            request_id,
            handled_by=payload.handled_by,
            note=payload.note,
            workspace_id=payload.workspace_id,
        )
    except ChannelRepositoryNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    _publish_channel_event(
        request,
        platform,
        event_type="pair_request_approved",
        payload={"request_id": int(updated["id"])},
    )
    notify_log_id: int | None = None
    workspace_label = (payload.workspace_id or "").strip()
    try:
        incoming = IncomingWebhookEvent(
            platform=platform,
            event_id=None,
            external_user_id=str(updated.get("external_user_id") or "").strip() or None,
            external_user_name=str(updated.get("external_user_name") or "").strip() or None,
            chat_id=str(updated.get("chat_id") or "").strip() or None,
            conversation_type=str(updated.get("conversation_type") or "").strip() or None,
            session_webhook=str(updated.get("session_webhook") or "").strip() or None,
            text=None,
        )
        if platform == "dingtalk":
            notify_text = DingTalkPairingCardRenderer().build_pairing_approved_notice(workspace_label or None)
        else:
            notify_text = "配对成功，已授权接入 Nion。现在可以直接发送消息开始聊天。" if not workspace_label else f"配对成功，已授权接入 Nion（工作空间：{workspace_label}）。现在可以直接发送消息开始聊天。"
        notify_log = repository.create_message_log(
            platform,
            chat_id=incoming.chat_id or "",
            external_user_id=incoming.external_user_id,
            source_event_id=None,
            request_text="[system] pair_approved_notification",
            workspace_id=workspace_label or None,
            delivery_path=None,
            render_mode="system_notify",
            fallback_reason=None,
            stream_chunk_count=0,
        )
        notify_log_id = int(notify_log["id"])
        bridge_service = ChannelAgentBridgeService(repository)
        delivery_result = await asyncio.to_thread(
            bridge_service.send_pairing_approved_message_with_meta,
            platform,
            incoming=incoming,
            text=notify_text,
        )
        repository.finish_message_log(
            notify_log_id,
            run_status="succeeded" if delivery_result.delivered else "failed",
            delivery_status="delivered" if delivery_result.delivered else "failed",
            response_text=notify_text if delivery_result.delivered else None,
            error_message=None if delivery_result.delivered else delivery_result.message,
            thread_id=None,
            workspace_id=workspace_label or None,
            delivery_path=delivery_result.delivery_path,
            render_mode=delivery_result.render_mode,
            fallback_reason=delivery_result.fallback_reason,
            stream_chunk_count=delivery_result.stream_chunk_count,
        )
        if not delivery_result.delivered:
            logger.warning(
                "pair request approved but notify skipped platform=%s request_id=%s reason=%s",
                platform,
                request_id,
                delivery_result.message,
            )
    except Exception as exc:
        logger.warning(
            "pair request approved but notify failed platform=%s request_id=%s error=%s",
            platform,
            request_id,
            exc,
        )
        if notify_log_id is not None:
            repository.finish_message_log(
                notify_log_id,
                run_status="failed",
                delivery_status="failed",
                response_text=None,
                error_message=str(exc),
                thread_id=None,
                workspace_id=workspace_label or None,
                delivery_path=None,
                render_mode="system_notify",
                fallback_reason="approval_notification_exception",
                stream_chunk_count=0,
            )
    return ChannelPairRequestResponse(**updated)


@router.post(
    "/{platform}/pair-requests/{request_id}/reject",
    response_model=ChannelPairRequestResponse,
    summary="Reject pairing request",
)
async def reject_pair_request(
    platform: ChannelPlatform,
    request_id: int,
    payload: ChannelPairRequestDecisionRequest,
    request: Request,
) -> ChannelPairRequestResponse:
    repository = _repo()
    try:
        updated = repository.reject_pair_request(
            platform,
            request_id,
            handled_by=payload.handled_by,
            note=payload.note,
        )
    except ChannelRepositoryNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    _publish_channel_event(
        request,
        platform,
        event_type="pair_request_rejected",
        payload={"request_id": int(updated["id"])},
    )
    return ChannelPairRequestResponse(**updated)


@router.get("/{platform}/authorized-users", response_model=list[ChannelAuthorizedUserResponse], summary="List authorized users")
async def list_authorized_users(
    platform: ChannelPlatform,
    active_only: bool = Query(default=True),
) -> list[ChannelAuthorizedUserResponse]:
    items = _repo().list_authorized_users(platform, active_only=active_only)
    return [ChannelAuthorizedUserResponse(**item) for item in items]


@router.post(
    "/{platform}/authorized-users/{user_id}/revoke",
    response_model=ChannelAuthorizedUserRevokeResponse,
    summary="Revoke authorized user",
)
async def revoke_authorized_user(
    platform: ChannelPlatform,
    user_id: int,
    payload: ChannelAuthorizedUserRevokeRequest,
    request: Request,
) -> ChannelAuthorizedUserRevokeResponse:
    revoked = _repo().revoke_authorized_user(platform, user_id, handled_by=payload.handled_by)
    if revoked:
        _publish_channel_event(
            request,
            platform,
            event_type="authorized_user_revoked",
            payload={"user_id": user_id},
        )
    return ChannelAuthorizedUserRevokeResponse(revoked=revoked)


@router.post(
    "/{platform}/authorized-users/{user_id}/workspace",
    response_model=ChannelAuthorizedUserResponse,
    summary="Update authorized user workspace binding",
)
async def update_authorized_user_workspace(
    platform: ChannelPlatform,
    user_id: int,
    payload: ChannelAuthorizedUserWorkspaceUpdateRequest,
    request: Request,
) -> ChannelAuthorizedUserResponse:
    repository = _repo()
    try:
        updated = repository.update_authorized_user_workspace(
            platform,
            user_id,
            workspace_id=payload.workspace_id,
        )
    except ChannelRepositoryNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    _publish_channel_event(
        request,
        platform,
        event_type="authorized_user_workspace_updated",
        payload={
            "user_id": int(updated["id"]),
            "workspace_id": updated.get("workspace_id"),
        },
    )
    return ChannelAuthorizedUserResponse(**updated)


@router.post(
    "/{platform}/authorized-users/{user_id}/session-override",
    response_model=ChannelAuthorizedUserResponse,
    summary="Update authorized user session override",
)
async def update_authorized_user_session_override(
    platform: ChannelPlatform,
    user_id: int,
    payload: ChannelAuthorizedUserSessionOverrideUpdateRequest,
    request: Request,
) -> ChannelAuthorizedUserResponse:
    repository = _repo()
    try:
        updated = repository.update_authorized_user_session_override(
            platform,
            user_id,
            session_override=payload.model_dump(exclude_none=True),
        )
    except ChannelRepositoryNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    _publish_channel_event(
        request,
        platform,
        event_type="authorized_user_session_override_updated",
        payload={
            "user_id": int(updated["id"]),
            "session_override": updated.get("session_override"),
        },
    )
    return ChannelAuthorizedUserResponse(**updated)


def _handle_webhook(
    platform: ChannelPlatform,
    payload: dict[str, Any],
    request: Request | None = None,
) -> ChannelWebhookResponse:
    repository = _repo()
    incoming = extract_incoming_event(platform, payload)

    def _publish_agent_event(
        event_platform: str,
        event_type: str,
        event_payload: dict[str, object],
    ) -> None:
        normalized_platform: ChannelPlatform = event_platform if event_platform in {"lark", "dingtalk", "telegram"} else platform
        _publish_channel_event(
            request,
            normalized_platform,
            event_type=event_type,
            payload={str(k): v for k, v in event_payload.items()},
        )

    service = ChannelInboundService(
        repository,
        on_agent_event=_publish_agent_event,
    )
    result = service.handle_incoming_event(platform, incoming)
    manager = _runtime_manager(request) if request is not None else None
    if manager is not None:
        manager.record_inbound_result(platform, result)
    if result.action == "pair_requested":
        _publish_channel_event(
            request,
            platform,
            event_type="pair_request_created",
            payload={"request_id": result.request_id},
        )
    return ChannelWebhookResponse(
        accepted=result.accepted,
        action=result.action,
        message=result.message,
        request_id=result.request_id,
        thread_id=result.thread_id,
        workspace_id=result.workspace_id,
        reply_preview=result.reply_preview,
        media_attempted_count=result.media_attempted_count,
        media_sent_count=result.media_sent_count,
        media_failed_count=result.media_failed_count,
        media_fallback_reason=result.media_fallback_reason,
    )


@router.post("/webhooks/lark", summary="Receive lark webhook")
async def lark_webhook(payload: dict[str, Any], request: Request) -> JSONResponse:
    if is_lark_challenge(payload):
        challenge = get_lark_challenge(payload)
        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={"challenge": challenge or ""},
        )
    result = _handle_webhook("lark", payload, request)
    return JSONResponse(
        status_code=status.HTTP_202_ACCEPTED,
        content=result.model_dump(),
    )


@router.post(
    "/webhooks/dingtalk",
    response_model=ChannelWebhookResponse,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Receive dingtalk webhook",
)
async def dingtalk_webhook(payload: dict[str, Any], request: Request) -> ChannelWebhookResponse:
    return _handle_webhook("dingtalk", payload, request)


def _verify_telegram_secret_token(provided_token: str | None) -> None:
    integration = _repo().get_integration("telegram")
    credentials = integration.get("credentials", {})
    expected_token = str(credentials.get("secret_token") or "").strip()
    if not expected_token:
        return
    if str(provided_token or "").strip() != expected_token:
        raise HTTPException(status_code=403, detail="invalid telegram secret token")


@router.post(
    "/webhooks/telegram",
    response_model=ChannelWebhookResponse,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Receive telegram webhook",
)
async def telegram_webhook(
    payload: dict[str, Any],
    request: Request,
    telegram_secret_token: str | None = Header(
        default=None,
        alias="X-Telegram-Bot-Api-Secret-Token",
    ),
) -> ChannelWebhookResponse:
    _verify_telegram_secret_token(telegram_secret_token)
    return _handle_webhook("telegram", payload, request)


@router.get(
    "/{platform}/events",
    summary="Subscribe channel events (SSE)",
)
async def stream_channel_events(platform: ChannelPlatform, request: Request) -> StreamingResponse:
    broker = _event_broker(request)
    if broker is None:
        raise HTTPException(status_code=503, detail="channel event broker is not available")

    queue = broker.subscribe(platform)

    async def event_stream() -> Any:
        try:
            yield _sse(
                "ready",
                {
                    "platform": platform,
                    "timestamp": _utcnow(),
                },
            )
            while True:
                if await request.is_disconnected():
                    break
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=20)
                    yield _sse("channel_event", event)
                except TimeoutError:
                    yield _sse(
                        "heartbeat",
                        {
                            "platform": platform,
                            "timestamp": _utcnow(),
                        },
                    )
        finally:
            broker.unsubscribe(platform, queue)

    headers = {
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
    }
    return StreamingResponse(event_stream(), media_type="text/event-stream", headers=headers)
