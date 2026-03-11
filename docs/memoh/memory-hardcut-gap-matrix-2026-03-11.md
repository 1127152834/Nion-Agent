# Nion × Memoh 记忆系统差距矩阵（2026-03-11）

> 范围：本矩阵只覆盖“共享治理层 + Structured-FS 硬切 + 删除 memory.json”收口任务。

| 主题 | 设计目标（To-Be） | 代码事实（As-Is） | 差异级别 | 落地决策 | 验收口径 |
|---|---|---|---|---|---|
| 在线存储主路径 | `structured-fs` 唯一在线存储 | 默认 provider 已切为 `structured-fs`，registry 仅注册该 provider | 低 | 保留 `v2-compatible` 类定义仅作兼容代码，不参与在线路由 | `GET /api/memory/config` 返回 `storage_layout=structured-fs` |
| `memory.json` 生命周期 | 彻底移除，不迁移、不备份 | 启动与 registry 初始化会执行 legacy 删除（global + agents） | 低 | 继续保留幂等清理，不做恢复入口 | 启动后不再存在新生成的 `memory.json` |
| 作用域隔离 | `global` 与 `agent:<name>` 目录/缓存完全隔离 | `StructuredFsRuntime` 按 scope 路径、缓存独立实现 | 低 | 保持当前 scope 语义：默认助手=global，自定义助手=agent | 同轮写入 global/agent 后互不串读 |
| 三层语义 | L0 会话态、L1 作用域记忆、L2 治理共享层 | L1/L2 已落地（entries + governance_queue + catalog），L0 仍由线程态承接 | 中 | 维持当前实现，不额外引入 L0 持久化 | 运行时不将临时会话态落长期存储 |
| 自动上卷 | 高置信实时上卷，低置信入队治理 | `>=0.85` 实时上卷；其余进入治理队列 | 低 | 保留阈值，后续可配置化 | agent 记忆能触发 global 上卷/入队 |
| 冲突治理 | 同实体冲突标记 `contested` 并待裁决 | 冲突标记与 `governance_queue` 已实现 | 低 | 先保留轻量策略（首实体冲突） | 冲突后 `contested_count > 0` |
| 用户覆写裁决 | 支持人工覆写 | `POST /api/memory/governance/decide` 已支持 `override` | 低 | 保持覆写优先语义 | 手动决策后状态更新 |
| 共享目录 | 全局维护 `agent_catalog`（能力+人格摘要） | governor 从 `agent.json/SOUL/IDENTITY` 生成目录卡并写入 global | 低 | 目录刷新采用 best-effort 钩子 + 手动/周期任务 | `/api/memory/catalog` 可返回目录 |
| 图谱预埋 | 预埋关系边，不引入图数据库 | `entity_refs/relations/source_refs/confidence/status` 已在 `MemoryEntryV3` | 低 | 继续文件化 graph 索引 | `index/graph.json` 持续更新 |
| API 语义 | 保留兼容全局接口，并新增 scope/item/catalog/governance | `/api/memory` + `/api/memory/view/items/catalog/governance/*` 已接通 | 低 | `/api/memory` 固定解释为 global 兼容视图 | 前端/外部调用可按 scope 获取 |
| 前端记忆页 | 支持 global/per-agent 切换与治理可见性 | 设置页已接入 scope 切换、条目、治理状态、目录卡 | 中 | 先做只读可视化，不做在线裁决操作按钮 | 设置页可看到 per-agent 与治理状态 |
| 历史数据处理 | 用户接受“直接删除不迁移” | 已按该策略实现 | 无 | 不追加迁移脚本 | 旧 `memory.json` 数据不可恢复（符合决策） |

## 已知边界

1. 目前治理策略为轻量规则，未引入可学习裁决模型。
2. 前端治理区当前是只读监控，尚未接入“手动裁决”按钮。
3. 全量 `backend/tests/test_custom_agent.py` 在当前环境会被外部依赖（如 `markdownify`）阻断，与本次记忆改造无直接耦合。
