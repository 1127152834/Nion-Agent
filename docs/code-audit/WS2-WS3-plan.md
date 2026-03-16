# WS-2 & WS-3 代码优化实施计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 消除 AI 生成代码中的重复、过度抽象，修复架构边界和命名不一致问题。

**Architecture:** 分两个工作流执行。WS-2 聚焦代码级重复消除（共享工具提取、统一 API 错误处理、消除模板代码）。WS-3 聚焦模块级架构整理（路由拆分、模块合并、命名对齐）。每个 Task 独立可提交。

**Tech Stack:** Python 3.12 (FastAPI, LangGraph), TypeScript 5.8 (Next.js 16, TanStack Query)

---

## Chunk 1: WS-2 Backend 重复消除

### Task 1: 提取 community 共享工具函数

**优先级:** HIGH — 80 行完全相同的代码复制

8 个函数在 `web_search/tools.py` 和 `web_fetch/tools.py` 中逐字重复。

**Files:**
- Create: `backend/src/community/_search_utils.py`
- Modify: `backend/src/community/web_search/tools.py`
- Modify: `backend/src/community/web_fetch/tools.py`

- [ ] **Step 1: 创建共享模块**

```python
# backend/src/community/_search_utils.py
"""Shared utilities for web_search and web_fetch tools."""

from __future__ import annotations
import logging
from src.config import get_config

logger = logging.getLogger(__name__)

def _as_string(val, default: str = "") -> str: ...
def _as_positive_int(val, default: int, ceiling: int | None = None) -> int: ...
def _as_dict(val) -> dict: ...
def _split_items(val, *, sep: str = ",") -> list[str]: ...
def _dedupe(items: list[str]) -> list[str]: ...
def _get_search_settings_payload(config) -> dict: ...
def _get_provider_cfg(provider_name: str) -> dict: ...
def _safe_exc_message(exc: Exception) -> str: ...
```

从 `web_search/tools.py` 复制完整实现。

- [ ] **Step 2: 更新 web_search/tools.py 使用共享模块**

替换 8 个函数定义为:
```python
from src.community._search_utils import (
    _as_string, _as_positive_int, _as_dict, _split_items,
    _dedupe, _get_search_settings_payload, _get_provider_cfg, _safe_exc_message,
)
```

- [ ] **Step 3: 更新 web_fetch/tools.py 使用共享模块**

同样替换 8 个函数定义为 import。

- [ ] **Step 4: 运行后端测试验证**

```bash
cd backend && make test
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/community/_search_utils.py backend/src/community/web_search/tools.py backend/src/community/web_fetch/tools.py
git commit -m "refactor(community): extract shared search/fetch utils to _search_utils.py"
```

---

### Task 2: 修复 memory_middleware 中的 langchain_compat 重复导入

**优先级:** MEDIUM — 20 行 copy-paste 的基础设施代码

**Files:**
- Modify: `backend/src/agents/middlewares/memory_middleware.py`

- [ ] **Step 1: 读取 memory_middleware.py 和 langchain_compat.py 确认重复**

- [ ] **Step 2: 替换 memory_middleware.py 中的 try/except 兼容代码**

将 lines 6-25 的 try/except 块替换为:
```python
from src.agents.middlewares.langchain_compat import AgentMiddleware, AgentState
```

- [ ] **Step 3: 运行测试验证**

```bash
cd backend && make test
```

- [ ] **Step 4: Commit**

```bash
git add backend/src/agents/middlewares/memory_middleware.py
git commit -m "refactor(middlewares): use langchain_compat instead of duplicated shim"
```

---

### Task 3: 提取 agents.py 中的 Soul/Identity 资产操作

**优先级:** MEDIUM — ~200 行重复端点逻辑

4 组 GET/PUT 端点遵循相同模式：resolve path → read/write markdown → return content。

**Files:**
- Modify: `backend/src/gateway/routers/agents.py`

- [ ] **Step 1: 读取 agents.py 中 soul/identity 相关端点（lines 813-1046）**

- [ ] **Step 2: 提取通用辅助函数**

在文件顶部添加:
```python
def _read_agent_asset(agent_name: str | None, asset_filename: str) -> str | None:
    """Read SOUL.md or IDENTITY.md for an agent (None = default agent)."""
    base = _resolve_agent_dir(agent_name)
    path = base / asset_filename
    if not path.exists():
        return None
    return path.read_text(encoding="utf-8")

def _write_agent_asset(agent_name: str | None, asset_filename: str, content: str) -> str:
    """Write SOUL.md or IDENTITY.md for an agent (None = default agent)."""
    base = _resolve_agent_dir(agent_name)
    base.mkdir(parents=True, exist_ok=True)
    path = base / asset_filename
    path.write_text(content, encoding="utf-8")
    return content
```

