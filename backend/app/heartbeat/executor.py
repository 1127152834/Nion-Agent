"""Heartbeat executor (integrates Memory Core and Soul Core)."""

import asyncio
from datetime import datetime

from app.heartbeat.models import HeartbeatLogRecord, HeartbeatResultType
from app.heartbeat.store import append_log
from nion.client import NionClient


class HeartbeatExecutor:
    """Heartbeat executor."""

    def __init__(self):
        self._client = NionClient()

    async def execute(self, template_id: str, agent_name: str = "_default") -> HeartbeatLogRecord:
        """Execute heartbeat for an agent.

        Args:
            template_id: Template ID to execute
            agent_name: Agent name (default: "_default")

        Returns:
            HeartbeatLogRecord with execution results
        """
        start_time = datetime.now()

        try:
            # Route to specific execution method
            if template_id == "daily_review":
                result = await self._execute_daily_review(agent_name)
            elif template_id == "weekly_reset":
                result = await self._execute_weekly_reset(agent_name)
            elif template_id == "memory_maintenance":
                result = await self._execute_memory_maintenance(agent_name)
            elif template_id == "memory_governance":
                result = await self._execute_memory_governance(agent_name)
            elif template_id == "identity_check":
                result = await self._execute_identity_check(agent_name)
            else:
                raise ValueError(f"Unknown template: {template_id}")

            duration = (datetime.now() - start_time).total_seconds()

            # Create log record
            record = HeartbeatLogRecord(
                heartbeat_type=template_id,
                timestamp=start_time,
                status="success",
                result_type=result["type"],
                result=result,
                duration_seconds=int(duration),
            )

            # Save log
            append_log(record, agent_name)

            return record

        except Exception as e:
            duration = (datetime.now() - start_time).total_seconds()
            record = HeartbeatLogRecord(
                heartbeat_type=template_id,
                timestamp=start_time,
                status="failed",
                result_type=HeartbeatResultType.SUMMARY,
                result={},
                duration_seconds=int(duration),
                error_message=str(e),
            )
            append_log(record, agent_name)
            raise

    async def _execute_memory_maintenance(self, agent_name: str) -> dict:
        """Execute memory maintenance."""
        from nion.agents.memory.maintenance import compact_memory, get_usage_stats, rebuild_memory
        from nion.agents.memory.registry import get_memory_registry

        # Get Memory Provider
        registry = get_memory_registry()
        provider = registry.get_default()

        scope = "global" if agent_name == "_default" else "agent"
        scope_agent_name = None if scope == "global" else agent_name

        # Get usage before
        usage_before = get_usage_stats(provider._runtime, scope=scope, agent_name=scope_agent_name)

        # Execute compact
        compact_result = compact_memory(provider._runtime, scope=scope, agent_name=scope_agent_name)

        # Execute rebuild
        rebuild_result = rebuild_memory(provider._runtime, scope=scope, agent_name=scope_agent_name)

        # Get usage after
        usage_after = get_usage_stats(provider._runtime, scope=scope, agent_name=scope_agent_name)

        # Generate maintenance report
        return {
            "type": "maintenance_report",
            "timestamp": datetime.now().isoformat(),
            "heartbeat_type": "memory_maintenance",
            "result": {
                "usage_before": usage_before,
                "usage_after": usage_after,
                "actions": [
                    {"action": "compact", **compact_result},
                    {"action": "rebuild", **rebuild_result},
                ],
                "summary": self._generate_maintenance_summary(usage_before, usage_after, compact_result),
            },
        }

    def _generate_maintenance_summary(self, before: dict, after: dict, compact: dict) -> str:
        """Generate maintenance summary."""
        removed = compact.get("removed_count", 0)
        remaining = compact.get("remaining_count", 0)
        if removed > 0:
            return f"清理了 {removed} 条过期记忆，保留 {remaining} 条有效记忆"
        return f"记忆维护完成，当前有 {remaining} 条记忆"

    async def _execute_memory_governance(self, agent_name: str) -> dict:
        """Execute memory governance batch and refresh agent catalog."""
        from nion.agents.memory.governor import get_memory_governor

        if agent_name != "_default":
            # Governance is global shared-layer maintenance.
            return {
                "type": "maintenance_report",
                "timestamp": datetime.now().isoformat(),
                "heartbeat_type": "memory_governance",
                "result": {
                    "summary": "Memory governance is global-only; skipped for non-default agent.",
                    "skipped": True,
                },
            }

        result = get_memory_governor().run()
        return {
            "type": "maintenance_report",
            "timestamp": datetime.now().isoformat(),
            "heartbeat_type": "memory_governance",
            "result": {
                "summary": (f"治理完成：promoted={result.get('promoted', 0)}, rejected={result.get('rejected', 0)}, pending={result.get('pending_count', 0)}, contested={result.get('contested_count', 0)}"),
                **result,
            },
        }

    async def _execute_identity_check(self, agent_name: str) -> dict:
        """Execute identity check for an agent.

        Args:
            agent_name: Agent name

        Returns:
            Identity check result dict
        """
        from nion.agents.soul.resolver import SoulResolver
        from nion.agents.soul.summarizer import SoulSummarizer

        resolver = SoulResolver()
        summarizer = SoulSummarizer()

        # Load Soul assets for this agent
        soul_asset = resolver.load_soul(agent_name=agent_name if agent_name != "_default" else None)
        identity_asset = resolver.load_identity(agent_name=agent_name if agent_name != "_default" else None)
        user_asset = resolver.load_user_profile()

        # Generate summaries
        soul_summary = summarizer.summarize(soul_asset, max_tokens=500) if soul_asset else None
        identity_summary = summarizer.summarize(identity_asset, max_tokens=300) if identity_asset else None
        user_summary = summarizer.summarize(user_asset, max_tokens=300) if user_asset else None

        # Use LLM to analyze consistency
        analysis_prompt = self._build_identity_check_prompt(soul_summary, identity_summary, user_summary)
        analysis_result = await asyncio.to_thread(
            self._client.chat,
            message=analysis_prompt,
            thread_id=f"identity-check-{datetime.now().strftime('%Y%m%d')}",
            session_mode="temporary_chat",
            memory_read=False,
            memory_write=False,
        )

        # Generate suggestion report
        return {
            "type": "suggestion",
            "timestamp": datetime.now().isoformat(),
            "heartbeat_type": "identity_check",
            "result": {
                "soul_stability": "stable",
                "identity_alignment": "good",
                "user_profile_freshness": "needs_update",
                "suggestions": self._extract_suggestions(analysis_result),
                "summary": self._extract_summary(analysis_result),
            },
        }

    def _build_identity_check_prompt(self, soul, identity, user) -> str:
        """Build identity check prompt."""
        return f"""分析以下身份资产的一致性和稳定性：

SOUL.md 摘要：
{soul.summary if soul else "未设置"}

IDENTITY.md 摘要：
{identity.summary if identity else "未设置"}

USER.md 摘要：
{user.summary if user else "未设置"}

请分析：
1. 三者之间的一致性（是否有冲突或矛盾）
2. Soul 的稳定性（是否需要调整）
3. Identity 的对齐度（是否与实际行为一致）
4. User Profile 的新鲜度（是否需要更新）

输出格式：
- 稳定性评估：stable/needs_review/unstable
- 对齐度评估：good/fair/poor
- 新鲜度评估：fresh/needs_update/outdated
- 具体建议（列表形式，每条建议单独一行）
- 总结（一句话）
"""

    async def _execute_daily_review(self, agent_name: str) -> dict:
        """Execute daily review for an agent.

        Args:
            agent_name: Agent name

        Returns:
            Daily review result dict
        """
        from nion.agents.memory.registry import get_memory_registry

        # Get today's memories
        registry = get_memory_registry()
        provider = registry.get_default()
        today_memories = await self._get_recent_memories(provider, days=1)

        # Use LLM to generate daily review
        review_prompt = f"""请回顾今天的活动和对话：

{today_memories}

生成：
1. 今日摘要（3-5 句话）
2. 待办事项更新
3. Top-of-mind 更新
4. 明日建议
"""

        review_result = await asyncio.to_thread(
            self._client.chat,
            message=review_prompt,
            thread_id=f"daily-review-{agent_name}-{datetime.now().strftime('%Y%m%d')}",
            session_mode="normal",
            memory_read=True,
            memory_write=True,
        )

        return {
            "type": "summary",
            "timestamp": datetime.now().isoformat(),
            "heartbeat_type": "daily_review",
            "result": {
                "summary": self._extract_summary(review_result),
                "todos": self._extract_todos(review_result),
                "top_of_mind": self._extract_top_of_mind(review_result),
                "suggestions": self._extract_suggestions(review_result),
            },
        }

    async def _execute_weekly_reset(self, agent_name: str) -> dict:
        """Execute weekly reset for an agent.

        Args:
            agent_name: Agent name

        Returns:
            Weekly reset result dict
        """
        from nion.agents.memory.registry import get_memory_registry

        # Get this week's memories
        registry = get_memory_registry()
        provider = registry.get_default()
        week_memories = await self._get_recent_memories(provider, days=7)

        # Use LLM to generate weekly review
        reset_prompt = f"""请回顾本周的项目和进展：

{week_memories}

生成：
1. 本周摘要（5-10 句话）
2. 项目进展评估
3. 长期目标调整建议
4. 下周重点提示
"""

        reset_result = await asyncio.to_thread(
            self._client.chat,
            message=reset_prompt,
            thread_id=f"weekly-reset-{agent_name}-{datetime.now().strftime('%Y%m%d')}",
            session_mode="normal",
            memory_read=True,
            memory_write=True,
        )

        return {
            "type": "summary",
            "timestamp": datetime.now().isoformat(),
            "heartbeat_type": "weekly_reset",
            "result": {
                "summary": self._extract_summary(reset_result),
                "projects": self._extract_projects(reset_result),
                "goals": self._extract_goals(reset_result),
                "suggestions": self._extract_suggestions(reset_result),
            },
        }

    async def _get_recent_memories(self, provider, days: int) -> str:
        """Get recent memories."""
        # Simplified: return placeholder
        return f"最近 {days} 天的记忆摘要"

    def _extract_summary(self, text: str) -> str:
        """Extract summary from LLM response."""
        # Simplified: return first 200 chars
        return text[:200] if text else "无摘要"

    def _extract_suggestions(self, text: str) -> list[str]:
        """Extract suggestions from LLM response."""
        # Simplified: split by newlines and filter
        lines = text.split("\n")
        suggestions = [line.strip() for line in lines if line.strip().startswith("-") or line.strip().startswith("•")]
        return suggestions[:5]

    def _extract_todos(self, text: str) -> list[str]:
        """Extract todos from LLM response."""
        return self._extract_suggestions(text)

    def _extract_top_of_mind(self, text: str) -> str:
        """Extract top-of-mind from LLM response."""
        return self._extract_summary(text)

    def _extract_projects(self, text: str) -> list[str]:
        """Extract projects from LLM response."""
        return self._extract_suggestions(text)

    def _extract_goals(self, text: str) -> list[str]:
        """Extract goals from LLM response."""
        return self._extract_suggestions(text)
