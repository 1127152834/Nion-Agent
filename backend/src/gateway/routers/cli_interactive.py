"""CLI interactive session API router."""

from __future__ import annotations

import asyncio
import uuid
from typing import Any

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from src.cli.interactive_session import get_session_manager
from src.keychain import SessionState, get_keychain

router = APIRouter(prefix="/api/cli", tags=["cli"])


class StartSessionRequest(BaseModel):
    """Request to start an interactive CLI session."""

    tool_id: str
    command: list[str]
    restore_session: bool = True  # Try to restore previous session


class StartSessionResponse(BaseModel):
    """Response for starting a session."""

    session_id: str
    status: str
    websocket_url: str


class SendInputRequest(BaseModel):
    """Request to send input to a session."""

    data: str


@router.post("/sessions/start", response_model=StartSessionResponse)
async def start_cli_session(req: StartSessionRequest) -> StartSessionResponse:
    """Start a new interactive CLI session.

    Args:
        req: Session start request

    Returns:
        Session information including WebSocket URL
    """
    session_id = str(uuid.uuid4())
    manager = get_session_manager()

    # Try to restore previous session if requested
    if req.restore_session:
        keychain = get_keychain()
        prev_session = keychain.load_session(req.tool_id)
        if prev_session:
            # Inject environment variables from previous session
            import os

            for key, value in prev_session.environment.items():
                os.environ[key] = value

    # Session will be started when WebSocket connects
    return StartSessionResponse(
        session_id=session_id,
        status="pending",
        websocket_url=f"/api/cli/sessions/{session_id}/stream",
    )


@router.websocket("/sessions/{session_id}/stream")
async def stream_cli_session(websocket: WebSocket, session_id: str):
    """Stream CLI output and receive input via WebSocket.

    Args:
        websocket: WebSocket connection
        session_id: Session identifier
    """
    await websocket.accept()
    manager = get_session_manager()
    keychain = get_keychain()

    # Get session info from initial message
    try:
        init_msg = await websocket.receive_json()
        tool_id = init_msg["tool_id"]
        command = init_msg["command"]
    except Exception as e:
        await websocket.send_json({"type": "error", "error": f"Invalid init message: {e}"})
        await websocket.close()
        return

    # Output callback to send data to WebSocket
    def output_callback(sid: str, data: str):
        asyncio.create_task(websocket.send_json({"type": "output", "data": data}))

    # Start the session
    try:
        session = manager.start_session(
            session_id=session_id,
            tool_id=tool_id,
            command=command,
            output_callback=output_callback,
        )

        await websocket.send_json({"type": "started", "session_id": session_id})

        # Handle incoming messages
        while True:
            try:
                message = await websocket.receive_json()
                msg_type = message.get("type")

                if msg_type == "input":
                    # Send input to CLI
                    data = message.get("data", "")
                    success = manager.send_input(session_id, data)
                    if not success:
                        await websocket.send_json({"type": "error", "error": "Failed to send input"})

                elif msg_type == "resize":
                    # Resize terminal
                    rows = message.get("rows", 24)
                    cols = message.get("cols", 80)
                    manager.resize_terminal(session_id, rows, cols)

                elif msg_type == "terminate":
                    # Terminate session
                    manager.terminate_session(session_id)
                    await websocket.send_json({"type": "terminated"})
                    break

            except WebSocketDisconnect:
                break
            except Exception as e:
                await websocket.send_json({"type": "error", "error": str(e)})

    except Exception as e:
        await websocket.send_json({"type": "error", "error": f"Failed to start session: {e}"})
    finally:
        # Save session state
        session = manager.get_session(session_id)
        if session:
            # Extract environment and save to keychain
            import os
            from datetime import datetime, timedelta

            session_state = SessionState(
                service=tool_id,
                session_id=session_id,
                cookies={},  # TODO: Extract from CLI if available
                tokens={},  # TODO: Extract from CLI if available
                environment=dict(os.environ),
                working_dir=os.getcwd(),
                last_active=datetime.utcnow(),
                expires_at=datetime.utcnow() + timedelta(days=7),
            )
            keychain.save_session(session_state)

        # Cleanup
        manager.cleanup_session(session_id)
        await websocket.close()


@router.get("/sessions/{session_id}/status")
async def get_session_status(session_id: str) -> dict[str, Any]:
    """Get session status.

    Args:
        session_id: Session identifier

    Returns:
        Session status information
    """
    manager = get_session_manager()
    session = manager.get_session(session_id)

    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    return {
        "session_id": session.session_id,
        "tool_id": session.tool_id,
        "command": session.command,
        "status": session.status,
        "created_at": session.created_at,
    }


@router.post("/sessions/{session_id}/terminate")
async def terminate_session(session_id: str) -> dict[str, str]:
    """Terminate a CLI session.

    Args:
        session_id: Session identifier

    Returns:
        Success message
    """
    manager = get_session_manager()
    success = manager.terminate_session(session_id)

    if not success:
        raise HTTPException(status_code=404, detail="Session not found")

    return {"status": "terminated"}