- [ ] **Step 3: 用辅助函数重写 4 组端点**

每个端点从 ~15 行缩减到 ~3 行:
```python
@router.get("/api/agents/{agent_name}/soul")
async def get_agent_soul(agent_name: str):
    content = _read_agent_asset(agent_name, "SOUL.md")
    if content is None:
        raise HTTPException(404, "Soul not found")
    return {"content": content}
```

- [ ] **Step 4: 运行测试验证**

- [ ] **Step 5: Commit**

```bash
git add backend/src/gateway/routers/agents.py
git commit -m "refactor(agents): extract shared soul/identity asset helpers"
```

---

### Task 4: 注册遗漏的 5 个路由到 __init__.py

**优先级:** MEDIUM — 维护隐患，5 个路由绕过 lazy-loading 注册机制

**Files:**
- Modify: `backend/src/gateway/routers/__init__.py`

- [ ] **Step 1: 读取 __init__.py 确认 _ROUTER_MODULES 内容**

- [ ] **Step 2: 将 5 个遗漏的路由加入 _ROUTER_MODULES**

```python
# 添加到 _ROUTER_MODULES set:
"agents",
"config",
"embedding_models",
"evolution",
"heartbeat",
```

- [ ] **Step 3: 运行测试验证**

- [ ] **Step 4: Commit**

```bash
git add backend/src/gateway/routers/__init__.py
git commit -m "fix(gateway): register 5 missing routers in __init__.py"
```

---

## Chunk 2: WS-2 Frontend 重复消除

### Task 5: 创建共享 API fetch 工具函数

**优先级:** HIGH — 80+ 处重复的 `if (!response.ok)` 错误处理

**Files:**
- Create: `frontend/src/core/api/fetch.ts`
- Modify: `frontend/src/core/api/index.ts` (添加 re-export)

- [ ] **Step 1: 创建 fetch.ts**

```typescript
// frontend/src/core/api/fetch.ts
import { getBackendBaseURL } from "@/core/config";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly detail?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Typed fetch wrapper with unified error handling.
 * All backend API calls should use this instead of raw fetch().
 */
export async function apiFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const url = `${getBackendBaseURL()}${path}`;
  const response = await fetch(url, init);

  if (!response.ok) {
    let detail: string | undefined;
    try {
      const body = await response.json();
      detail =
        typeof body?.detail === "string"
          ? body.detail
          : typeof body?.message === "string"
            ? body.message
            : undefined;
    } catch {
      // non-JSON error response
    }
    throw new ApiError(
      detail ?? `Request failed (${response.status})`,
      response.status,
      detail,
    );
  }

  return response.json() as Promise<T>;
}

/**
 * apiFetch variant that doesn't parse response body.
 */
export async function apiFetchVoid(
  path: string,
  init?: RequestInit,
): Promise<void> {
  const url = `${getBackendBaseURL()}${path}`;
  const response = await fetch(url, init);

  if (!response.ok) {
    let detail: string | undefined;
    try {
      const body = await response.json();
      detail = typeof body?.detail === "string" ? body.detail : undefined;
    } catch {}
    throw new ApiError(
      detail ?? `Request failed (${response.status})`,
      response.status,
      detail,
    );
  }
}
```

- [ ] **Step 2: 在 core/api/index.ts 中 re-export**

```typescript
export { apiFetch, apiFetchVoid, ApiError } from "./fetch";
```

- [ ] **Step 3: Commit (仅创建工具，不迁移消费者)**

```bash
git add frontend/src/core/api/fetch.ts frontend/src/core/api/index.ts
git commit -m "feat(api): add shared apiFetch utility with unified error handling"
```

---

### Task 6: 迁移最重复的 API 模块使用 apiFetch

**优先级:** HIGH — 逐步替换，每个模块独立 commit

选择 5 个最典型的模块进行迁移：

**Files (每个子步骤):**
- Modify: `frontend/src/core/runtime-info/api.ts`
- Modify: `frontend/src/core/runtime-profile/api.ts`
- Modify: `frontend/src/core/runtime-topology/api.ts`
- Modify: `frontend/src/core/models/api.ts`
- Modify: `frontend/src/core/skills/api.ts`

- [ ] **Step 1: 迁移 runtime-info/api.ts**

替换 `fetch()` + `if (!response.ok)` 为 `apiFetch<T>(path)` 调用。

