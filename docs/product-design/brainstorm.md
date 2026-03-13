# Nion 产品脑暴主文档

> 目标：持续沉淀「系统优化 / 升级改造 / 未来方向」。
> 规则：每次运行必须新增一次探索记录；每次记录必须有新方向，避免重复路径。

## 产品现状快照（基于本仓库）

- 基础能力完整：多智能体、工具调用、沙箱执行、技能系统、产物链路、OpenViking 记忆、桌面端打包。
- 关键底座已就绪：
  - 调度系统：`backend/src/scheduler/*` + `frontend/src/components/workspace/scheduler/*`
  - 通知链路：`frontend/src/core/notification/hooks.ts` + `SchedulerReminderWatcher`
  - 聊天与任务上下文：`TodoList`、`SubtasksProvider`、线程级状态
- 当前短板不在“能不能做”，而在“主动性产品化”与“注意力治理体验”。

## 历史探索同步（来自自动化记忆）

### 2026-03-13（上轮）

- 方向：垂直行业方案包 + 交付方法论 + ROI 量化。
- 结论：适合作为商业包装层，但本轮起需切换到新的产品探索方向。

---

## 本轮探索（2026-03-13，新增）

### 探索主题

主动性与注意力管理产品线（避开行业包/商业化/ROI 旧路径）。

### 外部标杆信号（官方资料）

- OpenAI Operator：强调可执行真实网页任务，说明“代办执行”已成为助手主战场。
- Anthropic Claude 文档（Extended thinking / Tool use / MCP）：强调长任务链路与可控工具调用。
- Cursor Background Agent：强调“后台持续执行 + 用户异步接收结果”。
- Cognition Devin：强调“长时会话、可恢复执行、工程任务连续推进”。
- GitHub Copilot Coding Agent：强调“从 issue 到 PR 的异步代理闭环”。

### 对 Nion 的新增判断

1. Nion 下一阶段核心差异应从“会做事”升级为“主动安排何时做、先做什么、被打断后如何恢复”。
2. scheduler + notification + todo + subagent 已是可复用底座，不需要大规模重构即可上线主动能力 MVP。
3. 产品前台应从单一 chat 入口，升级为「行动收件箱（Action Inbox）+ 节律引擎（Heartbeat）+ 恢复流（Resume）」。

### 新增功能模块建议（本轮新增）

1. Action Inbox（统一行动收件箱）
- 聚合来源：用户消息、scheduler 任务、子代理结果、失败重试、待确认事项。
- 每条 Action 必须有：优先级、截止时间、来源、下一步建议。

2. Priority Engine（优先级引擎）
- 评分维度：影响度、紧急度、依赖阻塞、上下文切换成本。
- 输出：Now / Next / Later 三栏，不直接替用户执行高风险动作。

3. Interruption Recovery（打断恢复）
- 自动保存“恢复胶囊”：当前目标、进行中步骤、关键文件、失败点。
- 回到会话时提供一键恢复（Resume）。

4. Opportunity Discovery（机会发现）
- 基于记忆与近期操作识别“可自动推进”的低风险任务。
- 只给建议和预估收益，不默认静默执行。

5. Attention Budget（注意力预算）
- 限制主动提醒频率，支持专注窗口（Focus Session）。
- 对低价值提醒进行批处理合并，减少通知噪音。

### 分阶段落地（90天）

- Phase A（2-3周）：Action Inbox + 基础优先级规则 + Resume 按钮。
- Phase B（3-4周）：Priority Engine 评分可配置 + 机会发现建议卡片。
- Phase C（3-4周）：Attention Budget + 专注模式 + 通知整形策略。

### 本轮独立结论文档

- `docs/product-design/findings/2026-03-13-主动性与注意力管理产品线.md`

下一次探索禁止重复目标：主动性与注意力管理（Action Inbox / Priority Engine / Interruption Recovery / Opportunity Discovery / Attention Budget）
