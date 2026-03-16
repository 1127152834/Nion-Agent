# DEV2：前端核心层重构方案

> **分支**：`arch/dev2-frontend-core`
> **职责范围**：前端状态管理、组件架构、测试框架、性能优化
> **独占目录**：`frontend/src/core/`, `frontend/src/components/`, `frontend/src/app/`, `frontend/src/hooks/`, `frontend/package.json`
> **禁止触碰**：`backend/`, `desktop/`

---

## Phase 0：紧急修复（Day 1 必须完成）

### Task 0.1：添加 error.tsx 和 not-found.tsx

**严重度:** HIGH — 当前零容错页面，任何未处理异常显示 Next.js 默认白屏

**Files:**
- Create: `frontend/src/app/error.tsx`（全局 fallback）
- Create: `frontend/src/app/not-found.tsx`（全局 404）
- Create: `frontend/src/app/workspace/error.tsx`（工作区级）
- Create: `frontend/src/app/workspace/chats/[thread_id]/error.tsx`（聊天级）

```tsx
// frontend/src/app/workspace/error.tsx
"use client";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function WorkspaceError({
  error, reset,
}: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4">
      <h2 className="text-lg font-semibold">Something went wrong</h2>
      <p className="text-sm text-muted-foreground">{error.message}</p>
      <Button onClick={reset} variant="outline">Try again</Button>
    </div>
  );
}
```

- [ ] Step 1: 创建 4 个 error/not-found 文件
- [ ] Step 2: TypeScript 类型检查
- [ ] Step 3: Commit

---

## Phase 1：Error Boundary 体系 + Form State 库引入

### Task 1.1：引入 react-hook-form + zod

**Files:**
- Modify: `frontend/package.json`

```bash
cd frontend && pnpm add react-hook-form @hookform/resolvers zod
```

- [ ] Step 1: 安装依赖
- [ ] Step 2: 验证 `pnpm typecheck` 通过
- [ ] Step 3: Commit

### Task 1.2：创建全局 Error Boundary 体系

**Files:**
- Create: `frontend/src/components/workspace/error-boundary.tsx`
- Modify: `frontend/src/app/workspace/layout.tsx`
- Modify: `frontend/src/app/workspace/chats/[thread_id]/page.tsx`

```tsx
// frontend/src/components/workspace/error-boundary.tsx
"use client";

import { Component, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  level: "app" | "route" | "feature";
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class WorkspaceErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error(`[ErrorBoundary:${this.props.level}]`, error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
    this.props.onReset?.();
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="flex flex-col items-center justify-center gap-4 p-8">
          <h2 className="text-lg font-semibold">Something went wrong</h2>
          <p className="text-sm text-muted-foreground">
            {this.state.error?.message}
          </p>
          <Button onClick={this.handleReset} variant="outline">
            Try again
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}
```

- [ ] Step 1: 创建 error-boundary.tsx
- [ ] Step 2: 在 WorkspaceLayout 中包裹路由级 boundary
- [ ] Step 3: 在 ChatPage 中包裹功能级 boundary（消息流区域）
- [ ] Step 4: Commit

### Task 1.3：创建 apiFetch 的错误响应适配

**Files:**
- Modify: `frontend/src/core/api/fetch.ts`

当 DEV1 完成统一错误响应后，更新 `apiFetch` 以解析新的错误格式：

```typescript
// 新增：解析统一错误格式
if (!response.ok) {
  let detail: string | undefined;
  let code: string | undefined;
  try {
    const body = await response.json();
    // 新统一格式
    if (body?.error?.message) {
      detail = body.error.message;
      code = body.error.code;
    }
    // 旧格式兼容
    else if (typeof body?.detail === "string") {
      detail = body.detail;
    }
  } catch {}
  throw new ApiError(detail ?? `Request failed (${response.status})`, response.status, detail, code);
}
```

- [ ] Step 1: 更新 ApiError 类添加 `code` 字段
- [ ] Step 2: 更新 apiFetch 错误解析逻辑
- [ ] Step 3: Commit

---

## Phase 2：Settings 页面 Form State 迁移 + 列表虚拟化

### Task 2.1：迁移 embedding-settings-page（最简单，建立模式）

**Files:**
- Modify: `frontend/src/components/workspace/settings/embedding-settings-page.tsx`（422 行, 17 useState）

**迁移模式：**
```typescript
// Before: 17 个独立 useState
const [provider, setProvider] = useState<string>("local");
const [modelName, setModelName] = useState<string>("");
const [apiBase, setApiBase] = useState<string>("");
// ... 14 more

// After: react-hook-form + zod schema
const schema = z.object({
  provider: z.enum(["local", "openai", "custom"]),
  modelName: z.string().min(1),
  apiBase: z.string().url().optional(),
  // ... all fields with validation
});

const form = useForm({
  resolver: zodResolver(schema),
  defaultValues: loadedData,
});
```