- [ ] **Step 2: 迁移 runtime-profile/api.ts**

这个文件有两处完全相同的 8 行错误处理代码（lines 16-28 和 50-62），用 `apiFetch` 替换后直接消除。

- [ ] **Step 3: 迁移 runtime-topology/api.ts**

- [ ] **Step 4: 迁移 models/api.ts**

- [ ] **Step 5: 迁移 skills/api.ts**

- [ ] **Step 6: TypeScript 类型检查**

```bash
cd frontend && pnpm typecheck
```

- [ ] **Step 7: Commit**

```bash
git add frontend/src/core/runtime-info/ frontend/src/core/runtime-profile/ \
  frontend/src/core/runtime-topology/ frontend/src/core/models/ frontend/src/core/skills/
git commit -m "refactor(frontend): migrate 5 API modules to shared apiFetch"
```

> **Note:** 剩余 15+ 个 API 模块可在后续批次逐步迁移，不阻塞其他 Task。

---

### Task 7: 统一 agent query key 前缀

**优先级:** MEDIUM — 可能导致缓存不一致 / 数据过期

**Files:**
- Create: `frontend/src/core/agents/query-keys.ts`
- Modify: `frontend/src/core/agents/hooks.ts`
- Modify: `frontend/src/core/agents/editor-hooks.ts`
- Modify: `frontend/src/core/agents/evolution-hooks.ts`
- Modify: `frontend/src/core/agents/heartbeat-hooks.ts`
- Modify: `frontend/src/core/agents/settings-hooks.ts`

- [ ] **Step 1: 创建 query-keys.ts**

```typescript
// frontend/src/core/agents/query-keys.ts
export const agentKeys = {
  all: ["agents"] as const,
  lists: () => [...agentKeys.all, "list"] as const,
  detail: (name: string) => [...agentKeys.all, name] as const,
  defaultConfig: () => [...agentKeys.all, "default-config"] as const,
  soul: (name: string) => [...agentKeys.all, name, "soul"] as const,
  identity: (name: string) => [...agentKeys.all, name, "identity"] as const,
  heartbeat: (name: string) => [...agentKeys.all, name, "heartbeat"] as const,
  evolution: (name: string) => [...agentKeys.all, name, "evolution"] as const,
  settings: (name: string) => [...agentKeys.all, name, "settings"] as const,
} as const;
```

- [ ] **Step 2: 替换所有 hooks 文件中的 hardcoded query keys**

将 `["agents"]`, `["agents", name]`, `["agent", "soul", name]` 等替换为 `agentKeys.xxx()` 调用。

- [ ] **Step 3: TypeScript 类型检查**

- [ ] **Step 4: Commit**

```bash
git add frontend/src/core/agents/
git commit -m "refactor(agents): unify query keys with agentKeys factory"
```

---

## Chunk 3: WS-3 架构整理

### Task 8: 合并 runtime 三模块

**优先级:** MEDIUM — 3 个目录 8 个文件 137 行，合并为 1 个目录

**Files:**
- Create: `frontend/src/core/runtime/info.ts`
- Create: `frontend/src/core/runtime/profile.ts`
- Create: `frontend/src/core/runtime/topology.ts`
- Create: `frontend/src/core/runtime/index.ts`
- Delete: `frontend/src/core/runtime-info/` (整个目录)
- Delete: `frontend/src/core/runtime-profile/` (整个目录)
- Delete: `frontend/src/core/runtime-topology/` (整个目录)
- Modify: 所有引用这三个模块的消费者文件

- [ ] **Step 1: 创建 core/runtime/ 目录并迁移代码**

将 `runtime-info/api.ts` → `runtime/info.ts`，`runtime-profile/api.ts` → `runtime/profile.ts`，`runtime-topology/*.ts` → `runtime/topology.ts`。

- [ ] **Step 2: 创建 barrel export**

```typescript
// frontend/src/core/runtime/index.ts
export { loadRuntimeInfo, type RuntimeInfo } from "./info";
export { loadRuntimeProfile, type RuntimeProfileResponse } from "./profile";
export { loadRuntimeTopology, useRuntimeTopology, type RuntimeTopologyResponse } from "./topology";
```

- [ ] **Step 3: 更新所有消费者的 import 路径**

搜索 `@/core/runtime-info`、`@/core/runtime-profile`、`@/core/runtime-topology` 并替换为 `@/core/runtime`。

- [ ] **Step 4: 删除旧目录**

- [ ] **Step 5: TypeScript 类型检查**

- [ ] **Step 6: Commit**

