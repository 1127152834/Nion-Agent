from __future__ import annotations

import time
from typing import Any

import httpx

from src.channels.repository import SUPPORTED_CHANNEL_PLATFORMS


class ChannelConnectionService:
    """Connectivity probes for channel providers."""

    def test_connection(
        self,
        platform: str,
        credentials: dict[str, str],
        *,
        timeout_seconds: float = 8.0,
    ) -> dict[str, Any]:
        normalized = platform.strip().lower()
        if normalized not in SUPPORTED_CHANNEL_PLATFORMS:
            raise ValueError(f"Unsupported channel platform: {platform}")
        if normalized == "lark":
            return self._test_lark(credentials, timeout_seconds=timeout_seconds)
        return self._test_dingtalk(credentials, timeout_seconds=timeout_seconds)

    def _test_lark(self, credentials: dict[str, str], *, timeout_seconds: float) -> dict[str, Any]:
        app_id = str(credentials.get("app_id") or credentials.get("cli_a") or "").strip()
        app_secret = str(credentials.get("app_secret") or credentials.get("secret") or "").strip()
        if not app_id or not app_secret:
            return {
                "platform": "lark",
                "success": False,
                "message": "Missing app_id or app_secret",
                "latency_ms": None,
            }

        endpoint = "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal"
        started_at = time.perf_counter()
        with httpx.Client(timeout=timeout_seconds) as client:
            response = client.post(
                endpoint,
                json={"app_id": app_id, "app_secret": app_secret},
            )
        latency_ms = int((time.perf_counter() - started_at) * 1000)

        if response.status_code >= 400:
            return {
                "platform": "lark",
                "success": False,
                "message": f"HTTP {response.status_code}: {response.text}",
                "latency_ms": latency_ms,
            }
        payload = response.json()
        code = payload.get("code")
        ok = int(code or 0) == 0 and bool(payload.get("tenant_access_token"))
        if ok:
            return {
                "platform": "lark",
                "success": True,
                "message": "Connection successful",
                "latency_ms": latency_ms,
            }
        msg = str(payload.get("msg") or payload.get("message") or "Connection failed")
        return {
            "platform": "lark",
            "success": False,
            "message": msg,
            "latency_ms": latency_ms,
        }

    def _test_dingtalk(self, credentials: dict[str, str], *, timeout_seconds: float) -> dict[str, Any]:
        client_id = str(credentials.get("client_id") or credentials.get("app_key") or "").strip()
        client_secret = str(credentials.get("client_secret") or credentials.get("app_secret") or "").strip()
        if not client_id or not client_secret:
            return {
                "platform": "dingtalk",
                "success": False,
                "message": "Missing client_id or client_secret",
                "latency_ms": None,
            }

        endpoint = "https://api.dingtalk.com/v1.0/oauth2/accessToken"
        started_at = time.perf_counter()
        with httpx.Client(timeout=timeout_seconds) as client:
            response = client.post(
                endpoint,
                json={"appKey": client_id, "appSecret": client_secret},
            )
        latency_ms = int((time.perf_counter() - started_at) * 1000)
        if response.status_code >= 400:
            return {
                "platform": "dingtalk",
                "success": False,
                "message": f"HTTP {response.status_code}: {response.text}",
                "latency_ms": latency_ms,
            }
        payload = response.json()
        if payload.get("accessToken"):
            return {
                "platform": "dingtalk",
                "success": True,
                "message": "Connection successful",
                "latency_ms": latency_ms,
            }
        msg = str(payload.get("errmsg") or payload.get("message") or "Connection failed")
        return {
            "platform": "dingtalk",
            "success": False,
            "message": msg,
            "latency_ms": latency_ms,
        }
