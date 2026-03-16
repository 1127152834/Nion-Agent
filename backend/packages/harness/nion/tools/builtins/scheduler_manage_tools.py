"""Chat tools for scheduler management."""

from __future__ import annotations

import json
import os
import uuid
from datetime import datetime
from typing import Any, Literal
from urllib.parse import quote

import httpx
from langgraph.typing import ContextT

from src.agents.thread_state import ThreadState
from src.scheduler.models import AgentStep, ScheduledTask, TaskMode, TriggerConfig, WorkflowStep
from src.tools.builtins.confirmation_store import consume_confirmation_token, issue_confirmation_token
from src.tools.builtins.langchain_compat import ToolRuntime, tool
from src.tools.builtins.management_response import build_action_card, build_management_response


def _runtime_agent_name(runtime: ToolRuntime[ContextT, ThreadState] | None) -> str:
    if runtime is None:
        return "_default"
    context = runtime.context or {}
    value = context.get("agent_name") if isinstance(context, dict) else None
    if isinstance(value, str) and value.strip():
        return value.strip()
    return "_default"


def _runtime_timezone(runtime: ToolRuntime[ContextT, ThreadState] | None) -> str:
    if runtime is None:
        return "UTC"
    context = runtime.context or {}
    value = context.get("user_timezone") if isinstance(context, dict) else None
    if isinstance(value, str) and value.strip():
        return value.strip()
    return "UTC"


def _resolve_gateway_base_url() -> str:
    """Resolve Gateway base URL for scheduler CRUD from LangGraph process.

    NOTE: LangGraph Server and Gateway are separate processes in desktop mode.
    Scheduler tasks must be created via Gateway API so the UI can see them.
    """
    env_value = (os.getenv("NION_GATEWAY_BASE_URL") or "").strip()
    if env_value:
        return env_value.rstrip("/")

    # Desktop runtime writes ports into config.db; reuse it to avoid hard-coding 8001.
    if (os.getenv("NION_DESKTOP_RUNTIME") or "").strip():
        try:
            from src.config.config_repository import ConfigRepository

            config, _, _ = ConfigRepository().read()
            desktop = config.get("desktop") if isinstance(config, dict) else None
            runtime_ports = desktop.get("runtime_ports") if isinstance(desktop, dict) else None
            gateway_port = runtime_ports.get("gateway_port") if isinstance(runtime_ports, dict) else None
            if isinstance(gateway_port, int) and 1 <= gateway_port <= 65535:
                return f"http://127.0.0.1:{gateway_port}"
        except Exception:
            pass

    gateway_port = (os.getenv("GATEWAY_PORT") or "").strip()
    if gateway_port.isdigit():
        return f"http://127.0.0.1:{gateway_port}"

    return "http://127.0.0.1:8001"


def _gateway_request_json(
    method: str,
    path: str,
    *,
    payload: dict[str, Any] | None = None,
    timeout_seconds: float = 10.0,
) -> Any:
    base_url = _resolve_gateway_base_url()
    url = f"{base_url}{path}"
    try:
        response = httpx.request(method, url, json=payload, timeout=timeout_seconds)
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(f"无法连接调度服务（{exc}）") from exc

    data: Any = None
    if response.content:
        try:
            data = response.json()
        except Exception:
            data = None

    if response.status_code >= 400:
        detail = data.get("detail") if isinstance(data, dict) else None
        raise RuntimeError(detail or f"调度服务返回错误：HTTP {response.status_code}")
    return data


def _parse_scheduled_time(value: str | None) -> datetime | None:
    if not value:
        return None
    normalized = value.strip()
    if normalized.endswith("Z"):
        normalized = normalized[:-1] + "+00:00"
    return datetime.fromisoformat(normalized)


def _build_workflow_steps(
    workflow_prompt: str | None,
    workflow_steps_json: str | None,
    *,
    task_agent_name: str,
) -> list[WorkflowStep]:
    if workflow_steps_json:
        raw = json.loads(workflow_steps_json)
        if not isinstance(raw, list):
            raise ValueError("workflow_steps_json must be a JSON array")
        return [WorkflowStep.model_validate(item) for item in raw]

    if workflow_prompt and workflow_prompt.strip():
        default_step = WorkflowStep(
            id=f"step-{uuid.uuid4().hex[:6]}",
            name="default-step",
            parallel=False,
            depends_on=[],
            agents=[
                AgentStep(
                    agent_name=task_agent_name,
                    prompt=workflow_prompt.strip(),
                    timeout_seconds=300,
                    retry_on_failure=False,
                    max_retries=0,
                )
            ],
        )
        return [default_step]

    return []


def _build_clarification_response(
    *,
    message: str,
    question: str,
    missing_fields: list[str],
    options: list[str] | None = None,
) -> str:
    return build_management_response(
        success=False,
        message=message,
        data={"missing_fields": missing_fields},
        next_action="ask_clarification",
        clarification={
            "question": question,
            "missing_fields": missing_fields,
            "options": options or [],
        },
        ui_card=build_action_card(
            title="还缺少信息",
            description=question,
            status="warning",
        ),
    )


