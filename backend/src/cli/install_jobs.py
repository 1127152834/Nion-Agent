from __future__ import annotations

import asyncio
import json
import os
import queue
import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal

import httpx

from src.cli.catalog import CliMarketplaceTool, CliMarketplaceToolPlatform
from src.cli.installer import CliInstallError, install_cli_tool
from src.config.extensions_config import CliStateConfig, ExtensionsConfig, reload_extensions_config
from src.config.paths import get_paths


CliInstallJobStatus = Literal["pending", "running", "succeeded", "failed"]

_MAX_JOB_LOG_LINES = 200
_MAX_JOB_MESSAGE_CHARS = 1200
_JOB_TTL_SECONDS = 60 * 60


@dataclass
class CliInstallJob:
    job_id: str
    tool_id: str
    status: CliInstallJobStatus = "pending"
    message: str = ""
    logs: list[str] = field(default_factory=list)
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    finished_at: float | None = None
    result: dict[str, Any] | None = None
    subscribers: set[queue.Queue] = field(default_factory=set, repr=False)

    def append_log(self, line: str) -> None:
        text = str(line or "").strip()
        if not text:
            return
        self.logs.append(text)
        if len(self.logs) > _MAX_JOB_LOG_LINES:
            self.logs = self.logs[-_MAX_JOB_LOG_LINES :]
        self.updated_at = time.time()

    def set_message(self, message: str) -> None:
        msg = str(message or "").strip()
        if len(msg) > _MAX_JOB_MESSAGE_CHARS:
            msg = msg[:_MAX_JOB_MESSAGE_CHARS] + "...(truncated)"
        self.message = msg
        self.updated_at = time.time()

    def snapshot(self) -> dict[str, Any]:
        last = self.logs[-1] if self.logs else ""
        return {
            "job_id": self.job_id,
            "tool_id": self.tool_id,
            "status": self.status,
            "message": self.message,
            "last_log_line": last,
            "logs_tail": self.logs[-20:],
            "result": self.result,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "finished_at": self.finished_at,
        }


_lock = threading.Lock()
_config_write_lock = threading.Lock()
_jobs: dict[str, CliInstallJob] = {}
_active_job_by_tool: dict[str, str] = {}


def _broadcast_locked(job: CliInstallJob) -> None:
    if not job.subscribers:
        return
    snapshot = job.snapshot()
    for q in list(job.subscribers):
        try:
            # Keep only the latest snapshot per subscriber to avoid unbounded memory growth.
            if getattr(q, "full", None) and q.full():
                try:
                    q.get_nowait()
                except Exception:
                    pass
            q.put_nowait(snapshot)
        except Exception:
            # Best-effort: a broken subscriber should not affect job execution.
            pass


def _cleanup_jobs_locked(now: float | None = None) -> None:
    now = float(now or time.time())
    stale: list[str] = []
    for job_id, job in _jobs.items():
        if job.status in {"pending", "running"}:
            continue
        if now - job.updated_at > _JOB_TTL_SECONDS:
            stale.append(job_id)
    for job_id in stale:
        try:
            tool_id = _jobs[job_id].tool_id
            if _active_job_by_tool.get(tool_id) == job_id:
                del _active_job_by_tool[tool_id]
        except Exception:
            pass
        _jobs.pop(job_id, None)


def _resolve_extensions_config_path() -> Path:
    # Persist extensions config under the Nion data dir by default so managed CLI
    # installs survive restarts and do not depend on current working directory.
    if env_path := os.getenv("NION_EXTENSIONS_CONFIG_PATH"):
        return Path(env_path).expanduser().resolve()
    return ExtensionsConfig.default_config_path()


def _write_extensions_config_file(config_path: Path, cfg: ExtensionsConfig) -> None:
    payload = {
        "mcpServers": {name: server.model_dump() for name, server in cfg.mcp_servers.items()},
        "skills": {name: {"enabled": skill.enabled} for name, skill in cfg.skills.items()},
        "clis": {name: cli.model_dump() for name, cli in cfg.clis.items()},
    }
    temp_path = config_path.with_suffix(".tmp")
    temp_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    temp_path.replace(config_path)


