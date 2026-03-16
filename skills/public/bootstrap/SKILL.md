---
name: bootstrap
description: '{"en":"Nion bootstrap onboarding. Through a short multi-round chat, generate SOUL.md + IDENTITY.md and optional OpenViking memory seeds (+ optional USER.md) aligned with Soul Core. Supports creating a custom agent (agent_name provided) or updating the default agent (_default).","zh-CN":"Nion 入门引导（bootstrap）：通过简短多轮对话生成 SOUL.md + IDENTITY.md，并可选初始化 OpenViking Memory seed（profile/preference），也可同步全局 USER.md（用户画像），对齐 Soul Core。支持创建自定义智能体（有 agent_name）或更新默认助手（_default）。"}'
---

# Bootstrap（入门引导）

这是一个“资产引导生成器”技能：通过 3–6 轮对话，生成并落盘当前智能体所需的核心资产：
- `SOUL.md`：人格资产（气质、世界观、价值观、习惯、表达风格、关系边界；短、可注入）
- `IDENTITY.md`：角色资产（职责范围、边界禁区、交付物形态、质量标准、澄清策略；清晰可执行）
- OpenViking Memory（可选）：初始化 `memory_items`（`profile` / `preference`）
- `USER.md`（可选）：用户画像（全局资产，用 marker 块幂等更新，尽量不破坏用户手写内容）

## Architecture

```
bootstrap/
├── SKILL.md                               ← 你正在读：流程与规则
├── templates/SOUL.template.md             ← SOUL.md 输出模板
├── templates/IDENTITY.template.md         ← IDENTITY.md 输出模板
├── templates/MEMORY.template.md           ← OpenViking memory_items 输出模板
├── templates/USER.template.md             ← USER.md（用户画像）输出模板
└── references/conversation-guide.md       ← 对话分轮策略与提问指南
```

**在你的第一条回复前**，先读：
1. `references/conversation-guide.md`
2. `templates/SOUL.template.md`
3. `templates/IDENTITY.template.md`
4. `templates/MEMORY.template.md`
5. `templates/USER.template.md`

## Ground Rules

- **一轮一轮来。** 每轮 1–3 个问题，永远不要一次性抛完整问卷。
- **对话而非审讯。** 用用户的措辞复述与确认，必要时提出温和的 pushback。
- **资产语言跟随对话语言。** 不要强制英文；除非用户明确要求双语或指定语言。
- **不要暴露模板。** 用户在对话，不是在填表。
- **严格边界。** SOUL 只写人格资产；IDENTITY 只写角色资产；memory_items 只写稳定上下文/偏好。
- **不要用 bash 手动写文件。** 落盘必须通过 `setup_agent` 工具完成。

## 对话分轮（建议 3–6 轮）

对话默认按 4 轮推进；用户信息足够时可合并/跳过，但必须在落盘前完成“角色资产（IDENTITY）+ 人格资产（SOUL）+ 记忆 seed（memory_items）”三件事。

| Round | 目标 | 关键抽取 |
|------|------|----------|
| **1. Identity Round（角色与交付物）** | 明确这是“创建自定义智能体”还是“更新默认助手”；定义角色定位、职责范围、典型输入输出、质量标准与边界 | `target`、职责/任务、交付物形态、澄清策略、禁区 |
| **2. Soul Round（人格与世界观）** | 定义人格底色、价值观、习惯、表达风格、关系边界 | 气质/价值观/习惯/表达/姿态（禁止写职责） |
| **3. Memory Round（记忆 seed）** | 从对话中提取稳定上下文与协作偏好，产出 memory_items（profile/preference） | `memory_items` 列表（3–8 条短句） |
| **4. 用户画像（可选）** | 需要时把“全局通用”的用户信息归档到根目录 `USER.md` | 背景/偏好/禁区/长期目标（仅写稳定信息） |

细节与提问策略见 `references/conversation-guide.md`。

## 你必须最终产出的内容

在用户确认前，先生成并展示以下草稿：
- `SOUL.md`（按 `templates/SOUL.template.md`）
- `IDENTITY.md`（按 `templates/IDENTITY.template.md`）
- `memory_items`（按 `templates/MEMORY.template.md`；将写入 OpenViking Memory）
- `USER.md`（可选，按 `templates/USER.template.md`；如果用户不想写入，明确“将跳过 USER.md 更新”）
- `agent.json` 的 `description`（一句话，**仅自定义智能体创建时**需要写入；默认助手更新时会被忽略）

## Generation

当信息足够时：
1. 读取 3–4 份模板（SOUL/IDENTITY/MEMORY/USER），按模板结构生成草稿与 `memory_items`。
2. 把草稿展示给用户确认。展示时要明确：SOUL/IDENTITY 会落盘并在运行时被注入系统提示词；memory_items 会写入 OpenViking Memory（因此要短、稳定、可复用）。
3. 允许用户对草稿做 1–2 轮微调，直到用户明确确认。
4. 用户确认后，调用 `setup_agent` 落盘（必须调用工具，不要手写文件）：

### A. 创建自定义智能体（custom）
前置条件：`runtime.context.agent_name` 已由前端在首条 bootstrap 消息里传入。

```text
setup_agent(
  soul="<SOUL.md 完整内容>",
  identity="<IDENTITY.md 完整内容>",
  memory_items=[{"tier":"profile","content":"..."},{"tier":"preference","content":"..."}],
  description="<一句话 description（会写入 agent.json）>",
  user_profile="<USER.md 内容（可选）>",
  target="custom",
  user_profile_strategy="replace_generated_block",
)
```

### B. 更新默认助手（default）
说明：默认助手更新不会改写 `_default/agent.json` 的 description，但工具签名仍要求提供 `description` 参数，传任意占位即可。

```text
setup_agent(
  soul="<SOUL.md 完整内容>",
  identity="<IDENTITY.md 完整内容>",
  memory_items=[{"tier":"preference","content":"..."}],
  description="(ignored)",
  user_profile="<USER.md 内容（可选）>",
  target="default",
  user_profile_strategy="replace_generated_block",
)
```

**生成规则（必须遵守）：**
- **不强制英文。** 资产语言默认跟随对话语言；如果用户要求双语，明确双语策略并保持一致。
- **SOUL/IDENTITY 边界不可混写。** 人格写 SOUL；职责/交付物写 IDENTITY。
- **少即是多。** SOUL.md 要短（适合注入）；IDENTITY.md 要清晰可执行；memory_items 只记稳定信息。
- **工具失败不得宣称成功。** `setup_agent` 返回错误时，直接解释错误原因与下一步（例如更换 agent ID），不要假装已落盘。
