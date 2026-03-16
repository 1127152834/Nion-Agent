from __future__ import annotations

import os
import subprocess
import sys
from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel

from src.agents.memory.scope import normalize_agent_name_for_memory
from src.config.default_agent import DEFAULT_AGENT_NAME
from src.config.paths import get_paths

router = APIRouter(prefix="/api/runtime/info", tags=["runtime"])


def _safe_git_sha() -> str | None:
    """Best-effort git SHA helper.

    Desktop packaged builds or production containers may not have git available.
    This endpoint must never fail because git is missing.
    """

    try:
        out = subprocess.check_output(
            ["git", "rev-parse", "HEAD"],
            stderr=subprocess.DEVNULL,
            text=True,
        )
        sha = out.strip()
        return sha if sha else None
    except Exception:  # noqa: BLE001
        return None


def _has_sentence_transformers() -> bool:
    try:
        import sentence_transformers  # noqa: F401
    except Exception:  # noqa: BLE001
        return False
    return True


class RuntimeInfoResponse(BaseModel):
    runtime_mode: Literal["desktop", "web"]
    base_dir: str
    nion_home_env: str | None
    openviking_index_db: str
    python_version: str
    git_sha: str | None
    sentence_transformers_available: bool
    default_agent_name: str
    default_agent_normalized: str | None


@router.get("", response_model=RuntimeInfoResponse, summary="Inspect runtime info (debug)")
async def get_runtime_info() -> RuntimeInfoResponse:
    paths = get_paths()
    runtime_mode: Literal["desktop", "web"] = "desktop" if os.getenv("NION_DESKTOP_RUNTIME", "0") == "1" else "web"
    return RuntimeInfoResponse(
        runtime_mode=runtime_mode,
        base_dir=str(paths.base_dir),
        nion_home_env=os.getenv("NION_HOME"),
        openviking_index_db=str(paths.openviking_index_db),
        python_version=sys.version.split()[0],
        git_sha=_safe_git_sha(),
        sentence_transformers_available=_has_sentence_transformers(),
        default_agent_name=DEFAULT_AGENT_NAME,
        default_agent_normalized=normalize_agent_name_for_memory(DEFAULT_AGENT_NAME),
    )