@tool("scheduler_create_task")
def scheduler_create_task_tool(
    runtime: ToolRuntime[ContextT, ThreadState],
    name: str,
    mode: Literal["reminder", "workflow"] = "reminder",
    trigger_type: Literal["cron", "interval", "once", "event", "webhook"] = "cron",
    description: str | None = None,
    timezone: str | None = None,
    cron_expression: str | None = None,
    interval_seconds: int | None = None,
    scheduled_time: str | None = None,
    event_type: str | None = None,
    event_filters: dict[str, Any] | None = None,
    webhook_secret: str | None = None,
    reminder_title: str | None = None,
    reminder_message: str | None = None,
    workflow_prompt: str | None = None,
    workflow_steps_json: str | None = None,
) -> str:
    """Create a scheduler task from chat.

    This tool supports:
    - Reminder mode (lightweight, no LLM workflow execution)
    - Workflow mode (single or multi-step execution)
    """
    if not name.strip():
        return _build_clarification_response(
            message="创建失败：缺少任务名称。",
            question="请告诉我这个定时任务的名称，比如“喝水提醒”或“日报生成”。",
            missing_fields=["name"],
        )

    if trigger_type == "cron" and not (cron_expression or "").strip():
        return _build_clarification_response(
            message="创建失败：cron 触发缺少 cron_expression。",
            question="你希望按什么周期执行？例如“每天早上9点”或直接给 Cron 表达式（如 0 9 * * *）。",
            missing_fields=["cron_expression"],
        )

    if trigger_type == "interval" and (interval_seconds is None or interval_seconds <= 0):
        return _build_clarification_response(
            message="创建失败：interval 触发需要正整数 interval_seconds。",
            question="请告诉我间隔多久执行一次（秒）。例如 3600 表示每小时一次。",
            missing_fields=["interval_seconds"],
        )

    if trigger_type == "once" and not (scheduled_time or "").strip():
        return _build_clarification_response(
            message="创建失败：once 触发缺少 scheduled_time。",
            question="请告诉我具体执行时间（ISO 格式），例如 2026-03-07T09:00:00+08:00。",
            missing_fields=["scheduled_time"],
        )

    if trigger_type == "event" and not (event_type or "").strip():
        return _build_clarification_response(
            message="创建失败：event 触发缺少 event_type。",
            question="请告诉我事件类型，例如 user_created、task_completed。",
            missing_fields=["event_type"],
        )

    effective_timezone = (timezone or _runtime_timezone(runtime)).strip() or "UTC"
    task_agent_name = _runtime_agent_name(runtime)
    created_by = "chat-user"
    if runtime is not None and isinstance(runtime.context, dict):
        created_by = str(runtime.context.get("thread_id") or "chat-user")

    try:
        trigger = TriggerConfig(
            type=trigger_type,
            cron_expression=cron_expression,
            interval_seconds=interval_seconds,
            scheduled_time=_parse_scheduled_time(scheduled_time),
            event_type=event_type,
            event_filters=event_filters,
            webhook_secret=webhook_secret,
            timezone=effective_timezone,
        )
    except Exception as exc:  # noqa: BLE001
        if trigger_type == "once":
            return _build_clarification_response(
                message=f"创建失败：scheduled_time 格式无效（{exc}）",
                question="请提供可解析的时间，例如 2026-03-07T09:00:00+08:00。",
                missing_fields=["scheduled_time"],
            )
        return build_management_response(
            success=False,
            message=f"创建失败：触发器配置无效（{exc}）",
            data={"stage": "trigger_validation"},
        )

    task_mode = TaskMode.REMINDER if mode == "reminder" else TaskMode.WORKFLOW

    try:
        steps = (
            _build_workflow_steps(
                workflow_prompt,
                workflow_steps_json,
                task_agent_name=task_agent_name,
            )
            if task_mode == TaskMode.WORKFLOW
            else []
        )
    except Exception as exc:  # noqa: BLE001
        return build_management_response(
            success=False,
            message=f"创建失败：工作流配置无效（{exc}）",
            data={"stage": "workflow_validation"},
        )

    if task_mode == TaskMode.WORKFLOW and not steps:
        return _build_clarification_response(
            message="创建失败：workflow 模式需要提供 workflow_prompt 或 workflow_steps_json。",
            question="这是一个高级工作流任务，请补充任务描述（workflow_prompt）或完整步骤配置（workflow_steps_json）。",
            missing_fields=["workflow_prompt_or_steps"],
        )

    reminder_text = reminder_message or description or name
    reminder_header = reminder_title or name

    try:
        created_payload = _gateway_request_json(
            "POST",
            "/api/scheduler/tasks",
            payload={
                "agent_name": task_agent_name,
                "name": name.strip(),
                "description": description,
                "mode": task_mode.value,
                "trigger": trigger.model_dump(mode="json"),
                "steps": [step.model_dump(mode="json") for step in steps],
                "reminder_title": reminder_header if task_mode == TaskMode.REMINDER else None,
                "reminder_message": reminder_text if task_mode == TaskMode.REMINDER else None,
                "enabled": True,
                "created_by": created_by,
            },
        )
        created = ScheduledTask.model_validate(created_payload)
    except Exception as exc:  # noqa: BLE001
        return build_management_response(
            success=False,
            message=f"创建失败：{exc}",
            data={"stage": "gateway_request"},
        )

    next_run = created.next_run_at.isoformat() if created.next_run_at else "-"
    card = build_action_card(
        title="定时任务已创建",
        description=f"{created.name}（{created.mode.value}）\n智能体：{task_agent_name}\n下次执行：{next_run}",
        status="success",
        actions=[
            {
                "kind": "link",
                "label": "前往定时任务",
                "href": f"/workspace/agents/{quote(task_agent_name)}/settings?section=scheduler",
            }
        ],
    )
    return build_management_response(
        success=True,
        message=f"任务 {created.name} 创建成功。",
        data={
            "task_id": created.id,
            "mode": created.mode.value,
            "status": created.status.value,
            "next_run_at": created.next_run_at.isoformat() if created.next_run_at else None,
        },
        ui_card=card,
    )


