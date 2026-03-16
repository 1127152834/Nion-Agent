from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

import httpx

from src.channels.webhook_service import IncomingWebhookEvent


def _safe_text(value: Any) -> str:
    if isinstance(value, str):
        return value.strip()
    if value is None:
        return ""
    return str(value).strip()


def _is_group_chat(incoming: IncomingWebhookEvent) -> bool:
    conversation_type = _safe_text(incoming.conversation_type).lower()
    return conversation_type == "2" or "group" in conversation_type


@dataclass(slots=True)
class DingTalkMediaUploadResult:
    ok: bool
    media_id: str | None
    message: str | None


@dataclass(slots=True)
class DingTalkMediaDeliveryResult:
    delivered: bool
    message: str | None
    delivery_path: str
    fallback_reason: str | None = None


class DingTalkMediaSender:
    def __init__(
        self,
        *,
        credentials: dict[str, str],
        incoming: IncomingWebhookEvent,
        timeout_seconds: float = 20.0,
    ) -> None:
        self._credentials = credentials
        self._incoming = incoming
        self._timeout_seconds = max(8.0, float(timeout_seconds))

    def _get_access_token(self) -> str:
        client_id = _safe_text(self._credentials.get("client_id") or self._credentials.get("app_key"))
        client_secret = _safe_text(self._credentials.get("client_secret") or self._credentials.get("app_secret"))
        if not client_id or not client_secret:
            raise RuntimeError("missing client_id/client_secret")
        with httpx.Client(timeout=self._timeout_seconds) as client:
            response = client.post(
                "https://api.dingtalk.com/v1.0/oauth2/accessToken",
                json={"appKey": client_id, "appSecret": client_secret},
            )
        if response.status_code >= 400:
            raise RuntimeError(f"token http {response.status_code}: {response.text}")
        payload = response.json()
        access_token = _safe_text(payload.get("accessToken"))
        if not access_token:
            raise RuntimeError(_safe_text(payload.get("errmsg") or "missing accessToken"))
        return access_token

    def upload(
        self,
        *,
        content: bytes,
        filename: str,
        media_type: str,
        mime_type: str | None = None,
    ) -> DingTalkMediaUploadResult:
        normalized_filename = _safe_text(filename) or "attachment.bin"
        normalized_media_type = _safe_text(media_type).lower() or "file"
        if normalized_media_type not in {"image", "voice", "video", "file"}:
            normalized_media_type = "file"
        if not content:
            return DingTalkMediaUploadResult(ok=False, media_id=None, message="empty file content")
        try:
            access_token = self._get_access_token()
        except Exception as exc:
            return DingTalkMediaUploadResult(ok=False, media_id=None, message=f"token failed: {exc}")

        files = {
            "media": (
                normalized_filename,
                content,
                _safe_text(mime_type) or "application/octet-stream",
            ),
        }
        data = {"type": normalized_media_type}
        upload_url = f"https://oapi.dingtalk.com/media/upload?access_token={access_token}"
        try:
            with httpx.Client(timeout=self._timeout_seconds) as client:
                response = client.post(upload_url, data=data, files=files)
        except Exception as exc:
            return DingTalkMediaUploadResult(ok=False, media_id=None, message=f"upload failed: {exc}")

        if response.status_code >= 400:
            return DingTalkMediaUploadResult(
                ok=False,
                media_id=None,
                message=f"upload http {response.status_code}: {response.text}",
            )
        try:
            payload = response.json()
        except Exception:
            payload = {}
        media_id = _safe_text(payload.get("media_id"))
        if not media_id:
            return DingTalkMediaUploadResult(
                ok=False,
                media_id=None,
                message=_safe_text(payload.get("errmsg") or "upload missing media_id"),
            )
        return DingTalkMediaUploadResult(ok=True, media_id=media_id, message="uploaded")

    def _send_request(
        self,
        *,
        url: str,
        payload: dict[str, Any],
        headers: dict[str, str],
        path: str,
    ) -> DingTalkMediaDeliveryResult:
        try:
            with httpx.Client(timeout=self._timeout_seconds) as client:
                response = client.post(url, headers=headers, json=payload)
        except Exception as exc:
            return DingTalkMediaDeliveryResult(
                delivered=False,
                message=f"send exception: {exc}",
                delivery_path=path,
            )
        if response.status_code >= 400:
            try:
                error_payload = response.json()
            except Exception:
                error_payload = {}
            message = _safe_text(error_payload.get("errmsg") or error_payload.get("message") or response.text)
            return DingTalkMediaDeliveryResult(
                delivered=False,
                message=f"send http {response.status_code}: {message or 'unknown'}",
                delivery_path=path,
            )
        try:
            payload_json = response.json()
        except Exception:
            payload_json = {}
        if int(payload_json.get("errcode") or 0) != 0:
            return DingTalkMediaDeliveryResult(
                delivered=False,
                message=_safe_text(payload_json.get("errmsg") or "send failed"),
                delivery_path=path,
            )
        return DingTalkMediaDeliveryResult(
            delivered=True,
            message="delivered",
            delivery_path=path,
        )

    def _send_via_api(
        self,
        *,
        msg_key: str,
        msg_param: dict[str, Any],
        path_base: str,
    ) -> DingTalkMediaDeliveryResult:
        try:
            access_token = self._get_access_token()
        except Exception as exc:
            return DingTalkMediaDeliveryResult(
                delivered=False,
                message=f"token failed: {exc}",
                delivery_path=path_base,
            )
        robot_code = _safe_text(self._credentials.get("robot_code")) or _safe_text(self._credentials.get("client_id") or self._credentials.get("app_key"))
        if not robot_code:
            return DingTalkMediaDeliveryResult(
                delivered=False,
                message="missing robot_code",
                delivery_path=path_base,
            )
        headers = {
            "x-acs-dingtalk-access-token": access_token,
            "Content-Type": "application/json",
        }
        payload_base = {
            "msgKey": msg_key,
            "msgParam": json.dumps(msg_param, ensure_ascii=False),
        }
        if _is_group_chat(self._incoming):
            if not _safe_text(self._incoming.chat_id):
                return DingTalkMediaDeliveryResult(
                    delivered=False,
                    message="missing openConversationId",
                    delivery_path=f"{path_base}.group",
                )
            return self._send_request(
                url="https://api.dingtalk.com/v1.0/robot/groupMessages/send",
                payload={
                    "robotCode": robot_code,
                    "openConversationId": _safe_text(self._incoming.chat_id),
                    **payload_base,
                },
                headers=headers,
                path=f"{path_base}.group",
            )

        user_id = _safe_text(self._incoming.external_user_id)
        if not user_id:
            return DingTalkMediaDeliveryResult(
                delivered=False,
                message="missing user id",
                delivery_path=f"{path_base}.oto",
            )
        oto_result = self._send_request(
            url="https://api.dingtalk.com/v1.0/robot/oToMessages/batchSend",
            payload={
                "robotCode": robot_code,
                "userIds": [user_id],
                **payload_base,
            },
            headers=headers,
            path=f"{path_base}.oto",
        )
        if oto_result.delivered:
            return oto_result
        conversation_id = _safe_text(self._incoming.chat_id)
        if not conversation_id:
            return oto_result
        fallback_result = self._send_request(
            url="https://api.dingtalk.com/v1.0/robot/groupMessages/send",
            payload={
                "robotCode": robot_code,
                "openConversationId": conversation_id,
                **payload_base,
            },
            headers=headers,
            path=f"{path_base}.group-fallback",
        )
        if fallback_result.delivered:
            fallback_result.fallback_reason = "oTo delivery failed; fallback to groupMessages/send"
            return fallback_result
        return DingTalkMediaDeliveryResult(
            delivered=False,
            message=f"{_safe_text(oto_result.message)}; fallback group failed: {_safe_text(fallback_result.message)}",
            delivery_path=path_base,
            fallback_reason="oTo and group fallback both failed",
        )

    def send_image(self, media_id: str) -> DingTalkMediaDeliveryResult:
        return self._send_via_api(
            msg_key="sampleImageMsg",
            msg_param={"photoURL": _safe_text(media_id)},
            path_base="dingtalk.api.media.image",
        )

    def send_file(
        self,
        media_id: str,
        *,
        file_name: str,
        file_type: str = "file",
    ) -> DingTalkMediaDeliveryResult:
        return self._send_via_api(
            msg_key="sampleFile",
            msg_param={
                "mediaId": _safe_text(media_id),
                "fileName": _safe_text(file_name) or "attachment",
                "fileType": _safe_text(file_type) or "file",
            },
            path_base="dingtalk.api.media.file",
        )

    def send_video(
        self,
        video_media_id: str,
        *,
        video_type: str = "mp4",
        pic_media_id: str | None = None,
    ) -> DingTalkMediaDeliveryResult:
        params: dict[str, Any] = {
            "videoMediaId": _safe_text(video_media_id),
            "videoType": _safe_text(video_type) or "mp4",
        }
        if _safe_text(pic_media_id):
            params["picMediaId"] = _safe_text(pic_media_id)
        return self._send_via_api(
            msg_key="sampleVideo",
            msg_param=params,
            path_base="dingtalk.api.media.video",
        )