```bash
git commit -m "refactor(frontend): merge runtime-info/profile/topology into core/runtime/"
```

---

### Task 9: 拆分 workbench.py（2912 行）

**优先级:** MEDIUM — 最大的单文件，4 个 sub-router 混在一起

**Files:**
- Create: `backend/src/gateway/routers/workbench/` (package)
- Create: `backend/src/gateway/routers/workbench/__init__.py`
- Create: `backend/src/gateway/routers/workbench/sessions.py`
- Create: `backend/src/gateway/routers/workbench/plugins.py`
- Create: `backend/src/gateway/routers/workbench/marketplace.py`
- Create: `backend/src/gateway/routers/workbench/plugin_studio.py`
- Create: `backend/src/gateway/routers/workbench/models.py` (Pydantic models)
- Delete: `backend/src/gateway/routers/workbench.py`
- Modify: `backend/src/gateway/app.py` (更新 import)

- [ ] **Step 1: 读取 workbench.py 理解 4 个 sub-router 边界**

- [ ] **Step 2: 提取 Pydantic models 到 models.py**

- [ ] **Step 3: 按 sub-router 拆分到 4 个文件**

- [ ] **Step 4: 创建 __init__.py 重新组合所有 router**

```python
from .sessions import router as sessions_router
from .plugins import router as plugins_router
from .marketplace import router as marketplace_router
from .plugin_studio import router as plugin_studio_router

# Re-export combined router for backward compatibility
from fastapi import APIRouter
router = APIRouter()
router.include_router(sessions_router)
router.include_router(plugins_router)
router.include_router(marketplace_router)
router.include_router(plugin_studio_router)
```

- [ ] **Step 5: 更新 app.py import**

- [ ] **Step 6: 运行测试验证**

- [ ] **Step 7: Commit**

```bash
git commit -m "refactor(gateway): split workbench.py into 4 sub-modules"
```

---

### Task 10: 为 9 个缺失 barrel export 的 core 模块添加 index.ts

**优先级:** LOW — 统一 import 模式

**Files:**
- Create: `frontend/src/core/a2ui/index.ts`
- Create: `frontend/src/core/embedding-models/index.ts`
- Create: `frontend/src/core/messages/index.ts`
- Create: `frontend/src/core/notification/index.ts`
- Create: `frontend/src/core/runtime-info/index.ts` (如果 Task 8 未执行)
- Create: `frontend/src/core/runtime-profile/index.ts` (如果 Task 8 未执行)
- Create: `frontend/src/core/system/index.ts`
- Create: `frontend/src/core/tools/index.ts`
- Create: `frontend/src/core/utils/index.ts`

- [ ] **Step 1: 为每个模块创建 index.ts，re-export 公开 API**

- [ ] **Step 2: TypeScript 类型检查**

- [ ] **Step 3: Commit**

```bash
git commit -m "refactor(frontend): add barrel exports to 9 core modules"
```

---

## 执行优先级

| 优先级 | Task | 描述 | 风险 | 预计行变动 |
|--------|------|------|------|-----------|
| P0 | Task 1 | 提取 community 共享工具 | 低 | -80 |
| P0 | Task 5 | 创建 apiFetch 工具 | 低 | +60 |
| P1 | Task 6 | 迁移 5 个 API 模块 | 低 | -100 |
| P1 | Task 2 | 修复 langchain_compat | 低 | -18 |
| P1 | Task 3 | 提取 Soul/Identity helpers | 中 | -140 |
| P1 | Task 4 | 注册遗漏路由 | 低 | +5 |
| P1 | Task 7 | 统一 query keys | 中 | +30, -50 |
| P2 | Task 8 | 合并 runtime 三模块 | 中 | ±137 |
| P2 | Task 9 | 拆分 workbench.py | 中 | ±2912 |
| P3 | Task 10 | 添加 barrel exports | 低 | +27 |

## 不在本计划范围内（记录但延后）

以下发现已记录但复杂度较高，建议作为独立计划处理：

1. **Config singleton 泛型化** — 影响 6 个配置模块，需要全面测试
2. **Settings 页面迁移到 TanStack Query** — 影响 5 个大型页面组件（17-28 个 useState）
3. **models-section.tsx 拆分** — 3020 行单文件，需要 UI 设计配合
4. **CRUD hook 工厂** — 影响所有 core/ hooks 文件，需要设计通用 API
5. **移除 Jotai 依赖** — 需确认是否有计划使用
6. **Frontend agents/ 拆分 heartbeat/evolution** — 需要和路由一起调整