def get_cli_install_job_snapshot(job_id: str) -> dict[str, Any] | None:
    job_id = str(job_id or "").strip()
    if not job_id:
        return None
    with _lock:
        _cleanup_jobs_locked()
        job = _jobs.get(job_id)
        return job.snapshot() if job else None


def subscribe_cli_install_job(job_id: str) -> tuple[queue.Queue, dict[str, Any]] | None:
    job_id = str(job_id or "").strip()
    if not job_id:
        return None
    with _lock:
        _cleanup_jobs_locked()
        job = _jobs.get(job_id)
        if not job:
            return None
        q: queue.Queue = queue.Queue(maxsize=1)
        job.subscribers.add(q)
        return q, job.snapshot()


def unsubscribe_cli_install_job(job_id: str, q: queue.Queue) -> None:
    job_id = str(job_id or "").strip()
    if not job_id:
        return
    with _lock:
        job = _jobs.get(job_id)
        if not job:
            return
        job.subscribers.discard(q)


def start_cli_install_job(*, tool: CliMarketplaceTool, platform: CliMarketplaceToolPlatform) -> str:
    tool_id = str(tool.id or "").strip()
    if not tool_id:
        raise ValueError("tool.id is required")

    with _lock:
        _cleanup_jobs_locked()
        active_id = _active_job_by_tool.get(tool_id)
        if active_id:
            active = _jobs.get(active_id)
            if active and active.status in {"pending", "running"}:
                return active_id

        job_id = uuid.uuid4().hex
        job = CliInstallJob(job_id=job_id, tool_id=tool_id, status="pending")
        job.append_log(f"排队中：准备安装 {tool_id} {tool.version}...")
        job.set_message("Queued")
        _jobs[job_id] = job
        _active_job_by_tool[tool_id] = job_id

        thread = threading.Thread(
            target=_run_cli_install_job_thread,
            args=(job_id, tool, platform),
            daemon=True,
            name=f"cli-install-{tool_id}",
        )
        thread.start()

        return job_id


def _run_cli_install_job_thread(job_id: str, tool: CliMarketplaceTool, platform: CliMarketplaceToolPlatform) -> None:
    def _append(line: str) -> None:
        with _lock:
            job = _jobs.get(job_id)
            if job:
                job.append_log(line)
                _broadcast_locked(job)

    def _set_status(status: CliInstallJobStatus, message: str) -> None:
        with _lock:
            job = _jobs.get(job_id)
            if job:
                job.status = status
                job.set_message(message)
                if status in {"succeeded", "failed"}:
                    job.finished_at = time.time()
                _broadcast_locked(job)

    _set_status("running", "Installing")
    _append("开始安装...")

    try:
        manifest = asyncio.run(install_cli_tool(tool=tool, platform=platform, paths=get_paths(), progress=_append))
        enabled_default = bool(tool.verified)

        _append("写入配置...")
        with _config_write_lock:
            cfg = ExtensionsConfig.from_file()
            cfg.clis[tool.id] = CliStateConfig(enabled=enabled_default, source="managed")
            config_path = _resolve_extensions_config_path()
            config_path.parent.mkdir(parents=True, exist_ok=True)
            _write_extensions_config_file(config_path, cfg)
            reload_extensions_config(str(config_path))

        _append("安装完成。")
        with _lock:
            job = _jobs.get(job_id)
            if job:
                job.result = {
                    "enabled": enabled_default,
                    "bins": [b.name for b in manifest.bins],
                }
                _broadcast_locked(job)
        _set_status("succeeded", "OK")
    except CliInstallError as exc:
        _append("安装失败。")
        _set_status("failed", str(exc))
    except httpx.HTTPError as exc:
        _append("下载失败。")
        _set_status("failed", f"Download failed: {exc}")
    except Exception as exc:  # noqa: BLE001
        _append("安装失败。")
        _set_status("failed", f"Install failed: {exc}")
    finally:
        tool_id = str(tool.id or "").strip()
        with _lock:
            if tool_id and _active_job_by_tool.get(tool_id) == job_id:
                del _active_job_by_tool[tool_id]
