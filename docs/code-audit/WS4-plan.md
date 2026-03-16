# WS-4 质量与可维护性 实施计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 拆分过大的单文件组件，清理日志/调试残留，移除未使用依赖，提升代码可维护性。

**Architecture:** 分 3 个 Chunk 执行。Chunk 1 聚焦前端最大文件拆分（models-section 3020 行、input-box 2496 行）。Chunk 2 聚焦后端日志规范化和前端调试残留清理。Chunk 3 聚焦依赖清理和最终审计报告更新。每个 Task 独立可提交。

**Tech Stack:** Python 3.12 (FastAPI), TypeScript 5.8 (Next.js 16, React 19, TanStack Query)

---

## 审计发现摘要

| 问题 | 位置 | 严重度 | Task |
|------|------|--------|------|
| models-section.tsx 3020 行/54 函数 | frontend/src/components/workspace/settings/ | HIGH | 1 |
| input-box.tsx 2496 行/20+ 函数 | frontend/src/components/workspace/ | HIGH | 2 |
| backend print() 代替 logging（3 文件 13 处） | backend/src/ | MEDIUM | 3 |
| frontend console.log 残留（46 处） | frontend/src/ | LOW | 4 |
| Jotai 依赖已死（0 个 atom 使用） | frontend/ | LOW | 5 |
| 审计文档更新 | docs/code-audit/ | LOW | 6 |

### 不在本计划范围内（记录但延后）

以下发现复杂度较高，建议作为独立计划处理：

1. **Settings 页面 useState 泛滥**（5 个页面 17-28 个 useState）— 需要设计 form state 管理方案，影响 UI 行为
2. **bridge_service.py 3345 行** — channels 子系统核心，拆分需要深入理解业务流
3. **openviking_runtime.py 2214 行** — 记忆系统核心，拆分风险高
4. **plugin assistant page 2118 行/32 useState** — Plugin Studio 核心页面，拆分需要 UI 设计配合

---

## Chunk 1: 前端大文件拆分

### Task 1: 拆分 models-section.tsx（3020 行 → 6 个文件）

**优先级:** HIGH — 项目最大单文件组件，54 个函数混合在一起

models-section.tsx 包含 3 个逻辑层：
- **工具函数层**（lines 1-600）：~25 个纯函数（协议推断、ID 生成、配置归一化等）
- **类型/常量层**：ProviderPreset、ProviderProtocol、CatalogModel 等类型定义
- **UI 组件层**（lines 600-3020）：ModelsSection 主组件 + 内联子组件

**Files:**
- Create: `frontend/src/components/workspace/settings/configuration/sections/models/utils.ts`
- Create: `frontend/src/components/workspace/settings/configuration/sections/models/types.ts`
- Create: `frontend/src/components/workspace/settings/configuration/sections/models/presets.ts`
- Create: `frontend/src/components/workspace/settings/configuration/sections/models/provider-form.tsx`
- Create: `frontend/src/components/workspace/settings/configuration/sections/models/index.tsx`
- Delete: `frontend/src/components/workspace/settings/configuration/sections/models-section.tsx`
- Modify: 所有 import `models-section` 的消费者文件

- [ ] **Step 1: 读取 models-section.tsx 全文，标记 3 个逻辑层的行号边界**

- [ ] **Step 2: 提取 types.ts — 所有类型定义和接口**

将 `ProviderProtocol`、`ProviderPreset`、`ProviderCatalogModel`、`ConfigDraft` 等类型和接口提取到 `types.ts`。

- [ ] **Step 3: 提取 presets.ts — 预设配置数据**

将 `PROVIDER_PRESETS` 常量数组和 `getPresetById`、`detectPresetId` 等预设相关函数提取到 `presets.ts`。

- [ ] **Step 4: 提取 utils.ts — 纯工具函数**

将不依赖 React 的纯函数提取到 `utils.ts`：
```
defaultUseByProtocol, inferProtocolFromUse, normalizeProviderProtocol,
protocolLabel, parseNumberInput, toSafeAlias, buildProviderSignature,
asProviders, ensureUniqueId, inferProviderLabelFromUse,
normalizeCatalogModel, asCatalogModels, getProviderProtocol,
normalizeProviderList, deriveProvidersFromModels, normalizeModelProviderConfig,
mapProviderModelOptionToConfig, createProviderDraft, formatLastTestTime,
isFieldBlank, mergeModelMetadata
```

