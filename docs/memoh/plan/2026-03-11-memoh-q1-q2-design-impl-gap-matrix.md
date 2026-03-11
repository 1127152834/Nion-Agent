# Memoh Q1/Q2 设计与实现差距矩阵（As-Built）

- 日期：`2026-03-11`
- 目标：对齐 Q1（默认智能体管理）与 Q2（记忆语义）在 `docs/memoh` 设计与代码实现之间的差距，并给出落地决策与验收口径。

## Q1 默认智能体管理

| 文档目标 | 代码事实（改造前） | 差异级别 | 落地决策 | 验收口径 |
| --- | --- | --- | --- | --- |
| 默认主助手具备正式资产管理入口 | 已有 `/api/default-agent/soul` 与 `/api/default-agent/identity`，但前端未接线 | 高 | 前端编辑器 `_default` 走 default-agent 专用接口；同时保留 custom agent 路径 | 在默认智能体设置页可读写 SOUL/IDENTITY，保存后刷新仍生效 |
| 文档建议 `/api/soul/*` 语义入口 | 实际实现落在 `/api/default-agent/*`，命名漂移 | 中 | 新增兼容别名：`/api/soul/default`、`/api/soul/identity`，内部复用 default-agent 实现 | 4 个接口读写行为与 default-agent 主接口一致 |
| 默认智能体应可管理但不可删除/改名 | `_default` 初始化存在，但 `/api/agents/{name}` 正则不接受 `_`；删除接口未显式保护 | 高 | 新增 `/api/default-agent/config`（可编辑 description/model/tool_groups/heartbeat/evolution）；`DELETE /api/agents/_default` 显式 403；名称只读 | 删除 `_default` 返回 403；设置页名称不可编辑；配置可保存 |

## Q2 记忆语义

| 文档目标 | 代码事实（改造前） | 差异级别 | 落地决策 | 验收口径 |
| --- | --- | --- | --- | --- |
| 设置页记忆语义清晰 | 设置页仅请求 `/api/memory`，但 UI 未明确“仅全局” | 中 | 在设置页增加“全局记忆视图”提示文案，明确不展示 per-agent 记忆 | 打开设置-记忆时可见 scope 提示，网络仅出现 `/api/memory` |
| 保持运行时全局/per-agent 双路径 | 运行时已是：无 `agent_name`=全局，有 `agent_name`=per-agent | 低 | 不改运行时路径，补文案与接口描述，避免认知漂移 | 默认聊天继续读写全局；agent 聊天继续走 agent memory |
| 减少未接线配置噪声 | `memory-section.tsx` 为未接线配置死代码 | 中 | 移除死代码，避免误导为“设置页可配置 per-agent 记忆” | 代码中不再存在该未接线 section |

## 结论

- 当前问题是“产品闭环与语义漂移”，不是 Memory Core / Soul Core 的重构失败。
- 本轮收口后，默认智能体管理、记忆解释、接口命名兼容、前端入口位置与实际行为将保持一致。
