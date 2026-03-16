"""Workflow execution engine for scheduled tasks."""

from __future__ import annotations

import asyncio
import json
import re
from typing import Any

from nion.client import NionClient
from nion.scheduler.models import AgentStep, CompletionCriteria, CompletionCriteriaType, WorkflowStep


class WorkflowExecutor:
    """Execute multi-step agent workflows."""

    async def execute(
        self,
        *,
        task_id: str,
        steps: list[WorkflowStep],
        max_concurrent: int = 3,
        trace_id: str,
        thread_id: str,
    ) -> dict[str, Any]:
        """Execute workflow steps in order with optional per-step parallelism."""
        semaphore = asyncio.Semaphore(max(1, int(max_concurrent)))
        context: dict[str, Any] = {}
        step_results: dict[str, Any] = {}
        artifacts: list[str] = []
        artifact_groups: list[Any] = []

        for step in steps:
            if not self._check_dependencies(step, context):
                return {
                    "success": False,
                    "error": f"Dependencies not met for step {step.id}",
                    "trace_id": trace_id,
                    "thread_id": thread_id,
                    "context": context,
                    "steps": step_results,
                }

            step_input = self._prepare_input(step, context)
            if step.parallel:
                results = await self._execute_parallel(
                    task_id=task_id,
                    agents=step.agents,
                    input_data=step_input,
                    semaphore=semaphore,
                    trace_id=trace_id,
                    thread_id=thread_id,
                )
            else:
                results = await self._execute_serial(
                    task_id=task_id,
                    agents=step.agents,
                    input_data=step_input,
                    semaphore=semaphore,
                    trace_id=trace_id,
                    thread_id=thread_id,
                )

            if step.completion_criteria and not self._check_completion(step.completion_criteria, results):
                return {
                    "success": False,
                    "error": f"Completion criteria not met for step {step.id}",
                    "trace_id": trace_id,
                    "thread_id": thread_id,
                    "context": context,
                    "steps": step_results,
                }

            step_results[step.id] = {
                "name": step.name,
                "parallel": step.parallel,
                "results": results,
            }
            context[step.id] = results
            artifacts = self._merge_artifacts(artifacts, self._extract_artifacts(results))
            artifact_groups = self._merge_artifact_groups(artifact_groups, self._extract_artifact_groups(results))

        return {
            "success": True,
            "trace_id": trace_id,
            "thread_id": thread_id,
            "artifacts": artifacts,
            "artifact_groups": artifact_groups,
            "context": context,
            "steps": step_results,
        }

    async def _execute_parallel(
        self,
        *,
        task_id: str,
        agents: list[AgentStep],
        input_data: dict[str, Any],
        semaphore: asyncio.Semaphore,
        trace_id: str,
        thread_id: str,
    ) -> list[dict[str, Any]]:
        coroutines = [
            self._execute_agent(
                task_id=task_id,
                agent_step=agent,
                input_data=input_data,
                semaphore=semaphore,
                trace_id=trace_id,
                thread_id=thread_id,
            )
            for agent in agents
        ]
        return await asyncio.gather(*coroutines)

    async def _execute_serial(
        self,
        *,
        task_id: str,
        agents: list[AgentStep],
        input_data: dict[str, Any],
        semaphore: asyncio.Semaphore,
        trace_id: str,
        thread_id: str,
    ) -> list[dict[str, Any]]:
        results: list[dict[str, Any]] = []
        for agent in agents:
            result = await self._execute_agent(
                task_id=task_id,
                agent_step=agent,
                input_data=input_data,
                semaphore=semaphore,
                trace_id=trace_id,
                thread_id=thread_id,
            )
            results.append(result)
        return results

    async def _execute_agent(
        self,
        *,
        task_id: str,
        agent_step: AgentStep,
        input_data: dict[str, Any],
        semaphore: asyncio.Semaphore,
        trace_id: str,
        thread_id: str,
    ) -> dict[str, Any]:
        async with semaphore:
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
                            trace_id,
                            thread_id,
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
                "artifact_groups": [],
                "attempt": max_attempts,
            }

    def _run_agent_sync(
        self,
        task_id: str,
        agent_step: AgentStep,
        input_data: dict[str, Any],
        trace_id: str,
        thread_id: str,
    ) -> dict[str, Any]:
        prompt = self._inject_context(agent_step, input_data)

        agent_config = agent_step.agent_config or {}
        client = NionClient(
            model_name=agent_config.get("model_name"),
            thinking_enabled=bool(agent_config.get("thinking_enabled", True)),
            subagent_enabled=bool(agent_config.get("subagent_enabled", False)),
            plan_mode=bool(agent_config.get("plan_mode", False)),
            session_mode=agent_config.get("session_mode"),
            memory_read=agent_config.get("memory_read"),
            memory_write=agent_config.get("memory_write"),
        )
        # Ensure the agent executes under the correct persona/memory/tools policy.
        last_text = ""
        artifacts: list[str] = []
        artifact_groups: list[Any] = []
        for event in client.stream(
            prompt,
            thread_id=thread_id,
            agent_name=agent_step.agent_name,
            trace_id=trace_id,
        ):
            if event.type == "messages-tuple" and event.data.get("type") == "ai":
                content = event.data.get("content")
                if isinstance(content, str) and content:
                    last_text = content
            if event.type == "values":
                raw_artifacts = event.data.get("artifacts")
                if isinstance(raw_artifacts, list):
                    artifacts = [item for item in raw_artifacts if isinstance(item, str)]
                raw_groups = event.data.get("artifact_groups")
                if isinstance(raw_groups, list):
                    artifact_groups = raw_groups

        return {
            "agent": agent_step.agent_name,
            "skill": agent_step.skill,
            "output": last_text,
            "error": None,
            "artifacts": artifacts,
            "artifact_groups": artifact_groups,
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

    @staticmethod
    def _merge_artifacts(existing: list[str], new: list[str]) -> list[str]:
        if not new:
            return existing
        if not existing:
            return list(dict.fromkeys(new))
        return list(dict.fromkeys(existing + new))

    @staticmethod
    def _merge_artifact_groups(existing: list[Any], new: list[Any]) -> list[Any]:
        if not new:
            return existing
        if not existing:
            return new
        index: dict[str, Any] = {}
        ordered: list[Any] = []
        for group in existing + new:
            if isinstance(group, dict):
                group_id = group.get("id")
                if isinstance(group_id, str) and group_id:
                    if group_id not in index:
                        ordered.append(group)
                    index[group_id] = group
                    continue
            ordered.append(group)
        # Ensure last-write-wins for groups with same id while preserving first appearance order.
        normalized: list[Any] = []
        for group in ordered:
            if isinstance(group, dict):
                group_id = group.get("id")
                if isinstance(group_id, str) and group_id in index:
                    normalized.append(index.pop(group_id))
                    continue
            normalized.append(group)
        return normalized

    @staticmethod
    def _extract_artifacts(results: list[dict[str, Any]]) -> list[str]:
        merged: list[str] = []
        for item in results:
            raw = item.get("artifacts")
            if isinstance(raw, list):
                merged = list(dict.fromkeys(merged + [v for v in raw if isinstance(v, str)]))
        return merged

    @staticmethod
    def _extract_artifact_groups(results: list[dict[str, Any]]) -> list[Any]:
        merged: list[Any] = []
        for item in results:
            raw = item.get("artifact_groups")
            if isinstance(raw, list):
                merged = raw
        return merged
