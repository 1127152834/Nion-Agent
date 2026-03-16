"""CLI Interactive Session Manager with PTY support."""

from __future__ import annotations

import asyncio
import logging
import os
import pty
import select
import signal
import struct
import termios
from collections.abc import Callable
from dataclasses import dataclass

from nion.cli.managed_cli_exec import resolve_managed_cli_command
from nion.config.paths import get_paths

logger = logging.getLogger(__name__)


@dataclass
class InteractiveSession:
    """Represents an active CLI interactive session."""

    session_id: str
    tool_id: str
    command: list[str]
    pid: int
    master_fd: int
    status: str  # "running", "waiting_input", "completed", "failed"
    created_at: float
    output_buffer: list[str]


class CLIInteractiveSessionManager:
    """Manages interactive CLI sessions with PTY support."""

    def __init__(self):
        self._sessions: dict[str, InteractiveSession] = {}
        self._output_callbacks: dict[str, Callable[[str, str], None]] = {}

    def start_session(
        self,
        session_id: str,
        tool_id: str,
        argv: list[str],
        output_callback: Callable[[str, str], None] | None = None,
    ) -> InteractiveSession:
        """Start a new interactive CLI session with PTY.

        Args:
            session_id: Unique session identifier
            tool_id: CLI tool identifier
            argv: Command arguments (do not include the executable itself)
            output_callback: Callback for output events (session_id, data)

        Returns:
            InteractiveSession object
        """
        import time

        command = resolve_managed_cli_command(tool_id, argv)

        env = os.environ.copy()
        try:
            # Ensure managed CLIs are discoverable if the invoked CLI spawns other tools.
            bin_dir = str(get_paths().clis_bin_dir)
            sep = ";" if os.name == "nt" else ":"
            env["PATH"] = f"{bin_dir}{sep}{env.get('PATH', '')}"
        except Exception:
            pass

        # Best-effort: if browser configuration exists, expose it to interactive CLIs.
        # Not all CLIs use CHROME_PATH, but this is a common convention.
        try:
            from nion.config.browser_config import load_browser_config  # type: ignore

            chrome_path = load_browser_config().resolved_chrome_path()
            if chrome_path:
                env["CHROME_PATH"] = chrome_path
        except Exception:
            pass

        # Create PTY
        master_fd, slave_fd = pty.openpty()

        # Fork process
        pid = os.fork()

        if pid == 0:
            # Child process
            os.close(master_fd)
            os.setsid()
            os.dup2(slave_fd, 0)  # stdin
            os.dup2(slave_fd, 1)  # stdout
            os.dup2(slave_fd, 2)  # stderr
            os.close(slave_fd)

            # Execute command
            try:
                os.execvpe(command[0], command, env)
            except Exception as e:
                print(f"Failed to execute: {e}", flush=True)
                os._exit(1)
        else:
            # Parent process
            os.close(slave_fd)

            session = InteractiveSession(
                session_id=session_id,
                tool_id=tool_id,
                command=command,
                pid=pid,
                master_fd=master_fd,
                status="running",
                created_at=time.time(),
                output_buffer=[],
            )

            self._sessions[session_id] = session
            if output_callback:
                self._output_callbacks[session_id] = output_callback

            # Start output reader in background
            asyncio.create_task(self._read_output_loop(session_id))

            return session

    async def _read_output_loop(self, session_id: str):
        """Read output from PTY and send to callback."""
        session = self._sessions.get(session_id)
        if not session:
            return

        try:
            while True:
                # Check if process is still alive
                try:
                    pid, status = os.waitpid(session.pid, os.WNOHANG)
                    if pid != 0:
                        # Process exited
                        session.status = "completed" if os.WIFEXITED(status) and os.WEXITSTATUS(status) == 0 else "failed"
                        break
                except ChildProcessError:
                    session.status = "failed"
                    break

                # Read output with timeout
                readable, _, _ = select.select([session.master_fd], [], [], 0.1)
                if readable:
                    try:
                        data = os.read(session.master_fd, 4096)
                        if not data:
                            break

                        text = data.decode("utf-8", errors="replace")
                        session.output_buffer.append(text)

                        # Send to callback
                        callback = self._output_callbacks.get(session_id)
                        if callback:
                            # IMPORTANT: invoke callbacks on the event-loop thread.
                            #
                            # Our WebSocket router's output callback schedules
                            # websocket.send_json() via asyncio.create_task().
                            # If we call it inside a threadpool executor, it
                            # will raise "no running event loop" and the
                            # streaming terminal will appear "stuck" with no
                            # output in the UI.
                            try:
                                callback(session_id, text)
                            except Exception:  # noqa: BLE001
                                logger.exception("Interactive session output callback failed (session_id=%s)", session_id)

                    except OSError:
                        break
                else:
                    await asyncio.sleep(0.1)

        finally:
            # Cleanup
            try:
                os.close(session.master_fd)
            except OSError:
                pass

            if session_id in self._output_callbacks:
                del self._output_callbacks[session_id]

    def send_input(self, session_id: str, data: str) -> bool:
        """Send input to the CLI session.

        Args:
            session_id: Session identifier
            data: Input data to send

        Returns:
            True if successful, False otherwise
        """
        session = self._sessions.get(session_id)
        if not session or session.status not in ("running", "waiting_input"):
            return False

        try:
            os.write(session.master_fd, data.encode("utf-8"))
            session.status = "running"
            return True
        except OSError:
            session.status = "failed"
            return False

    def resize_terminal(self, session_id: str, rows: int, cols: int) -> bool:
        """Resize the terminal window.

        Args:
            session_id: Session identifier
            rows: Number of rows
            cols: Number of columns

        Returns:
            True if successful, False otherwise
        """
        session = self._sessions.get(session_id)
        if not session:
            return False

        try:
            winsize = struct.pack("HHHH", rows, cols, 0, 0)
            termios.ioctl(session.master_fd, termios.TIOCSWINSZ, winsize)
            return True
        except OSError:
            return False

    def terminate_session(self, session_id: str, force: bool = False) -> bool:
        """Terminate a CLI session.

        Args:
            session_id: Session identifier
            force: If True, use SIGKILL instead of SIGTERM

        Returns:
            True if successful, False otherwise
        """
        session = self._sessions.get(session_id)
        if not session:
            return False

        try:
            sig = signal.SIGKILL if force else signal.SIGTERM
            os.kill(session.pid, sig)
            session.status = "terminated"
            return True
        except OSError:
            return False

    def get_session(self, session_id: str) -> InteractiveSession | None:
        """Get session by ID."""
        return self._sessions.get(session_id)

    def list_sessions(self) -> list[InteractiveSession]:
        """List all active sessions."""
        return list(self._sessions.values())

    def cleanup_session(self, session_id: str):
        """Clean up session resources."""
        session = self._sessions.get(session_id)
        if session:
            try:
                os.close(session.master_fd)
            except OSError:
                pass

            if session_id in self._output_callbacks:
                del self._output_callbacks[session_id]

            del self._sessions[session_id]


# Global singleton
_manager: CLIInteractiveSessionManager | None = None


def get_session_manager() -> CLIInteractiveSessionManager:
    """Get the global session manager instance."""
    global _manager
    if _manager is None:
        _manager = CLIInteractiveSessionManager()
    return _manager