- [ ] Step 1: 定义 zod schema（包含所有表单字段）
- [ ] Step 2: 替换 useState → useForm
- [ ] Step 3: 替换手动 onChange → form.register / Controller
- [ ] Step 4: 替换手动提交 → form.handleSubmit
- [ ] Step 5: TypeScript 类型检查
- [ ] Step 6: Commit

### Task 2.2：迁移 search-settings-page（1978 行）

同 Task 2.1 模式。这个页面最大，需要先拆分再迁移：

- [ ] Step 1: 将页面拆分为 3 个子组件（搜索引擎设置、结果配置、高级选项）
- [ ] Step 2: 为每个子组件定义 zod schema
- [ ] Step 3: 迁移 form state
- [ ] Step 4: Commit

### Task 2.3：迁移 mcp-servers-page（1738 行, 28 useState）

- [ ] Step 1-4: 同上模式

### Task 2.4：迁移 retrieval-settings-page（1538 行, 20 useState）

- [ ] Step 1-4: 同上模式

### Task 2.5：迁移 cli-tools-page（1276 行, 17 useState）

- [ ] Step 1-4: 同上模式

### Task 2.6：引入列表虚拟化

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/src/components/workspace/messages/` (消息列表)
- Modify: `frontend/src/components/workspace/recent-chat-list.tsx` (聊天历史列表)

```bash
pnpm add @tanstack/react-virtual
```

**消息列表虚拟化** — 这是性能最关键的位置，长对话可能有数百条消息：

```typescript
import { useVirtualizer } from "@tanstack/react-virtual";

