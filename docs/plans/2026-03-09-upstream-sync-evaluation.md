# Nion 上游同步评估与执行报告（2026-03-09）

- 本地分支：`codex/sync-nion-mainline`
- 分叉基线：`b17c087174cc5999392fe6160ba2fe3692acefa1`
- 上游范围：`b17c087..upstream/main`（18 commits）
- 评估策略：`A=直接吸收`，`B=函数级吸收`，`C=跳过`
- 红线：严格禁止 `config.yaml` 回流为运行时真源；桌面/Electron 兼容优先。
- 证据明细：`docs/plans/2026-03-09-upstream-sync-filemap.txt`

## 逐提交评估矩阵

| SHA | 日期 | 模块 | 改动文件 | 与本地重叠文件 | 风险 | 决策 | 原因 | 执行动作 |
|---|---|---|---|---|---|---|---|---|
| `1b3939cb` | 2026-03-05 | chat/uploads | 5 | 5 | L2 | A | 空上传文件与 artifact 选择修复，直接提升稳定性 | `cherry-pick -x`，落地为 `c16749ba` |
| `0c7c96d7` | 2026-03-05 | nginx-local | 1 | 1 | L1 | A | 本地 nginx pid/log 路径跨平台化 | `cherry-pick -x`，落地为 `8b88431d` |
| `3a5e0b93` | 2026-03-06 | backend deps/langgraph-api | 3 | 2 | L3 | C | 依赖与 lockfile 漂移大，且与本地 memory/retrieval 改造重叠高 | 跳过；记录为后续独立升级候选 |
| `3e4a24f4` | 2026-03-06 | subagent + MCP async | 2 | 2 | L2 | A | 明确修复 subagent 对 async MCP tool 的兼容性 | `cherry-pick -x`，落地为 `08d51847` |
| `28e1257e` | 2026-03-06 | infoquest | 6 | 2 | L2 | C | 新能力引入面大，且涉及配置示例；本轮非核心目标 | 跳过；仅保留评估结论 |
| `cfae7519` | 2026-03-06 | CI 文档 | 1 | 0 | L1 | C | 非运行时价值 | 跳过 |
| `2e90101b` | 2026-03-06 | config 示例 | 1 | 1 | L3 | C | 涉及 config 路线调整，本轮严格禁回流 | 跳过 |
| `9d2144d4` | 2026-03-06 | may_ask（前后端） | 10 | 8 | L2 | C | 产品行为新增且重叠面大，需单独需求评审 | 跳过 |
| `09325ca2` | 2026-03-06 | present_file 安全边界 | 2 | 2 | L2 | A | 规范化 artifact 路径，防止越界呈现 | `cherry-pick -x`，落地为 `55e25091` |
| `d664ae5a` | 2026-03-07 | checkpointer 架构 | 14 | 7 | L3 | C | 触达 `app_config/paths/client/config.example`，架构级冲突高 | 跳过；不引入该 checkpointer 路线 |
| `75b73020` | 2026-03-08 | IM channels 大改（Feishu/Slack/Telegram） | 49 | 17 | L3 | C | 与本地已实现 Lark/DingTalk 体系架构不一致，且变更面过大 | 跳过；提炼可借鉴点（见下） |
| `511e9eaf` | 2026-03-08 | docker dev | 1 | 1 | L1 | B | 可消除 cache_from 噪音；需保留 Nion 自定义容器名 | 解决冲突后部分吸收，落地为 `72a3a4b1` |
| `3512279c` | 2026-03-08 | anthropic thinking | 4 | 2 | L2 | C | 涉及模型工厂与配置示例，需结合现有模型策略统一设计 | 跳过 |
| `cf9af1fe` | 2026-03-08 | chat UI + thinking message | 9 | 7 | L2 | C | 前端/中间件重叠高，且与本地 UI 走向冲突风险高 | 跳过 |
| `6b5c4fe6` | 2026-03-08 | gateway 启动诊断 | 4 | 4 | L2 | B | `app.py` 异常链路增强有价值，但 Makefile/README 含 config.yaml 预检不可引入 | 仅吸收 `backend/src/gateway/app.py`，落地为 `4ca75df1` |
| `3721c82b` | 2026-03-08 | nginx + thread hooks | 3 | 3 | L2 | B | nginx `/api/threads` 兜底路由有价值；hooks 改动与本地 `isNewThread` 逻辑冲突 | 仅吸收 nginx 两文件，落地为 `dd6a6bc3` |
| `8871fca5` | 2026-03-08 | claude-to-nion skill | 5 | 1 | L1 | C | 非本轮核心运行时能力 | 跳过 |
| `ac1e1915` | 2026-03-08 | channels session 配置化 | 5 | 2 | L3 | C | 依赖 upstream `channels/manager.py/service.py` 架构，本地不存在对应形态 | 跳过；保留思路借鉴 |

## 已吸收提交（按落地顺序）

1. `08d51847` ← upstream `3e4a24f4`（subagent async MCP）
2. `55e25091` ← upstream `09325ca2`（present_file 路径规范化）
3. `8b88431d` ← upstream `0c7c96d7`（nginx local 跨平台路径）
4. `c16749ba` ← upstream `1b3939cb`（空上传文件与 artifact 选择修复）
5. `4ca75df1` ← upstream `6b5c4fe6`（仅 gateway 启动诊断增强）
6. `72a3a4b1` ← upstream `511e9eaf`（docker cache_from 噪音修复，保留 Nion 容器名）
7. `dd6a6bc3` ← upstream `3721c82b`（仅 nginx 线程路由兜底）

## 对 `75b73020/ac1e1915` 的借鉴点（未直接吸收）

1. channel session 维度可细化到“渠道+用户”粒度（本地可在现有 `ChannelRepository` 上做增量设计）。
2. 多 IM 平台接入可抽象统一的 adapter/event-bus 接口层（避免平台特定逻辑散落）。
3. 第三方 channel 新增应坚持“本地已有 Lark/DingTalk 能力优先复用”，避免平行双架构并存。

## 回滚方式

- 回滚单个吸收提交：`git revert <local-commit-sha>`
- 回滚本轮全部吸收（在本分支）：按逆序 `git revert dd6a6bc3 72a3a4b1 4ca75df1 c16749ba 8b88431d 55e25091 08d51847`

