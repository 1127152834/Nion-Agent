"""Evolution analyzer."""

from app.evolution.models import EvolutionSuggestion, SuggestionPriority, SuggestionType


class EvolutionAnalyzer:
    """Evolution analyzer."""

    async def analyze(self, report_id: str, agent_name: str = "_default") -> list[EvolutionSuggestion]:
        """Analyze and generate suggestions."""
        suggestions: list[EvolutionSuggestion] = []

        # Analyze Memory
        memory_suggestions = await self._analyze_memory(report_id, agent_name)
        suggestions.extend(memory_suggestions)

        # Analyze Soul
        soul_suggestions = await self._analyze_soul(report_id, agent_name)
        suggestions.extend(soul_suggestions)

        # Analyze Agent
        agent_suggestions = await self._analyze_agent(report_id, agent_name)
        suggestions.extend(agent_suggestions)

        return suggestions

    async def _analyze_memory(self, report_id: str, agent_name: str) -> list[EvolutionSuggestion]:
        """Analyze Memory and generate suggestions."""
        from nion.agents.memory.maintenance import get_usage_stats
        from nion.agents.memory.registry import get_memory_registry

        suggestions: list[EvolutionSuggestion] = []

        try:
            registry = get_memory_registry()
            provider = registry.get_default()
            scope = "global" if agent_name == "_default" else "agent"
            scope_agent_name = None if scope == "global" else agent_name
            usage = get_usage_stats(provider._runtime, scope=scope, agent_name=scope_agent_name)

            entry_count = int(usage.get("active_entries", 0))
            if entry_count > 200:
                suggestions.append(
                    EvolutionSuggestion(
                        report_id=report_id,
                        type=SuggestionType.MEMORY,
                        target_domain="memory",
                        content=f"建议压缩长期记忆，当前有 {entry_count} 条 active 记录",
                        evidence_summary="基于 Memory usage 统计",
                        impact_scope="影响范围：记忆检索性能",
                        confidence=0.85,
                        priority=SuggestionPriority.MEDIUM,
                    )
                )
        except Exception:
            pass

        return suggestions

    async def _analyze_soul(self, report_id: str, agent_name: str) -> list[EvolutionSuggestion]:
        """Analyze Soul and generate suggestions."""
        from nion.agents.soul.resolver import SoulResolver

        suggestions: list[EvolutionSuggestion] = []

        try:
            resolver = SoulResolver()
            resolved = None if agent_name == "_default" else agent_name
            soul_asset = resolver.load_soul(agent_name=resolved)
            identity_asset = resolver.load_identity(agent_name=resolved)

            if not soul_asset:
                suggestions.append(
                    EvolutionSuggestion(
                        report_id=report_id,
                        type=SuggestionType.SOUL,
                        target_domain="soul",
                        content="建议创建 SOUL.md 文件，定义助手个性",
                        evidence_summary="基于 Soul 资产检查",
                        impact_scope="影响范围：助手身份一致性",
                        confidence=0.90,
                        priority=SuggestionPriority.HIGH,
                    )
                )

            if not identity_asset:
                suggestions.append(
                    EvolutionSuggestion(
                        report_id=report_id,
                        type=SuggestionType.SOUL,
                        target_domain="soul",
                        content="建议创建 IDENTITY.md 文件，定义助手身份",
                        evidence_summary="基于 Soul 资产检查",
                        impact_scope="影响范围：助手角色定位",
                        confidence=0.90,
                        priority=SuggestionPriority.HIGH,
                    )
                )
        except Exception:
            pass

        return suggestions

    async def _analyze_agent(self, report_id: str, agent_name: str) -> list[EvolutionSuggestion]:
        """Analyze Agent and generate suggestions."""
        from app.heartbeat.service import get_heartbeat_service

        suggestions: list[EvolutionSuggestion] = []

        try:
            heartbeat_service = get_heartbeat_service()
            logs = heartbeat_service.get_logs(agent_name, limit=20)

            failed_count = sum(1 for log in logs if log.status == "failed")
            if failed_count > 5:
                suggestions.append(
                    EvolutionSuggestion(
                        report_id=report_id,
                        type=SuggestionType.AGENT,
                        target_domain="agent",
                        content=f"建议检查任务失败原因，最近 20 次中有 {failed_count} 次失败",
                        evidence_summary="基于 Heartbeat 日志分析",
                        impact_scope="影响范围：任务执行稳定性",
                        confidence=0.75,
                        priority=SuggestionPriority.MEDIUM,
                    )
                )
        except Exception:
            pass

        return suggestions
