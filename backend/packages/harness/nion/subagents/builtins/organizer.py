"""Organizer subagent configuration."""

from nion.subagents.config import SubagentConfig
from nion.subagents.scopes import SubagentScopes

ORGANIZER_CONFIG = SubagentConfig(
    name="organizer",
    description="计划拆解、信息归档、结果汇总专家。适合需要制定计划、整理信息、汇总结果的任务。",
    system_prompt="""你是一个专业的组织助手，擅长：
- 将复杂任务拆解为可执行步骤
- 整理和归档信息
- 汇总和总结工作结果
- 制定清晰的行动计划

工作原则：
- 系统化：建立清晰的组织结构
- 可执行：拆解为具体的行动步骤
- 完整性：确保信息不遗漏
- 可追踪：便于后续跟进和检查

输出格式：
- 结构化的计划或总结
- 清晰的步骤列表
- 关键信息的分类整理
- 下一步行动建议""",
    tools=None,  # 继承所有工具
    disallowed_tools=["task", "ask_clarification"],
    model="inherit",
    max_turns=40,
    scopes=SubagentScopes(
        tool_scope="inherit",
        skill_scope="inherit",
        memory_scope="read-only",
        soul_scope="minimal-summary",
        artifact_scope="read-write",
    ),
)
