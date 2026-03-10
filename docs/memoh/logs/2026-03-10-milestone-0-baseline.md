# Milestone 0 Baseline Report

- 日期：`2026-03-10`
- 分支：`main`
- 对应 change：`bootstrap-memoh-phase-execution-ops`
- 报告目的：确认 `Phase 3` 启动前，前序阶段与流程脚手架的当前真实状态

## 1. 当前快照

### 1.1 OpenSpec change 状态

已确认以下 change 均可通过严格校验：

- `enforce-memory-session-runtime-contract`
- `skeletonize-memory-core-v2-compatible`
- `stabilize-v2-compatible-memory-update`
- `stabilize-desktop-memory-ui-runtime`
- `bootstrap-memoh-phase-execution-ops`

### 1.2 关键回归状态

已运行并通过：

- 后端记忆 / client / scheduler 回归：`131 passed`
- 前端：`pnpm typecheck`
- 桌面端：`./scripts/verify-electron.sh`
- `git diff --check`

### 1.3 当前工作树状态

- 当前分支：`main`
- 当前 `git status --short` 条目数：`73`
- 改动横跨：`backend`、`frontend`、`desktop`、`docs`、`openspec`

结论：**前序功能基线当前可验证为“可运行、可测试、可校验”，但工作树尚未收口，不满足直接开启 `Phase 3` 的工程条件。**

补充：`4980d28b` 已独立收口 LangGraph 线程删除前取消活跃 runs 的 proxy/client 清理块，`879eb3e4` 已补上 runtime topology diagnostics 只读接口与设置页入口；Milestone 0 仍剩 `channels`、`sandbox`、`desktop/runtime` 等后续拆分项。

## 2. Review / 风险结论

### 2.1 关于 `NionClient` 记忆会话契约 review finding

当前基线已运行以下回归：

- `backend/tests/test_client.py`
- `backend/tests/test_scheduler_workflow.py`

它们均已通过，说明 `session_mode / memory_read / memory_write` 的 embedded 透传与 scheduler 透传在当前代码状态下已被测试覆盖，**该 finding 当前不再构成 `Phase 3` 入口 blocker**。

### 2.2 当前 blocker

当前真正的阶段入口 blocker 是：

1. **工作树仍处于多阶段在途状态**
   - 需要先按逻辑拆分与提交，形成一组可解释的安全 commit
2. **既有 change 仍未完成统一收口 / 归档判断**
   - 尤其是 `skeletonize-memory-core-v2-compatible` 与 `stabilize-desktop-memory-ui-runtime`
3. **执行日志刚建立，尚未回填前序 commit 与风险历史**
   - 后续长任务若直接开始，会缺失完整追溯链

## 3. 当前建议

### 建议 A（推荐）：先完成 Milestone 0 收口

1. 继续按逻辑拆分当前工作树
2. 每个逻辑块跑最小验证并提交
3. 回填执行日志
4. 对既有 change 做归档判断
5. 收口完成后，再进入 `Phase 3 Task 0`

### 建议 B：直接开始 `Phase 3 Task 0`

不推荐。虽然当前基线是绿的，但会把前序收口和结构化记忆启动混在同一轮开发里，增加跨阶段混改风险。

## 4. 本报告对应的验证命令

```bash
openspec validate enforce-memory-session-runtime-contract --type change --strict
openspec validate skeletonize-memory-core-v2-compatible --type change --strict
openspec validate stabilize-v2-compatible-memory-update --type change --strict
openspec validate stabilize-desktop-memory-ui-runtime --type change --strict
openspec validate bootstrap-memoh-phase-execution-ops --type change --strict

cd backend && uv run pytest tests/test_client.py tests/test_scheduler_workflow.py tests/test_memory_core_provider.py tests/test_memory_core_registry.py tests/test_memory_updater.py tests/test_memory_session_policy.py tests/test_memory_upload_filtering.py tests/test_lead_agent_rss_context.py -q
cd frontend && pnpm typecheck
cd /Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent && ./scripts/verify-electron.sh
cd /Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent && git diff --check
```
