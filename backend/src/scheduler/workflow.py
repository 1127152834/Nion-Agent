"""Workflow execution engine for scheduled tasks."""

from __future__ import annotations

import asyncio
import json
import re
import uuid
from typing import Any

from src.client import NionClient
from src.scheduler.models import AgentStep, CompletionCriteria, CompletionCriteriaType, WorkflowStep


class WorkflowExecutor:
    """Execute multi-step agent workflows."""

    def __init__(self, max_concurrent: int = 3):
        self._semaphore = asyncio.Semaphore(max_concurrent)

    async def execute(self, *, task_id: str, steps: list[WorkflowStep]) -> dict[str, Any]:
        """Execute workflow steps in order with optional per-step parallelism."""
        context: dict[str, Any] = {}
        step_results: dict[str, Any] = {}

        for step in steps:
            if not self._check_dependencies(step, context):
                return {
                    "success": False,
                    "error": f"Dependencies not met for step {step.id}",
                    "context": context,
                    "steps": step_results,
                }

            step_input = self._prepare_input(step, context)
            if step.parallel:
                results = await self._execute_parallel(task_id=task_id, agents=step.agents, input_data=step_input)
            else:
                results = await self._execute_serial(task_id=task_id, agents=step.agents, input_data=step_input)

            if step.completion_criteria and not self._check_completion(step.completion_criteria, results):
                return {
                    "success": False,
                    "error": f"Completion criteria not met for step {step.id}",
                    "context": context,
                    "steps": step_results,
                }

            step_results[step.id] = {
                "name": step.name,
                "parallel": step.parallel,
                "results": results,
            }
            context[step.id] = results

        return {"success": True, "context": context, "steps": step_results}

    async def _execute_parallel(
        self,
        *,
        task_id: str,
        agents: list[AgentStep],
        input_data: dict[str, Any],
    ) -> list[dict[str, Any]]:
        coroutines = [self._execute_agent(task_id=task_id, agent_step=agent, input_data=input_data) for agent in agents]
        return await asyncio.gather(*coroutines)

    async def _execute_serial(
        self,
        *,
        task_id: str,
        agents: list[AgentStep],
        input_data: dict[str, Any],
    ) -> list[dict[str, Any]]:
        results: list[dict[str, Any]] = []
        for agent in agents:
            result = await self._execute_agent(task_id=task_id, agent_step=agent, input_data=input_data)
            results.append(result)
        return results

    async def _execute_agent(
        self,
        *,
        task_id: str,
        agent_step: AgentStep,
        input_data: dict[str, Any],
    ) -> dict[str, Any]:
        async with self._semaphore:
            max_attempts = 1 + (agent_step.max_retries if agent_step.retry_on_failure else 0)
            last_error: Exception | None = None

            for attempt in range(max_attempts):
                try:
                    result = await asyncio.wait_for(
                        asyncio.to_thread(
                            self._run_agent_sync,
                            task_id,
                            agent_step,
                            input_data,
                        ),
                        timeout=agent_step.timeout_seconds,
                    )
                    result["attempt"] = attempt + 1
                    return result
                except Exception as exc:  # noqa: PERF203
                    last_error = exc

            return {
                "agent": agent_step.agent_name,
                "skill": agent_step.skill,
                "output": "",
                "error": str(last_error) if last_error else "unknown error",
                "artifacts": [],
                "attempt": max_attempts,
            }

    def _run_agent_sync(
        self,
        task_id: str,
        agent_step: AgentStep,
        input_data: dict[str, Any],
    ) -> dict[str, Any]:
        prompt = self._inject_context(agent_step, input_data)
        run_thread_id = f"scheduler-{task_id}-{uuid.uuid4().hex[:8]}"

        client = NionClient(
            model_name=(agent_step.agent_config or {}).get("model_name"),
            thinking_enabled=bool((agent_step.agent_config or {}).get("thinking_enabled", True)),
            subagent_enabled=bool((agent_step.agent_config or {}).get("subagent_enabled", False)),
            plan_mode=bool((agent_step.agent_config or {}).get("plan_mode", False)),
        )
        output = client.chat(prompt, thread_id=run_thread_id)

        return {
            "agent": agent_step.agent_name,
            "skill": agent_step.skill,
            "output": output,
            "error": None,
            "artifacts": [],
        }

    def _inject_context(self, agent_step: AgentStep, context: dict[str, Any]) -> str:
        """Build final prompt with execution hints and previous outputs."""
        segments: list[str] = [agent_step.prompt.strip()]

        if agent_step.skill:
            segments.append(f"[Execution Hint] Prefer using skill: {agent_step.skill}")
        if agent_step.tools:
            segments.append(f"[Execution Hint] Limit tools to: {', '.join(agent_step.tools)}")
        if agent_step.mcp_servers:
            segments.append(f"[Execution Hint] Prefer MCP servers: {', '.join(agent_step.mcp_servers)}")
        if agent_step.context_refs:
            segments.append(f"[Execution Hint] Context references: {', '.join(agent_step.context_refs)}")
        if context:
            segments.append("[Workflow Context]\n" + json.dumps(context, ensure_ascii=False, default=str))

        return "\n\n".join(s for s in segments if s)

    def _check_dependencies(self, step: WorkflowStep, context: dict[str, Any]) -> bool:
        return all(dep in context for dep in step.depends_on)

    def _prepare_input(self, step: WorkflowStep, context: dict[str, Any]) -> dict[str, Any]:
        if not step.depends_on:
            return {}
        return {dep: context[dep] for dep in step.depends_on if dep in context}

    def _check_completion(self, completion: CompletionCriteria, results: list[dict[str, Any]]) -> bool:
        if completion.type == CompletionCriteriaType.NO_ERROR:
            return all(not item.get("error") for item in results)

        outputs = "\n".join(str(item.get("output", "")) for item in results)
        if completion.type == CompletionCriteriaType.OUTPUT_CONTAINS:
            return (completion.pattern or "") in outputs
        if completion.type == CompletionCriteriaType.OUTPUT_MATCHES:
            return bool(re.search(completion.pattern or "", outputs))
        return True
