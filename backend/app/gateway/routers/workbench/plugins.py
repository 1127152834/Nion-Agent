"""Workbench plugin test endpoints."""

from __future__ import annotations

import subprocess
import time
import uuid

from fastapi import APIRouter, HTTPException

from app.gateway.path_utils import resolve_thread_virtual_path
from app.gateway.routers.workbench._helpers import (
    _ensure_langgraph_thread_for_plugin_test,
    _resolve_cwd,
    _utcnow_iso,
)
from app.gateway.routers.workbench.models import (
    PluginTestRequest,
    PluginTestResponse,
    PluginTestStepResult,
    PluginTestThreadResponse,
)
from nion.config.paths import get_paths

router = APIRouter(prefix="/api/workbench/plugins", tags=["workbench"])


@router.post(
    "/test-thread",
    response_model=PluginTestThreadResponse,
    summary="Create hidden workbench test thread",
)
async def create_workbench_test_thread() -> PluginTestThreadResponse:
    """Create a sandbox-only thread directory for workbench plugin tests.

    This avoids coupling plugin tests to any existing chat thread while still
    providing a valid /mnt/user-data workspace for commandSteps execution.
    """
    thread_id = str(uuid.uuid4())
    await _ensure_langgraph_thread_for_plugin_test(thread_id, best_effort=True)
    paths = get_paths()
    paths.ensure_thread_dirs(thread_id)
    return PluginTestThreadResponse(
        thread_id=thread_id,
        created_at=_utcnow_iso(),
        workspace_root=str(paths.sandbox_work_dir(thread_id)),
    )


@router.post(
    "/{plugin_id}/test",
    response_model=PluginTestResponse,
    summary="Run plugin compatibility test",
)
async def test_workbench_plugin(plugin_id: str, payload: PluginTestRequest) -> PluginTestResponse:
    step_results: list[PluginTestStepResult] = []
    all_passed = True

    for index, step in enumerate(payload.command_steps):
        started_at = time.time()
        step_id = step.id or f"command-{index + 1}"
        try:
            virtual_cwd, actual_cwd = _resolve_cwd(payload.thread_id, step.cwd)
        except HTTPException as exc:
            duration_ms = int((time.time() - started_at) * 1000)
            step_results.append(
                PluginTestStepResult(
                    id=step_id,
                    passed=False,
                    command=step.command,
                    cwd=step.cwd,
                    exit_code=None,
                    duration_ms=duration_ms,
                    output_excerpt="",
                    message=str(exc.detail),
                ),
            )
            all_passed = False
            continue

        output_excerpt = ""
        exit_code: int | None = None
        passed = False
        message: str | None = None

        try:
            process = subprocess.run(
                ["/bin/zsh", "-lc", step.command],
                cwd=str(actual_cwd),
                capture_output=True,
                text=True,
                timeout=step.timeout_seconds,
            )
            exit_code = process.returncode
            combined_output = (process.stdout or "") + ("\n" + process.stderr if process.stderr else "")
            output_excerpt = combined_output[:4000]
            passed = process.returncode == 0
            if passed and step.expect_contains:
                for expected in step.expect_contains:
                    if expected in combined_output:
                        continue

                    # Allow virtual /mnt/user-data paths to match their resolved host paths.
                    # Workbench command steps run on the host, so `pwd` will emit host paths.
                    alternate_match = False
                    if expected.startswith("/mnt/user-data"):
                        try:
                            resolved = resolve_thread_virtual_path(payload.thread_id, expected)
                            if str(resolved) in combined_output:
                                alternate_match = True
                        except HTTPException:
                            alternate_match = False

                    if not alternate_match:
                        passed = False
                        message = f"Missing expected output fragment: {expected}"
                        break
            if not passed and message is None and process.returncode != 0:
                message = f"Command exited with code {process.returncode}"
        except subprocess.TimeoutExpired as exc:
            timeout_output = (exc.stdout or "") + ("\n" + exc.stderr if exc.stderr else "")
            output_excerpt = timeout_output[:4000]
            passed = False
            message = f"Command timed out after {step.timeout_seconds}s"
        except Exception as exc:
            passed = False
            message = f"Command execution failed: {exc}"

        duration_ms = int((time.time() - started_at) * 1000)
        step_results.append(
            PluginTestStepResult(
                id=step_id,
                passed=passed,
                command=step.command,
                cwd=virtual_cwd,
                exit_code=exit_code,
                duration_ms=duration_ms,
                output_excerpt=output_excerpt,
                message=message,
            ),
        )
        all_passed = all_passed and passed

    if not payload.command_steps:
        summary = "No command steps provided; plugin test accepted."
    elif all_passed:
        summary = f"All {len(payload.command_steps)} command steps passed."
    else:
        summary = f"{sum(1 for r in step_results if r.passed)}/{len(payload.command_steps)} command steps passed."

    return PluginTestResponse(
        plugin_id=plugin_id,
        passed=all_passed,
        executed_at=_utcnow_iso(),
        summary=summary,
        steps=step_results,
    )