@tool("scheduler_operate_task")
def scheduler_operate_task_tool(
    task_id: str,
    operation: Literal["run", "enable", "disable", "delete"],
    confirmation_token: str | None = None,
) -> str:
    """Run or manage existing scheduler task with confirmation for destructive actions."""
    try:
        task_payload = _gateway_request_json(
            "GET",
            f"/api/scheduler/tasks/{task_id}",
        )
        task = ScheduledTask.model_validate(task_payload)
    except Exception as exc:  # noqa: BLE001
        return build_management_response(
            success=False,
            message=f"任务不存在或调度服务不可用：{exc}",
            data={"task_id": task_id, "stage": "gateway_request"},
        )

    destructive = operation in {"disable", "delete"}
    target = f"scheduler:{task_id}:{operation}"
    if destructive and not confirmation_token:
        token = issue_confirmation_token(action=operation, target=target, payload={"task_id": task_id})
        card = build_action_card(
            title="需要二次确认",
            description=f"操作 {operation} 可能影响任务执行，请确认后继续。",
            status="warning",
        )
        return build_management_response(
            success=False,
            message=(f"请先确认操作：{operation}。确认后请在下一次工具调用中附带 confirmation_token。"),
            data={"task_id": task_id, "operation": operation},
            requires_confirmation=True,
            confirmation_token=token,
            ui_card=card,
        )

    if destructive and confirmation_token:
        ok, reason = consume_confirmation_token(token=confirmation_token, action=operation, target=target)
        if not ok:
            return build_management_response(
                success=False,
                message=reason,
                data={"task_id": task_id, "operation": operation},
            )

    try:
        if operation == "run":
            record = _gateway_request_json(
                "POST",
                f"/api/scheduler/tasks/{task_id}/run",
            )
            return build_management_response(
                success=True,
                message=f"任务 {task_id} 已触发执行。",
                data={"task_id": task_id, "run_id": record.get("run_id"), "status": record.get("status")},
                ui_card=build_action_card(
                    title="任务已触发",
                    description=f"{task.name} 已触发执行（run_id: {record.get('run_id') or '-'}）。",
                    status="success",
                    actions=[
                        {
                            "kind": "link",
                            "label": "前往定时任务",
                            "href": f"/workspace/agents/{quote(task.agent_name)}/settings?section=scheduler",
                        }
                    ],
                ),
            )

        if operation in {"enable", "disable"}:
            enabled = operation == "enable"
            _gateway_request_json(
                "PUT",
                f"/api/scheduler/tasks/{task_id}",
                payload={
                    "agent_name": task.agent_name,
                    "name": task.name,
                    "description": task.description,
                    "mode": task.mode.value,
                    "trigger": task.trigger.model_dump(mode="json"),
                    "steps": [step.model_dump(mode="json") for step in task.steps],
                    "reminder_title": task.reminder_title,
                    "reminder_message": task.reminder_message,
                    "on_complete": task.on_complete,
                    "on_failure": task.on_failure,
                    "notification_webhook": task.notification_webhook,
                    "max_concurrent_steps": task.max_concurrent_steps,
                    "timeout_seconds": task.timeout_seconds,
                    "retry_policy": task.retry_policy.model_dump(mode="json") if task.retry_policy else None,
                    "enabled": enabled,
                },
            )
            return build_management_response(
                success=True,
                message=f"任务 {task_id} 已{'启用' if enabled else '禁用'}。",
                data={"task_id": task_id, "enabled": enabled},
            )

        if operation == "delete":
            _gateway_request_json(
                "DELETE",
                f"/api/scheduler/tasks/{task_id}",
            )
            return build_management_response(
                success=True,
                message=f"任务 {task_id} 已删除。",
                data={"task_id": task_id},
            )
    except Exception as exc:  # noqa: BLE001
        return build_management_response(
            success=False,
            message=f"操作失败：{exc}",
            data={"task_id": task_id, "operation": operation, "stage": "gateway_request"},
        )

    return build_management_response(
        success=False,
        message=f"未知操作：{operation}",
        data={"task_id": task_id, "operation": operation},
    )
