# DEV2：前端核心层重构方案

> **分支**：`arch/dev2-frontend-core`
> **职责范围**：前端状态管理、组件架构、测试框架、性能优化
> **独占目录**：`frontend/src/core/`, `frontend/src/components/`, `frontend/src/app/`, `frontend/src/hooks/`, `frontend/package.json`
> **禁止触碰**：`backend/`, `desktop/`

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

当前还有约 15 个 API 模块使用原始 `fetch()`。逐步迁移：

```bash
# 找出所有还在用 raw fetch 的文件
grep -rn 'fetch(' --include='*.ts' src/core/ | grep -v 'apiFetch\|node_modules\|fetch.ts'
```

- [ ] Step 1: 列出所有未迁移文件
- [ ] Step 2: 批量迁移（每 3 个文件一个 commit）
- [ ] Step 3: TypeScript 类型检查
- [ ] Step 4: Commit

---

## 注意事项

1. **API 格式协调**：Phase 1 Task 1.3 依赖 DEV1 完成统一响应格式，如果 DEV1 未完成，先做兼容处理
2. **form 迁移风险**：Settings 页面是用户频繁使用的，迁移后必须手动测试每个表单的保存/重置行为
3. **虚拟化兼容**：消息列表虚拟化需要注意自动滚动到底部、动态高度消息的处理
4. **测试环境**：E2E 测试需要后端服务运行，可以用 mock server 或者依赖 `make dev`
5. **不要动 ui/ 和 ai-elements/**：这些是 shadcn 生成的，由注册表管理
