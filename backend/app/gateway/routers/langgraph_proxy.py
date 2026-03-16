"""Reverse proxy router for LangGraph API.

Desktop runtime does not run nginx, so frontend requests to /api/langgraph/*
need to be forwarded by gateway.
"""

from __future__ import annotations

import re
from collections.abc import AsyncIterator

import httpx
from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import StreamingResponse
from starlette.background import BackgroundTask

from src.gateway.langgraph_client import build_langgraph_upstream_url, cancel_active_thread_runs

router = APIRouter(prefix="/api/langgraph", tags=["langgraph"])

_HOP_BY_HOP_HEADERS = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailers",
    "transfer-encoding",
    "upgrade",
}

_REQUEST_HEADER_BLOCKLIST = {
    "host",
    "connection",
    "content-length",
}

_STREAM_CONTENT_TYPES = (
    "text/event-stream",
    "application/x-ndjson",
)

_THREAD_DELETE_PATH = re.compile(r"^threads/(?P<thread_id>[^/]+)$")


def _build_target_url(path: str) -> str:
    return build_langgraph_upstream_url(path)


def _forward_request_headers(request: Request) -> dict[str, str]:
    return {key: value for key, value in request.headers.items() if key.lower() not in _REQUEST_HEADER_BLOCKLIST}


def _forward_response_headers(response: httpx.Response) -> dict[str, str]:
    return {key: value for key, value in response.headers.items() if key.lower() not in _HOP_BY_HOP_HEADERS}


def _is_stream_response(content_type: str | None) -> bool:
    if not content_type:
        return False
    lowered = content_type.lower()
    return any(token in lowered for token in _STREAM_CONTENT_TYPES)


async def _stream_response_body(response: httpx.Response) -> AsyncIterator[bytes]:
    async for chunk in response.aiter_raw():
        yield chunk


async def _proxy_request(request: Request, path: str) -> Response:
    target_url = _build_target_url(path)
    request_body = await request.body()
    headers = _forward_request_headers(request)

    client = httpx.AsyncClient(timeout=httpx.Timeout(connect=10.0, read=None, write=30.0, pool=10.0))
    try:
        upstream_request = client.build_request(
            method=request.method,
            url=target_url,
            params=request.query_params,
            headers=headers,
            content=request_body,
        )
        upstream_response = await client.send(upstream_request, stream=True)
    except httpx.RequestError as exc:
        await client.aclose()
        raise HTTPException(status_code=502, detail=f"LangGraph upstream unavailable: {exc}") from exc

    response_headers = _forward_response_headers(upstream_response)
    content_type = upstream_response.headers.get("content-type")

    if _is_stream_response(content_type):
        return StreamingResponse(
            _stream_response_body(upstream_response),
            status_code=upstream_response.status_code,
            headers=response_headers,
            media_type=content_type,
            background=BackgroundTask(
                _close_upstream,
                upstream_response,
                client,
            ),
        )

    body = await upstream_response.aread()
    await upstream_response.aclose()
    await client.aclose()
    return Response(
        content=body,
        status_code=upstream_response.status_code,
        headers=response_headers,
        media_type=content_type,
    )


async def _close_upstream(response: httpx.Response, client: httpx.AsyncClient) -> None:
    await response.aclose()
    await client.aclose()


@router.api_route("", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"])
@router.api_route("/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"])
async def proxy_langgraph(request: Request, path: str = "") -> Response:
    """Forward /api/langgraph/* requests to configured LangGraph server."""

    normalized_path = path.strip("/")
    delete_match = _THREAD_DELETE_PATH.fullmatch(normalized_path)
    if request.method.upper() == "DELETE" and delete_match is not None:
        await cancel_active_thread_runs(delete_match.group("thread_id"))

    return await _proxy_request(request, path)
