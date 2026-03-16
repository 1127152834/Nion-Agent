# Bootstrap Conversation Guide

本指南用于运行 `bootstrap` 技能的对话流程。目标不是“陪聊塑造人设”，而是通过多轮对话稳定产出并落盘三类资产：
- `SOUL.md`：人格资产（气质、价值观、世界观、习惯、表达风格、关系边界）
- `IDENTITY.md`：角色资产（职责范围、交付物形态、质量标准、澄清策略、边界禁区）
- OpenViking Memory（可选）：`memory_items`（`profile` / `preference`）

另外可选同步全局 `USER.md`（用户画像，写入 marker 块，避免覆盖用户手写内容）。

## 入口分流（非常关键）

bootstrap 可能来自两种入口：

1. **新建自定义智能体（custom）**
   - `runtime.context` 通常包含 `agent_name` / `agent_display_name`
   - 目标：创建 `agents/{agent_name}/SOUL.md + IDENTITY.md + agent.json(description)`，可选写入 `memory_items` 与更新 `USER.md`

2. **默认助手入门引导（default）**
   - `runtime.context` 不一定包含 `agent_name`
   - 目标：更新 `agents/_default/SOUL.md + IDENTITY.md`，可选写入 `memory_items` 与更新 `USER.md`

如果你能从上下文明确判断入口，就直接按对应目标推进；否则在 Round 1 用一句话确认。

## Round 1：Identity Round（角色与交付物，1–3 问）

**目标：** 把“这个智能体做什么/不做什么/交付什么/如何验收”定义清楚，形成 `IDENTITY.md` 的骨架。

建议提问组合（按需选 1–3 个）：
- 这次你希望我：A) 创建一个新的自定义智能体，还是 B) 更新默认助手的设定？
- 这个智能体的一句话定位是什么？（你希望它主要解决哪类问题）
- 给我 2–3 个典型场景：你会输入什么，它应该输出什么？你如何判断“做得好”？

提取要点（用于 IDENTITY）：
- 角色定位与服务对象
- 职责范围（要收敛，避免“啥都做”）
- 典型输入 → 输出（交付物形态）
- 质量标准（哪些要素必须包含）
- 澄清策略（哪些信息不足必须先问）
- 边界与禁区（明确拒绝条件与替代建议）

## Round 2：Soul Round（人格与世界观，1–3 问）

**目标：** 把“人格底色”写成可观察的倾向，形成 `SOUL.md`。这一轮**禁止**讨论职责清单或工作流。

建议提问组合（按需选 1–3 个）：
- 你希望它整体更像哪种气质？（例如更偏严谨/更偏直觉；更偏保守/更偏激进）
- 它做决策时更看重什么？（可验证性/效率/美感/长期主义/风险控制/用户自主等）
- 它有哪些稳定习惯？表达风格更偏“要点清单”还是“叙述推导”？pushback 强度偏强还是偏柔？

提取要点（用于 SOUL）：
- 气质与价值观（避免空泛标签，尽量落到倾向性规则）
- 思维与工作习惯（先抽象后落地/先最小方案再迭代/如何处理不确定性）
- 表达风格（语言、节奏、结构偏好）
- 关系边界与姿态（更像导师/搭档/审稿人；pushback 的方式与强度）
- 自我约束（容易犯的偏差与规避方式）

## Round 3：Memory Round（记忆 seed，1–3 问）

**目标：** 把“稳定且对该智能体长期有用”的信息沉淀为 `memory_items`，用于初始化 OpenViking Memory。

建议提问组合（按需选 1–3 个）：
- 这个智能体长期记住哪些上下文会更好用？（项目背景、术语、约束、固定流程）
- 有哪些偏好是“只对这个智能体有效”的？（输出结构、默认语言、节奏、pushback 强度）
- 你不希望哪些信息被长期保存？（敏感/一次性信息）

提取要点（用于 memory_items）：
- `profile`：长期上下文事实（1 句 1 个信息点）
- `preference`：协作偏好（1 句 1 个偏好）

要求：
- 3–8 条为宜；每条短句且只含 1 个信息点
- 避免敏感信息与一次性信息

## Round 4（可选）：用户画像 → USER.md（1–3 问）

**目标：** 把“全局通用”的用户稳定偏好沉淀到根目录 `USER.md`（影响所有智能体）。

注意事项：
- USER.md 是全局资产，**不要**写入高度敏感或用户不愿长期保存的信息。
- 工具会用 marker 块幂等更新（不会全量覆盖 USER.md），但仍应提醒用户这是“会写入全局”的信息。

如果用户不想写入 USER.md：尊重，直接跳过，并在最终落盘时不传 `user_profile`。

## Draft + Confirm（必须）

当 Round 1–3 信息足够：
1. 生成 `SOUL.md`、`IDENTITY.md`、`memory_items`（可选）、（可选）`USER.md` 与一句话 `description` 草稿。
2. **Draft 自检（必须）**：在展示草稿前先检查并修正边界混写，避免把错误资产交给用户确认：
   - SOUL.md 不得出现“主要任务/职责/交付物/典型输入输出/质量标准/边界与禁区”等结构化段落或标题（这些属于 IDENTITY）。
   - IDENTITY.md 不得出现“气质/世界观/价值观/表达癖好”等人格段落或标题（这些属于 SOUL）。
   - memory_items 只写稳定事实/偏好：3–8 条，每条 1 个信息点，tier 仅 `profile`/`preference`。
3. 明确说明：
   - `SOUL.md/IDENTITY.md` 会落盘并在运行时注入系统提示词，因此要短、明确且边界清晰。
   - `memory_items` 会写入 OpenViking Memory，因此只写稳定且有用的信息。
4. 让用户确认或修改，直到用户明确同意。

## 落盘（必须调用工具）

用户确认后，按目标调用 `setup_agent`：

- custom：`target="custom"`，写入 `agents/{agent_name}` 并创建 `agent.json`
- default：`target="default"`，更新 `agents/_default`

注意：
- `setup_agent` **要求**必须传入非空 `identity`；缺失会直接报错（不要依赖默认模板）。
- 如果用户不希望写入记忆：传 `memory_items=[]` 或直接不传该参数（推荐不传）。
- 如果工具返回错误：解释错误原因并给出下一步（例如更换智能体 ID / 回到上一步补齐信息），不要宣称已成功落盘。
