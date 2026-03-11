# Phase 2: Agent 切换器组件实施计划

**创建日期**: 2026-03-10
**目标**: 实现全局 Agent 切换器，支持快速切换当前工作的 Agent

---

## Phase 0: 文档发现总结

### 现有 Agent 资源

**useAgents() Hook**（已存在）:
```typescript
// 位置：/frontend/src/core/agents/hooks.ts
export function useAgents() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["agents"],
    queryFn: () => listAgents(),
  });
  return { agents: data ?? [], isLoading, error };
}
```

**Agent 类型定义**（已存在）:
```typescript
// 位置：/frontend/src/core/agents/types.ts
export interface Agent {
  name: string;
  description: string;
  model: string | null;
  tool_groups: string[] | null;
  soul?: string | null;
}
```

### Jotai 状态管理

**发现**: Jotai 已安装（v2.18.0）但未使用

**标准使用模式**:
```typescript
// 创建 atom
import { atom } from 'jotai';
export const currentAgentAtom = atom<string>('_default');

// 使用 atom
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
const [currentAgent, setCurrentAgent] = useAtom(currentAgentAtom);
```

### UI 组件推荐

**推荐**: Popover + Command 组合（而非 Select）

**理由**:
1. 支持搜索功能（Agent 数量增多时必需）
2. 可添加自定义操作（"创建新 Agent"按钮）
3. 项目先例（Model Selector 已使用此模式）
4. 更灵活的布局和样式定制

**参考实现**: `/frontend/src/components/ai-elements/model-selector.tsx`

### Workspace Layout 结构

**Layout 路径**: `/frontend/src/app/workspace/layout.tsx`

**侧边栏结构**:
```
WorkspaceSidebar
├── SidebarHeader
│   └── WorkspaceHeader (顶部导航栏)
├── SidebarContent
│   ├── WorkspaceSidebarPrimaryAction (新建聊天按钮)
│   ├── WorkspaceNavChatList (主导航菜单)
│   └── RecentChatList (最近聊天列表)
└── SidebarFooter
    └── WorkspaceNavMenu (设置菜单)
```

**集成位置**: 在 SidebarHeader 的 WorkspaceHeader 中添加 Agent 切换器

---

## Phase 1: 创建 Jotai Atom 定义

### 目标
创建全局状态管理，存储当前选中的 Agent

### 实施步骤

**1.1 创建 `frontend/src/core/agents/current-agent-atom.ts`**

```typescript
import { atom } from "jotai";

/**
 * 当前选中的 Agent 名称
 * 默认值为 "_default"（系统默认 Agent）
 */
export const currentAgentAtom = atom<string>("_default");
```

### 验证清单
- [ ] 文件已创建
- [ ] atom 导出正确
- [ ] 默认值为 "_default"

---

## Phase 2: 创建 Agent 切换器组件

### 目标
创建 Agent 切换器组件，使用 Popover + Command 模式

### 实施步骤

**2.1 创建 `frontend/src/components/workspace/agents/agent-switcher.tsx`**

```typescript
"use client";

import { BotIcon, CheckIcon, PlusIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAtom } from "jotai";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useAgents } from "@/core/agents";
import { currentAgentAtom } from "@/core/agents/current-agent-atom";
import { cn } from "@/lib/utils";

export function AgentSwitcher() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { agents, isLoading } = useAgents();
  const [currentAgent, setCurrentAgent] = useAtom(currentAgentAtom);

  const currentAgentData = agents.find((a) => a.name === currentAgent);

  const handleSelectAgent = (agentName: string) => {
    setCurrentAgent(agentName);
    setOpen(false);
  };

  const handleCreateNew = () => {
    router.push("/workspace/agents/new");
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-full justify-start gap-2 px-2"
          disabled={isLoading}
        >
          <BotIcon className="h-4 w-4 shrink-0" />
          <span className="truncate text-sm">
            {currentAgentData?.name || currentAgent}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search agents..." />
          <CommandList>
            <CommandEmpty>No agents found.</CommandEmpty>
            <CommandGroup>
              {agents.map((agent) => (
                <CommandItem
                  key={agent.name}
                  value={agent.name}
                  onSelect={() => handleSelectAgent(agent.name)}
                >
                  <div className="flex flex-1 items-center gap-2">
                    <BotIcon className="h-4 w-4 shrink-0" />
                    <div className="flex-1 overflow-hidden">
                      <div className="truncate text-sm font-medium">
                        {agent.name}
                        {agent.name === "_default" && (
                          <span className="text-muted-foreground ml-1 text-xs">
                            (Default)
                          </span>
                        )}
                      </div>
                      {agent.description && (
                        <div className="text-muted-foreground truncate text-xs">
                          {agent.description}
                        </div>
                      )}
                    </div>
                  </div>
                  {currentAgent === agent.name && (
                    <CheckIcon className="h-4 w-4 shrink-0" />
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup>
              <CommandItem onSelect={handleCreateNew}>
                <PlusIcon className="mr-2 h-4 w-4" />
                <span>Create New Agent</span>
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
```

