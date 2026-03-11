# Phase 3.8 As-Built：记忆系统合并总计划落地（2026-03-11）

## 实施目标

- 将在线记忆路径硬切到 `structured-fs`。
- 删除并停用 legacy `memory.json` 在线语义（不迁移、不备份）。
- 落地共享治理层（队列、冲突、目录、关系边预埋）。
- 补齐前端全局/per-agent 双视图与治理可见性。

## 已落地改动

### 1) 存储硬切与 legacy 删除

- 默认 provider 改为 `structured-fs`，registry 仅注册该 provider。
- 启动与 provider 初始化时执行 `memory.json` 幂等删除：
  - 全局：`{base_dir}/memory.json`
  - 智能体：`{base_dir}/agents/*/memory.json`
- `load_memory_config_from_dict` 强制归一到 `provider=structured-fs`。

对应代码：
- `backend/src/agents/memory/registry.py`
- `backend/src/agents/memory/legacy_cleanup.py`
- `backend/src/gateway/app.py`
- `backend/src/config/memory_config.py`

### 2) 作用域模型与治理链路

- `StructuredFsRuntime` 支持 scope：
  - `global`
  - `agent:<name>`
- 新模型：`MemoryEntryV3`、`RelationEdge`、`AgentDirectoryCard`、`PromotionDecision`。
- 上卷规则：
  - `confidence >= 0.85`：实时上卷 global
  - 否则进入 `governance_queue`
- 冲突：同实体冲突标记 `contested` 并进入治理队列。

对应代码：
- `backend/src/agents/memory/structured_models.py`
- `backend/src/agents/memory/structured_runtime.py`
- `backend/src/agents/memory/governor.py`

### 3) API 与运行时契约

- 保留兼容：`GET /api/memory`（global）
- 新增/收口：
  - `GET /api/memory/view?scope=global|agent&agent_name=...`
  - `GET /api/memory/items`
  - `GET /api/memory/catalog`
  - `GET /api/memory/governance/status`
  - `POST /api/memory/governance/run`
  - `POST /api/memory/governance/decide`

对应代码：
- `backend/src/gateway/routers/memory.py`

### 4) Catalog 与周期治理

- 增加 memory governor 系统能力（非聊天智能体）。
- agent 配置/SOUL/IDENTITY 变更后 best-effort 刷新目录卡。
- Heartbeat 新增 `memory_governance` 模板和执行器。

对应代码：
- `backend/src/gateway/routers/agents.py`
- `backend/src/heartbeat/templates.py`
- `backend/src/heartbeat/executor.py`

### 5) 前端记忆页收口

- `Memory API/Hooks` 接入新接口（view/items/catalog/governance）。
- 设置页支持：
  - `global` / `agent` scope 切换
  - per-agent 选择
  - 条目级状态（含 contested）与关系数可见
  - 治理队列摘要可见
  - 智能体目录卡可见

对应代码：
- `frontend/src/core/memory/api.ts`
- `frontend/src/core/memory/hooks.ts`
- `frontend/src/core/memory/index.ts`
- `frontend/src/components/workspace/settings/memory-settings-page.tsx`

## 验证记录

- `pnpm --dir frontend typecheck`：通过
- `pnpm --dir frontend exec eslint src/components/workspace/settings/memory-settings-page.tsx src/core/memory/api.ts src/core/memory/hooks.ts src/core/memory/index.ts`：通过
- `uv run pytest backend/tests/test_memory_structured_runtime_scope.py backend/tests/test_memory_legacy_cleanup.py backend/tests/test_memory_core_registry.py backend/tests/test_memory_updater.py backend/tests/test_custom_agent.py::TestMemoryFilePath -q`：通过（17 passed）

## 已知问题与后续

1. 当前环境执行 `backend/tests/test_custom_agent.py` 全量时会受外部依赖缺失（`markdownify`）影响，不属于本次记忆改造逻辑回归。
2. 前端治理区当前为只读监控；若需要可继续接入 `governance/decide` 的手动裁决操作。
3. 本轮仍未引入图数据库，仅预埋关系元数据与文件索引，符合既定范围。
