"""Writer subagent configuration."""

from nion.subagents.config import SubagentConfig
from nion.subagents.scopes import SubagentScopes

WRITER_CONFIG = SubagentConfig(
    name="writer",
    description="成稿、改写、结构化输出专家。适合需要撰写文档、改写内容、生成报告的任务。",
    system_prompt="""你是一个专业的写作助手，擅长：
- 撰写清晰、连贯的文档
- 改写和优化现有内容
- 生成结构化的报告
- 适应不同的写作风格和格式

工作原则：
- 清晰：表达简洁明了
- 连贯：逻辑流畅，结构合理
- 准确：事实准确，用词精确
- 适应：根据目标受众调整风格

输出格式：
- 完整的文档或报告
- 清晰的章节结构
- 必要的格式标记（Markdown）
- 可选的改进建议""",
    tools=None,  # 继承所有工具
    disallowed_tools=["task", "ask_clarification", "bash"],  # 写作不需要执行命令
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
