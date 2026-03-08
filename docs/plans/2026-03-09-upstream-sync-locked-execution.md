# Deer-Flow 上游逐提交同步执行报告（锁定版）

- 执行分支：`codex/sync-deerflow-mainline`
- 执行位置：隔离 worktree（未在主脏工作区直接操作）
- 红线：未恢复 `config.yaml` 为运行时真源；配置仍走页面/API 持久化
- 范围：`merge-base..upstream/main` 中用户确认的 1-11 决策集合

## 逐提交执行矩阵（锁定版）

| 序号 | 上游提交 | 决策 | 执行结果 | 说明 |
|---|---|---|---|---|
| 1 | `3a5e0b93` | B | 已吸收 | 吸收 `langgraph-api/langgraph-cli/runtime-inmem` 与 `test_custom_agent` 稳定性修复；`uv.lock` 已本地重解。 |
| 2 | `28e1257e` | A/B | 已吸收 | 吸收 `infoquest_client/tools/tests`；README 冲突时保留本地主线。 |
| 3 | `cfae7519` | A | 已吸收 | 直接吸收 `.github/copilot-instructions.md`。 |
| 4 | `2e90101b` | A | 已吸收 | 吸收 `config.example.yaml` 注释示例；仅文档示例，不改变运行时真源。 |
| 5 | `9d2144d4` | B | 已吸收 | 后端 `/api/threads/{thread_id}/suggestions` 已接入；前端 `input-box` 增量接入 follow-up suggestions（不整文件覆盖）。 |
| 6 | `d664ae5a` | B | 已吸收 | checkpointer provider/client/tests/langgraph.json 已接入；配置来源改为 Config Store/Config API（未回流 `config.yaml`）。 |
| 7 | `75b73020` | B（本地化） | 已本地化实现 | 未并入 upstream channels 全家桶；在现有架构新增 Telegram（Webhook + Stream），并复用本地飞书/钉钉链路。 |
| 8 | `3512279c` | A/B | 已吸收 | `model_config.thinking` 与 factory 的 anthropic thinking 兼容已并入。 |
| 9 | `cf9af1fe` | C | 已跳过 | 按用户决策跳过。 |
| 10 | `8871fca5` | A/B | 已吸收 | `claude-to-deerflow` skill 已吸收；Telegram 生命周期优化逻辑映射到本地运行链路。 |
| 11 | `ac1e1915` | C | 已跳过 | 按用户决策跳过。 |

## 第7项（Telegram 本地化）落地点

- 后端平台枚举扩展：`lark|dingtalk|telegram`
- DB 约束与迁移：`channels.db` 的平台 CHECK 约束升级并支持旧库迁移
- Webhook：新增 `/api/channels/webhooks/telegram`，支持可选 `X-Telegram-Bot-Api-Secret-Token` 校验
- Stream：新增 Telegram long polling driver（`getUpdates`），支持优雅停止与 `allowed_users` 过滤
- 发送链路：新增 Telegram `sendMessage` 发送分支
- 前端：Channels 设置页新增 Telegram tab 与字段（`bot_token/allowed_users/secret_token`）
- i18n：中英文文案已补齐 Telegram 平台与字段提示
- 测试：新增 `backend/tests/test_channels_telegram.py`

## 门禁结果

### 后端
- `uv run pytest tests/test_custom_agent.py tests/test_client_live.py tests/test_suggestions_router.py tests/test_checkpointer.py tests/test_model_factory.py tests/test_channels_telegram.py -q`
  - 结果：`88 passed, 1 skipped`
- `uv run pytest tests/test_lead_agent_model_resolution.py tests/test_mcp_oauth.py -q`
  - 结果：`8 passed`
- `uv run pytest tests/test_uploads_router.py tests/test_uploads_middleware_core_logic.py -q`
  - 结果：`33 passed`

> 说明：计划中的 `tests/test_security_router.py`、`tests/test_security_audit.py` 在当前仓库不存在，无法执行。

### 前端
- `pnpm -C frontend exec tsc --noEmit`
  - 结果：通过

### 桌面
- `pnpm -C desktop/electron build`
  - 结果：通过

## 回滚步骤

- 单提交回滚：`git revert <sync-commit-sha>`
- 批次回滚：按批次逆序 `git revert`
- 进行中的吸收失败：`git cherry-pick --abort`