- [ ] **Step 5: 提取 provider-form.tsx — Provider 编辑表单子组件**

如果 ModelsSection 中有清晰可分离的子组件（如 Provider 编辑面板），提取为独立组件。

- [ ] **Step 6: 创建 index.tsx — 保留 ModelsSection 主组件**

主组件从新模块 import 工具函数和类型，保留 UI 逻辑和状态管理。

- [ ] **Step 7: 更新消费者 import**

搜索所有 `import.*models-section` 并替换为新路径。

- [ ] **Step 8: TypeScript 类型检查**

```bash
cd frontend && pnpm typecheck
```

- [ ] **Step 9: Commit**

```bash
git commit -m "refactor(settings): split models-section.tsx (3020 行) into 6 focused modules"
```

---

### Task 2: 拆分 input-box.tsx（2496 行 → 4 个文件）

**优先级:** HIGH — 第二大单文件组件，混合了输入框、mention 系统、follow-up 建议

input-box.tsx 包含 3 个逻辑域：
- **Mention 系统**（~200 行）：路径解析、mention 高亮、mention 状态管理
- **Follow-up 建议**（~200 行）：建议列表、消息解析、建议 UI
- **InputBox 主组件**（~1800 行）：核心输入框 + 附件按钮

**Files:**
- Create: `frontend/src/components/workspace/input-box/mentions.tsx`
- Create: `frontend/src/components/workspace/input-box/follow-up.tsx`
- Create: `frontend/src/components/workspace/input-box/utils.ts`
- Create: `frontend/src/components/workspace/input-box/index.tsx`
- Delete: `frontend/src/components/workspace/input-box.tsx`
- Modify: 所有 import `input-box` 的消费者文件

- [ ] **Step 1: 读取 input-box.tsx 全文，标记逻辑域边界**

- [ ] **Step 2: 提取 utils.ts — 纯工具函数**

```
normalizePath, basename, buildPathMentionOptions, parseListValue,
readRecentModels, writeRecentModels, getResolvedMode,
normalizeFollowUpRole, extractFollowUpText, buildFollowUpMessages
```

- [ ] **Step 3: 提取 mentions.tsx — Mention 高亮和状态**

```
MentionHighlightOverlay, resolveMentionState, rankMentionOption,
escapeRegExp, hasInlineMention, buildSubmissionPayload, parseMentions
```

- [ ] **Step 4: 提取 follow-up.tsx — Follow-up 建议组件**

```
FollowUpSuggestionList, SuggestionList
```

- [ ] **Step 5: 创建 index.tsx — InputBox 主组件 + AddAttachmentsButton**

主组件 import mentions 和 follow-up 子组件。

- [ ] **Step 6: 更新消费者 import**

搜索 `import.*input-box` 并替换为新路径。Next.js 的 barrel export 应该让大部分 import 保持不变。

- [ ] **Step 7: TypeScript 类型检查**

```bash
cd frontend && pnpm typecheck
```

- [ ] **Step 8: Commit**

```bash
git commit -m "refactor(workspace): split input-box.tsx (2496 行) into 4 focused modules"
```

---

## Chunk 2: 日志与调试残留清理

### Task 3: 后端 print() → logging 替换

**优先级:** MEDIUM — 13 处 print() 应该使用 logging，影响可观测性

**Files:**
- Modify: `backend/src/agents/middlewares/cli_interactive_middleware.py`（3 处）
- Modify: `backend/src/agents/middlewares/memory_middleware.py`（4 处）
- Modify: `backend/src/client.py`（6 处 — 这些在 `if __name__` 块中，保留）

- [ ] **Step 1: 读取 cli_interactive_middleware.py 中的 print 调用**

- [ ] **Step 2: 替换 cli_interactive_middleware.py 中的 print 为 logger**