const virtualizer = useVirtualizer({
  count: messages.length,
  getScrollElement: () => scrollRef.current,
  estimateSize: () => 120, // 预估消息高度
  overscan: 5,
});
```

- [ ] Step 1: 安装 @tanstack/react-virtual
- [ ] Step 2: 在消息列表中实现虚拟化
- [ ] Step 3: 在聊天历史列表中实现虚拟化
- [ ] Step 4: 手动测试滚动行为
- [ ] Step 5: Commit

---

## Phase 3：前端测试 + 大文件拆分

### Task 3.1：搭建 Playwright E2E 测试框架

**Files:**
- Modify: `frontend/package.json`
- Create: `frontend/playwright.config.ts`
- Create: `frontend/e2e/chat.spec.ts`
- Create: `frontend/e2e/settings.spec.ts`
- Create: `frontend/e2e/agents.spec.ts`

```bash
pnpm add -D @playwright/test
npx playwright install
```

```typescript
// frontend/playwright.config.ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
  },
  use: {
    baseURL: "http://localhost:3000",
  },
});
```

- [ ] Step 1: 安装 Playwright
- [ ] Step 2: 创建 playwright.config.ts
- [ ] Step 3: 编写 chat.spec.ts（创建对话、发送消息、查看回复）
- [ ] Step 4: 编写 settings.spec.ts（导航到设置页、修改设置、保存）
- [ ] Step 5: 编写 agents.spec.ts（Agent 列表、创建 Agent、编辑配置）
- [ ] Step 6: Commit

### Task 3.2：搭建 Vitest 单元测试框架

**Files:**
- Modify: `frontend/package.json`
- Create: `frontend/vitest.config.ts`
- Create: `frontend/src/core/api/__tests__/fetch.test.ts`
- Create: `frontend/src/core/agents/__tests__/query-keys.test.ts`
- Create: `frontend/src/core/messages/__tests__/utils.test.ts`

```bash
pnpm add -D vitest @testing-library/react @testing-library/jest-dom jsdom
```

```typescript
// frontend/vitest.config.ts
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
});
```

- [ ] Step 1: 安装 Vitest + Testing Library
- [ ] Step 2: 创建 vitest.config.ts
- [ ] Step 3: 为 apiFetch 编写测试（成功、失败、网络错误）
- [ ] Step 4: 为 agentKeys 编写测试（key 格式正确性）
- [ ] Step 5: 为 messages/utils 编写测试（groupMessages、extractText）
- [ ] Step 6: 在 package.json 添加 `"test": "vitest"` 命令
- [ ] Step 7: Commit

### Task 3.3：拆分 plugin-assistant page（2118 行）

**Files:**
- Create: `frontend/src/app/workspace/plugins/assistant/utils.ts`
- Create: `frontend/src/app/workspace/plugins/assistant/material-tree.tsx`
- Create: `frontend/src/app/workspace/plugins/assistant/plugin-preview.tsx`
- Modify: `frontend/src/app/workspace/plugins/assistant/page.tsx`

- [ ] Step 1: 提取 utils（12 个纯函数）
- [ ] Step 2: 提取 MaterialTree 组件
- [ ] Step 3: 提取 PluginPreview 组件
- [ ] Step 4: TypeScript 类型检查
- [ ] Step 5: Commit

### Task 3.4：拆分 channel-settings-page（1549 行）

- [ ] Step 1-4: 同上模式

### Task 3.5：迁移剩余 API 模块到 apiFetch

当前覆盖率极低：仅 13 处使用 `apiFetch`，~100+ 处仍用 raw `fetch()`。这是前端最大的一致性问题。

每个 API 模块需独立重复实现错误处理，例如：
- `core/agents/api.ts` 有本地 `readApiError()` 辅助函数
- `core/memory/api.ts` 有本地 `toErrorMessage()` 辅助函数
- `core/channels/api.ts` 有内联错误解析

**重点迁移清单（按模块大小排序）：**
1. `core/agents/api.ts` + `editor-api.ts` + `evolution-api.ts` + `heartbeat-api.ts` + `settings-api.ts`（~33 处）
2. `core/cli/api.ts`（~15 处）
3. `core/memory/api.ts`（~12 处，注意消除 `as unknown as X` 双重转换）
4. `core/retrieval-models/api.ts`（~12 处）
5. `core/scheduler/api.ts`（~10 处）
6. `core/mcp/api.ts`（~10 处）
7. `core/workbench/marketplace.ts` + `sdk.ts` + `loader.ts`（~32 处）
8. `core/config-center/api.ts`（~5 处）
9. `core/channels/api.ts` + `core/uploads/api.ts` + `core/artifacts/api.ts` + 其他（~10 处）

- [ ] Step 1: 批量迁移 agents 系列（每 3 个文件一个 commit）
- [ ] Step 2: 批量迁移 cli + memory + retrieval-models
- [ ] Step 3: 批量迁移 scheduler + mcp + workbench
- [ ] Step 4: 批量迁移剩余模块
- [ ] Step 5: 消除 memory/api.ts 中的 3 个 `as unknown as X` 双重转换
- [ ] Step 6: TypeScript 类型检查
- [ ] Step 7: 验证无遗漏：`grep -rn 'fetch(' --include='*.ts' src/core/ | grep -v 'apiFetch'` 应为空

### Task 3.6：i18n 硬编码中文清理（414 处）

**严重度:** HIGH — 英文用户在 16 个页面看到中文

**重点文件（按严重度排序）：**
1. `settings/cli-tools-page.tsx`（86 处）— 移除 `FALLBACK_COPY`，迁移到 `locales/zh-CN.ts`
2. `settings/mcp-servers-page.tsx`（82 处）— 同上
3. `app/workspace/plugins/assistant/page.tsx`（70 处）
4. `settings/search-settings-page.tsx`（60 处）
5. `settings/embedding-settings-page.tsx`（46 处）
6. `messages/a2ui-card.tsx`（14 处）— 完全无 i18n 集成
7. `messages/cli-interactive-card.tsx`（14 处）
8. `agents/settings/scheduler-settings.tsx`（14 处）
9. 其余 8 个文件（~28 处）

**迁移模式：**
```typescript
// Before:
<span>保存成功</span>

// After:
<span>{t.common.saveSuccess}</span>

// 在 locales/types.ts 添加键
// 在 locales/en-US.ts 添加 "Saved successfully"
// 在 locales/zh-CN.ts 添加 "保存成功"
```

- [ ] Step 1: 迁移 cli-tools-page + mcp-servers-page（移除 FALLBACK_COPY 反模式）
- [ ] Step 2: 迁移 plugin-assistant + search-settings + embedding-settings
- [ ] Step 3: 迁移 a2ui-card + cli-interactive-card + scheduler-settings
- [ ] Step 4: 迁移剩余文件
- [ ] Step 5: 验证：`grep -rn '[\\u4e00-\\u9fff]' --include='*.tsx' src/ | grep -v 'i18n\\|locales' | wc -l` 应为 0
- [ ] Step 6: Commit

---

## 注意事项

1. **API 格式协调**：Phase 1 Task 1.3 依赖 DEV1 完成统一响应格式，如果 DEV1 未完成，先做兼容处理
2. **form 迁移风险**：Settings 页面是用户频繁使用的，迁移后必须手动测试每个表单的保存/重置行为
3. **虚拟化兼容**：消息列表虚拟化需要注意自动滚动到底部、动态高度消息的处理
4. **测试环境**：E2E 测试需要后端服务运行，可以用 mock server 或者依赖 `make dev`
5. **不要动 ui/ 和 ai-elements/**：这些是 shadcn 生成的，由注册表管理
