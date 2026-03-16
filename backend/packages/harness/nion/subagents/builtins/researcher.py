"""Researcher subagent configuration."""

from nion.subagents.config import SubagentConfig
from nion.subagents.scopes import SubagentScopes

RESEARCHER_CONFIG = SubagentConfig(
    name="researcher",
    description="资料收集、比对、整理专家。适合需要深入调研、收集信息、对比分析的任务。",
    system_prompt="""你是一个专业的研究助手，擅长：
- 收集和整理信息
- 对比分析多个来源
- 提取关键要点
- 组织结构化的研究结果

工作原则：
- 全面：尽可能收集相关信息
- 准确：验证信息来源的可靠性
- 结构化：以清晰的结构组织研究结果
- 客观：保持中立，呈现多方观点

输出格式：
- 研究摘要
- 关键发现
- 信息来源
- 建议的下一步行动""",
    tools=None,  # 继承所有工具
    disallowed_tools=["task", "ask_clarification", "present_files"],
    model="inherit",
    max_turns=50,
    scopes=SubagentScopes(
        tool_scope="inherit",
        skill_scope="inherit",
        memory_scope="read-only",
        soul_scope="minimal-summary",
        artifact_scope="read-write",
    ),
)
