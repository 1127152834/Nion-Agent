from __future__ import annotations

import os
from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel, Field

from src.gateway.config import get_gateway_config
from src.gateway.langgraph_client import get_langgraph_upstream_base_url

router = APIRouter(prefix="/api/runtime/topology", tags=["runtime"])

_ALLOW_ORIGIN_REGEX = r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$"


class RuntimeTopologyResponse(BaseModel):
    runtime_mode: Literal["desktop", "web"]
    gateway_host: str
    gateway_port: int
    gateway_facade_path: str = "/api/langgraph"
    langgraph_upstream: str
    frontend_allowed_origins: list[str] = Field(default_factory=list)
    cors_allow_origin_regex: str = _ALLOW_ORIGIN_REGEX
    browser_should_use_gateway_facade: bool = True


@router.get("", response_model=RuntimeTopologyResponse, summary="Inspect Runtime Topology")
async def get_runtime_topology() -> RuntimeTopologyResponse:
    cfg = get_gateway_config()
    runtime_mode: Literal["desktop", "web"] = (
        "desktop" if os.getenv("NION_DESKTOP_RUNTIME", "0") == "1" else "web"
    )
    return RuntimeTopologyResponse(
        runtime_mode=runtime_mode,
        gateway_host=cfg.host,
        gateway_port=cfg.port,
        langgraph_upstream=get_langgraph_upstream_base_url(),
        frontend_allowed_origins=cfg.cors_origins,
    )