确保文件顶部有 `logger = logging.getLogger(__name__)`，将：
```python
print(f"[CLIInteractiveMiddleware] ...")
```
替换为：
```python
logger.debug(...)  # 或 logger.info(...) / logger.error(...)
```

- [ ] **Step 3: 替换 memory_middleware.py 中的 print 为 logger**

同样替换，保持已有的 logger 实例。

- [ ] **Step 4: 检查 client.py — 保留 `if __name__` 中的 print**

`client.py` 的 print 在 `if __name__ == "__main__"` 块中用于 CLI 演示，这是合理的，不需要替换。确认并跳过。

- [ ] **Step 5: 运行后端测试验证**

```bash
cd backend && make test
```

- [ ] **Step 6: Commit**

```bash
git commit -m "fix(backend): replace print() with logging in middlewares"
```

---

### Task 4: 前端 console.log 审计与清理

**优先级:** LOW — 46 处 console 调用，大部分在 error/warn 路径中是合理的

- [ ] **Step 1: 列出所有 console 调用并分类**

```bash
cd frontend/src && grep -rn 'console\.\(log\|warn\|error\|debug\|info\)' --include='*.ts' --include='*.tsx' | grep -v 'node_modules\|.next\|ui/\|ai-elements/'
```

分为 3 类：
- **保留**: `console.error` 在 catch 块中（合理的错误日志）
- **保留**: `console.warn` 用于降级提示（合理的警告）
- **删除**: `console.log` 用于调试（应该清理）

- [ ] **Step 2: 删除纯调试 console.log**

只删除明显是调试残留的 `console.log`（如 `console.log("xxx", data)`），保留有意义的 error/warn。

- [ ] **Step 3: TypeScript 类型检查**

```bash
cd frontend && pnpm typecheck
```

- [ ] **Step 4: Commit**

```bash
git commit -m "chore(frontend): remove debug console.log statements"
```

---

## Chunk 3: 依赖清理与审计收尾

### Task 5: 移除 Jotai 死依赖

**优先级:** LOW — package.json 中声明了 `jotai ^2.18.0`，但零个 atom 使用

**Files:**
- Modify: `frontend/src/app/workspace/layout.tsx`（移除 JotaiProvider）
- Modify: `frontend/package.json`（移除 jotai 依赖）

- [ ] **Step 1: 确认无 atom 使用**

```bash
cd frontend/src && grep -r 'useAtom\|useAtomValue\|useSetAtom\|atom(' --include='*.ts' --include='*.tsx'
```

应该返回空。

- [ ] **Step 2: 移除 layout.tsx 中的 JotaiProvider**

从 `import { Provider as JotaiProvider } from "jotai"` 删除，并从 JSX 树中移除 `<JotaiProvider>` 包裹。

- [ ] **Step 3: 移除 package.json 中的 jotai 依赖**

```bash
cd frontend && pnpm remove jotai
```

- [ ] **Step 4: TypeScript 类型检查**

```bash
cd frontend && pnpm typecheck
```

- [ ] **Step 5: Commit**

```bash
git commit -m "chore(frontend): remove unused jotai dependency"
```

---

### Task 6: 更新审计文档

**优先级:** LOW — 收尾工作

**Files:**
- Modify: `docs/code-audit/README.md`

- [ ] **Step 1: 更新 README.md 状态表**

将 WS-2 和 WS-3 标记为「已完成」，WS-4 标记为「已完成」，更新代码行数基线。

- [ ] **Step 2: Commit**

```bash
git commit -m "docs(code-audit): update WS-2/WS-3/WS-4 status to completed"
```

---

## 执行优先级

| 优先级 | Task | 描述 | 风险 | 预计行变动 |
|--------|------|------|------|-----------:|
| P0 | Task 1 | 拆分 models-section.tsx | 中 | ±3020 |
| P0 | Task 2 | 拆分 input-box.tsx | 中 | ±2496 |
| P1 | Task 3 | 后端 print → logging | 低 | ~-13 |
| P2 | Task 4 | 清理 console.log | 低 | ~-20 |
| P2 | Task 5 | 移除 Jotai | 低 | ~-5 |
| P3 | Task 6 | 更新文档 | 低 | ~+10 |
