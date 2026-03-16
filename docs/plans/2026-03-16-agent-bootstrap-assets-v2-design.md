# Agent Bootstrap Assets V2 Design

> 目标日期：2026-03-16

## 背景与问题

当前“新建智能体”会通过 bootstrap 对话生成并落盘资产，但实际落地效果存在三个核心问题：

1. **SOUL.md 职责混乱**：把“角色/职责/交付物/工作流”等内容一起塞进 SOUL.md，导致 SOUL 不再是“人格资产”，而变成一份混合说明书，注入后容易造成行为漂移。
2. **IDENTITY.md 未初始化**：当模型没有显式传 `identity` 时，后端工具会写入默认英文模板，导致身份文件与该智能体的真实定位无关。
3. **Memory（OpenViking）未初始化**：创建对话中用户提供的稳定上下文没有被系统化沉淀为 agent-scope 的长期记忆，导致“记忆”页为空或只出现零散自动抽取条目。

根因上，当前 bootstrap 的对话问题域与资产边界不一致：问答内容没有被强约束拆分为 **Soul / Identity / Memory** 三类产物，最终导致“一个文档承载一切”。

## 设计目标（V2）

把创建/引导流程收敛为“三资产生成器”：

- **SOUL.md（人格资产）**：只描述该智能体的气质、价值观、世界观、习惯、表达风格、关系边界。禁止包含任务清单、交付物形态、工具列表等“工作职责”内容。
- **IDENTITY.md（角色资产）**：描述该智能体的角色定位、职责范围、交付物形态、边界与禁区、质量标准、澄清策略与协作方式。禁止包含“人格癖好/世界观”类内容（这些应归入 SOUL）。
- **Memory（长期记忆）**：从对话中提取“稳定且对该 agent 有用的上下文”，以 OpenViking 记忆条目写入（agent-scope），并按 tier 分类：
  - `profile`：该 agent 的长期上下文（例如：你在做什么类型的项目/训练营/工作流）
  - `preference`：该 agent 的协作偏好（例如：输出格式、推回力度、默认语言）

同时提升可靠性：

- **强制加载 bootstrap skill**：在前端首条消息中加入 `implicitMentions`（requested_skills=bootstrap），让系统 prompt 的硬规则生效，模型必须先读 SKILL.md 再开始生成，降低“按旧模板胡写”的概率。
- **后端工具强约束**：`setup_agent` 在 bootstrap 用途中应要求 `identity` 非空（否则报错），避免落盘默认英文模板。
- **一键落盘 + 可选记忆初始化**：`setup_agent` 增加可选 `memory_items`，由工具侧负责写入 OpenViking（避免模型忘记额外调用 memory_store）。

## 对话工作流（V2）

对话分 3 轮（必要时 4 轮确认）：

1. **Identity Round（角色与交付物）**
   - 这个智能体主要做什么，不做什么？
   - 典型输入输出是什么？
   - 质量标准与澄清策略（信息不足时必须问什么）

2. **Soul Round（人格与世界观）**
   - 气质/价值观/世界观（做决策时更看重什么）
   - 习惯与表达风格（偏简洁/偏严谨；是否喜欢用清单；对不确定性的态度）
   - 关系边界（更像导师/搭档/审稿人；对用户的 pushback 强度属于人格习惯的一部分）

3. **Memory Round（长期上下文与偏好沉淀）**
   - 这类智能体需要长期记住哪些信息才会更好用？（项目背景、术语、约束、常用工具、固定流程）
   - 哪些偏好是“只对这个智能体有效”的？（输出结构、风格、节奏）
   - 产出为 3–8 条可写入 memory 的短句（每条 1 个事实/偏好）

4. **Draft + Confirm**
   - 输出：SOUL.md、IDENTITY.md、memory_items（带 tier）、description（一句话）
   - 用户确认后执行落盘（setup_agent 一次完成）

## 后端工具契约（setup_agent V2）

新增可选参数：

- `memory_items: list[dict] | None`
  - 每项至少包含 `content: str`
  - 可选：`tier: "profile"|"preference"|"episode"`、`confidence: float`
  - 工具侧将其写入 OpenViking，scope 规则：
    - custom agent：写入 `agent:{agent_name}`
    - default agent：写入 `global`（因为默认助手的记忆页展示 global）

强化约束：

- `identity` 必须非空（custom/default 都要求），否则返回 ToolMessage 错误且不写盘。

返回结构（便于前端/UI 判断成功与展示）：

- `created_agent_name` / `updated_agent_name`
- `memory_results`（可选，列表）

## 需要改动的代码点（概览）

- 后端：`backend/src/tools/builtins/setup_agent_tool.py`
  - 增加 `memory_items` 支持 + identity 非空校验
  - 增加单测：覆盖 memory_items 写入逻辑（用 patch stub，避免真实 OpenViking I/O）

- Skill：`skills/public/bootstrap/*`
  - 重写 SOUL/IDENTITY 模板边界定义，新增 Memory 的提取与落盘规则
  - 更新对话引导：按 Identity/Soul/Memory 三轮抽取

- 前端：
  - `frontend/src/app/workspace/agents/new/page.tsx`
    - 首条消息增加 `implicitMentions` 请求 bootstrap skill（提升一致性）
  - `frontend/src/app/workspace/agents/bootstrap/page.tsx`
    - 同样增加 `implicitMentions`（默认助手引导也需要稳定）
  - i18n 文案更新：明确会初始化 SOUL/IDENTITY/Memory（并可选更新 USER.md）

## 测试与验收

后端（pytest）：
- `setup_agent` 在 custom/default 模式下 identity 为空应报错且不写盘
- `setup_agent` 传入 memory_items 时应调用 store_memory_action（patch）并回传 memory_results

前端（tsc + 手动流程）：
- 新建智能体：首条消息携带 skill implicit mention，生成后 SOUL/IDENTITY 均有内容且边界正确；记忆页应有 profile/preference 条目
- 默认助手引导：同理，SOUL/IDENTITY 更新；global 记忆可见 seed 条目（如用户提供）