### 验证清单
- [ ] 组件正确导入所有依赖
- [ ] 使用 useAtom 管理当前 Agent 状态
- [ ] 使用 useAgents() 获取 Agent 列表
- [ ] Popover + Command 结构正确
- [ ] 支持搜索功能
- [ ] 当前 Agent 有 CheckIcon 标识
- [ ] "_default" Agent 有特殊标识
- [ ] "Create New Agent" 按钮导航正确

---

## Phase 3: 集成到 Workspace Layout

### 目标
将 Agent 切换器添加到 Workspace 侧边栏的 Header 中

### 实施步骤

**3.1 修改 `frontend/src/components/workspace/workspace-header.tsx`**

在 WorkspaceHeader 组件中添加 Agent 切换器：

```typescript
import { AgentSwitcher } from "./agents/agent-switcher";

// 在 WorkspaceHeader 组件中添加
<div className="flex items-center gap-2">
  <SidebarTrigger />
  <div className="flex-1">
    <AgentSwitcher />
  </div>
</div>
```

**具体修改位置**：
- 读取 workspace-header.tsx 文件
- 找到 SidebarTrigger 的位置
- 在其旁边添加 AgentSwitcher 组件
- 确保布局合理（使用 flex 布局）

### 验证清单
- [ ] AgentSwitcher 已导入
- [ ] 组件已添加到 WorkspaceHeader
- [ ] 布局正确（不影响现有元素）
- [ ] 响应式设计正常（移动端和桌面端）

---

## Phase 4: 添加 Jotai Provider

### 目标
在 app 根组件中添加 Jotai Provider（如果还没有）

### 实施步骤

**4.1 检查 `frontend/src/app/workspace/layout.tsx`**

检查是否已有 Jotai Provider，如果没有则添加：

```typescript
import { Provider as JotaiProvider } from "jotai";

// 在 layout 中包装
<JotaiProvider>
  <QueryClientProvider client={queryClient}>
    {/* 现有内容 */}
  </QueryClientProvider>
</JotaiProvider>
```

**注意**: 如果项目中已有其他全局 Provider，确保 JotaiProvider 在最外层。

### 验证清单
- [ ] 检查是否已有 Jotai Provider
- [ ] 如果没有，添加 Provider
- [ ] Provider 层级正确

---

## Phase 5: 最终验证

### 验证清单

**功能验证**:
- [ ] Agent 切换器正确显示在侧边栏 Header 中
- [ ] 点击切换器打开下拉菜单
- [ ] 下拉菜单显示所有 Agent 列表
- [ ] 搜索功能正常工作
- [ ] 当前 Agent 有 CheckIcon 标识
- [ ] "_default" Agent 有 "(Default)" 标识
- [ ] 点击 Agent 可以切换当前 Agent
- [ ] 点击 "Create New Agent" 导航到创建页面
- [ ] 切换 Agent 后，currentAgentAtom 状态更新

**UI/UX 验证**:
- [ ] 加载状态正确显示
- [ ] 组件样式与现有设计一致
- [ ] 响应式布局正常（移动端和桌面端）
- [ ] 键盘导航正常（Command 组件提供）
- [ ] 无 console 警告或错误

**代码质量验证**:
- [ ] TypeScript 类型检查通过（`pnpm typecheck`）
- [ ] ESLint 检查通过（`pnpm lint`）
- [ ] Import 顺序正确
- [ ] 代码格式正确

---

## 反模式防护

**禁止的操作**:
- ❌ 不要使用 Select 组件（应使用 Popover + Command）
- ❌ 不要使用 React Context 管理状态（应使用 Jotai atom）
- ❌ 不要在组件内部创建 atom（应在单独文件中定义）
- ❌ 不要忘记添加 Jotai Provider
- ❌ 不要硬编码 Agent 列表（应使用 useAgents() hook）

**必须遵循的模式**:
- ✅ 使用 Jotai atom 管理全局状态
- ✅ 使用 Popover + Command 组合创建下拉选择器
- ✅ 使用 useAgents() hook 获取 Agent 列表
- ✅ 使用 useAtom() hook 读写 atom 状态
- ✅ 遵循项目的 import 顺序规则
- ✅ 使用 Shadcn UI 组件和 Tailwind CSS

---

## 文件清单

**新建文件**:
1. `frontend/src/core/agents/current-agent-atom.ts` - Jotai atom 定义
2. `frontend/src/components/workspace/agents/agent-switcher.tsx` - Agent 切换器组件

**修改文件**:
1. `frontend/src/components/workspace/workspace-header.tsx` - 添加 Agent 切换器
2. `frontend/src/app/workspace/layout.tsx` - 添加 Jotai Provider（如果需要）

**总计**: 2 个新文件，1-2 个修改文件

---

## 预计工作量

- Phase 1: Jotai atom 定义 - 5 分钟
- Phase 2: Agent 切换器组件 - 30 分钟
- Phase 3: 集成到 Layout - 15 分钟
- Phase 4: 添加 Provider - 10 分钟
- Phase 5: 验证和调试 - 10 分钟

**总计**: 约 70 分钟

---

## 下一步

执行此计划后，使用 `/claude-mem:do` 命令开始实施。
