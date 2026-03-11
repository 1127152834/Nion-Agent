# Phase 1: Agent 设置页实施计划

**创建日期**: 2026-03-10
**目标**: 实现 `/workspace/agents/[agent_name]/settings` 页面，支持 Heartbeat 和 Evolution 配置

---

## Phase 0: 文档发现总结

### 前端架构发现

**现有 Agent 页面结构**:
- `/workspace/agents/` - Agent 列表页 (AgentGallery)
- `/workspace/agents/new` - 创建页（对话式创建）
- `/workspace/agents/[agent_name]/chats/[thread_id]` - 聊天页

**现有 Agent 组件**:
- `AgentCard` - Agent 卡片组件
- `AgentGallery` - Agent 列表组件
- `DeleteAgentDialog` - 删除确认对话框

**目录结构规范**:
```
frontend/src/
├── app/workspace/agents/[agent_name]/
│   └── chats/[thread_id]/page.tsx
├── components/workspace/agents/
│   ├── agent-card.tsx
│   └── agent-gallery.tsx
└── core/agents/
    ├── api.ts
    ├── hooks.ts
    └── types.ts
```

### 后端 API 数据结构

**HeartbeatSettings**:
```typescript
interface HeartbeatSettings {
  enabled: boolean;           // 默认: true
  timezone: string;           // 默认: "UTC"
  templates: Record<string, TemplateConfig>;
}

interface TemplateConfig {
  template_id: string;
  enabled: boolean;           // 默认: true
  cron: string;               // Cron 表达式
  generate_reminder: boolean; // 默认: false
  generate_log: boolean;      // 默认: true
  auto_execute: boolean;      // 默认: true
}
```

**EvolutionSettings**:
```typescript
interface EvolutionSettings {
  enabled: boolean;           // 默认: true
  interval_hours: number;     // 默认: 24
  auto_trigger: boolean;      // 默认: false
}
```

**API 端点**:
- `GET /api/heartbeat/settings?agent_name={name}` → HeartbeatSettings
- `PUT /api/heartbeat/settings?agent_name={name}` → HeartbeatSettings
- `GET /api/evolution/settings?agent_name={name}` → EvolutionSettings
- `PUT /api/evolution/settings?agent_name={name}` → EvolutionSettings

### UI 组件模式

**Tabs 组件**:
```tsx
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"

<Tabs defaultValue="heartbeat">
  <TabsList variant="line">
    <TabsTrigger value="heartbeat">Heartbeat</TabsTrigger>
    <TabsTrigger value="evolution">Evolution</TabsTrigger>
  </TabsList>
  <TabsContent value="heartbeat">{/* 内容 */}</TabsContent>
  <TabsContent value="evolution">{/* 内容 */}</TabsContent>
</Tabs>
```

**Form 组件**:
```tsx
import { Switch } from "@/components/ui/switch"
import { Input } from "@/components/ui/input"
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select"

<Switch checked={enabled} onCheckedChange={setEnabled} />
<Input type="text" value={value} onChange={(e) => setValue(e.target.value)} />
<Select value={value} onValueChange={setValue}>
  <SelectTrigger><SelectValue /></SelectTrigger>
  <SelectContent>
    <SelectItem value="option1">Option 1</SelectItem>
  </SelectContent>
</Select>
```

**Toast 通知**:
```tsx
import { toast } from "sonner"

toast.success("保存成功")
toast.error("保存失败")
```

### React Query Hooks 模式

**useQuery 模式**:
```tsx
export function useHeartbeatSettings(agentName: string) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["heartbeat", "settings", agentName],
    queryFn: () => getHeartbeatSettings(agentName),
  });
  return { settings: data ?? null, isLoading, error };
}
```

**useMutation 模式**:
```tsx
export function useUpdateHeartbeatSettings(agentName: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (settings: HeartbeatSettings) =>
      updateHeartbeatSettings(agentName, settings),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["heartbeat", "settings", agentName]
      });
      toast.success("设置已保存");
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });
}
```

**API 调用模式**:
```tsx
import { getBackendBaseURL } from "@/core/config";

export async function getHeartbeatSettings(agentName: string): Promise<HeartbeatSettings> {
  const res = await fetch(
    `${getBackendBaseURL()}/api/heartbeat/settings?agent_name=${agentName}`
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { detail?: string };
    throw new Error(err.detail ?? `Failed to load settings: ${res.statusText}`);
  }
  return res.json();
}
```

---

## Phase 1: 创建类型定义

### 目标
创建 TypeScript 类型定义，匹配后端数据结构

### 实施步骤

**1.1 创建 `frontend/src/core/agents/settings-types.ts`**

```typescript
// Heartbeat Types
export interface TemplateConfig {
  template_id: string;
  enabled: boolean;
  cron: string;
  generate_reminder: boolean;
  generate_log: boolean;
  auto_execute: boolean;
}

export interface HeartbeatSettings {
  enabled: boolean;
  timezone: string;
  templates: Record<string, TemplateConfig>;
}

// Evolution Types
export interface EvolutionSettings {
  enabled: boolean;
  interval_hours: number;
  auto_trigger: boolean;
}
```

### 验证清单
- [ ] 类型定义与后端 Pydantic 模型完全匹配
- [ ] 所有字段都有正确的类型注解
- [ ] 导出所有必要的类型

---

## Phase 2: 创建 API 函数

### 目标
实现与后端通信的 API 函数

### 实施步骤

**2.1 创建 `frontend/src/core/agents/settings-api.ts`**

```typescript
import { getBackendBaseURL } from "@/core/config";
import type { HeartbeatSettings, EvolutionSettings } from "./settings-types";

// Heartbeat API
export async function getHeartbeatSettings(agentName: string): Promise<HeartbeatSettings> {
  const res = await fetch(
    `${getBackendBaseURL()}/api/heartbeat/settings?agent_name=${encodeURIComponent(agentName)}`
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { detail?: string };
    throw new Error(err.detail ?? `Failed to load heartbeat settings: ${res.statusText}`);
  }
  return res.json();
}

export async function updateHeartbeatSettings(
  agentName: string,
  settings: HeartbeatSettings
): Promise<HeartbeatSettings> {
  const res = await fetch(
    `${getBackendBaseURL()}/api/heartbeat/settings?agent_name=${encodeURIComponent(agentName)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { detail?: string };
    throw new Error(err.detail ?? `Failed to update heartbeat settings: ${res.statusText}`);
  }
  return res.json();
}

// Evolution API
export async function getEvolutionSettings(agentName: string): Promise<EvolutionSettings> {
  const res = await fetch(
    `${getBackendBaseURL()}/api/evolution/settings?agent_name=${encodeURIComponent(agentName)}`
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { detail?: string };
    throw new Error(err.detail ?? `Failed to load evolution settings: ${res.statusText}`);
  }
  return res.json();
}

export async function updateEvolutionSettings(
  agentName: string,
  settings: EvolutionSettings
): Promise<EvolutionSettings> {
  const res = await fetch(
    `${getBackendBaseURL()}/api/evolution/settings?agent_name=${encodeURIComponent(agentName)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { detail?: string };
    throw new Error(err.detail ?? `Failed to update evolution settings: ${res.statusText}`);
  }
  return res.json();
}
```

### 验证清单
- [ ] 所有 API 函数都正确处理错误（提取 detail 字段）
- [ ] URL 参数正确编码（使用 encodeURIComponent）
- [ ] HTTP 方法和 headers 正确设置
- [ ] 返回类型与 TypeScript 类型定义匹配

---

## Phase 3: 创建 React Query Hooks

### 目标
创建 React Query hooks 用于数据获取和更新

### 实施步骤

**3.1 创建 `frontend/src/core/agents/settings-hooks.ts`**

```typescript
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  getHeartbeatSettings,
  updateHeartbeatSettings,
  getEvolutionSettings,
  updateEvolutionSettings,
} from "./settings-api";
import type { HeartbeatSettings, EvolutionSettings } from "./settings-types";

// Heartbeat Hooks
export function useHeartbeatSettings(agentName: string) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["heartbeat", "settings", agentName],
    queryFn: () => getHeartbeatSettings(agentName),
  });
  return { settings: data ?? null, isLoading, error };
}

export function useUpdateHeartbeatSettings(agentName: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (settings: HeartbeatSettings) =>
      updateHeartbeatSettings(agentName, settings),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["heartbeat", "settings", agentName],
      });
      toast.success("Heartbeat 设置已保存");
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });
}

// Evolution Hooks
export function useEvolutionSettings(agentName: string) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["evolution", "settings", agentName],
    queryFn: () => getEvolutionSettings(agentName),
  });
  return { settings: data ?? null, isLoading, error };
}

export function useUpdateEvolutionSettings(agentName: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (settings: EvolutionSettings) =>
      updateEvolutionSettings(agentName, settings),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["evolution", "settings", agentName],
      });
      toast.success("Evolution 设置已保存");
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });
}
```

### 验证清单
- [ ] QueryKey 遵循项目约定（数组形式，包含 agentName）
- [ ] Mutation 成功后正确 invalidate queries
- [ ] Toast 通知正确显示（成功和失败）
- [ ] 错误处理正确（显示错误消息）

---

## Phase 4: 创建 Heartbeat 设置组件

### 目标
创建 Heartbeat 配置表单组件

### 实施步骤

**4.1 创建 `frontend/src/components/workspace/agents/settings/heartbeat-settings.tsx`**

```typescript
"use client";

import { useState, useEffect } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { useHeartbeatSettings, useUpdateHeartbeatSettings } from "@/core/agents/settings-hooks";
import type { HeartbeatSettings } from "@/core/agents/settings-types";

interface HeartbeatSettingsProps {
  agentName: string;
}

export function HeartbeatSettingsComponent({ agentName }: HeartbeatSettingsProps) {
  const { settings, isLoading } = useHeartbeatSettings(agentName);
  const updateMutation = useUpdateHeartbeatSettings(agentName);

  const [formData, setFormData] = useState<HeartbeatSettings | null>(null);

  useEffect(() => {
    if (settings) {
      setFormData(settings);
    }
  }, [settings]);

  const handleSave = () => {
    if (!formData) return;
    updateMutation.mutate(formData);
  };

  if (isLoading) {
    return <div className="text-muted-foreground text-sm">加载中...</div>;
  }

  if (!formData) {
    return <div className="text-muted-foreground text-sm">无法加载设置</div>;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Heartbeat 设置</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Enable Switch */}
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium">启用 Heartbeat</label>
            <Switch
              checked={formData.enabled}
              onCheckedChange={(checked) =>
                setFormData({ ...formData, enabled: checked })
              }
            />
          </div>

          {/* Timezone Select */}
          <div className="space-y-2">
            <label className="text-sm font-medium">时区</label>
            <Select
              value={formData.timezone}
              onValueChange={(value) =>
                setFormData({ ...formData, timezone: value })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="UTC">UTC</SelectItem>
                <SelectItem value="Asia/Shanghai">Asia/Shanghai</SelectItem>
                <SelectItem value="America/New_York">America/New_York</SelectItem>
                <SelectItem value="Europe/London">Europe/London</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Templates Section */}
          <div className="space-y-2">
            <label className="text-sm font-medium">模板配置</label>
            <div className="text-muted-foreground text-xs">
              模板配置功能将在后续版本中添加
            </div>
          </div>

          {/* Save Button */}
          <Button
            onClick={handleSave}
            disabled={updateMutation.isPending}
            className="w-full"
          >
            {updateMutation.isPending ? "保存中..." : "保存设置"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
```

### 验证清单
- [ ] 组件正确加载和显示设置
- [ ] Switch 和 Select 组件正确工作
- [ ] 保存按钮正确触发 mutation
- [ ] 加载状态正确显示
- [ ] 错误状态正确处理

---

## Phase 5: 创建 Evolution 设置组件

### 目标
创建 Evolution 配置表单组件

### 实施步骤

**5.1 创建 `frontend/src/components/workspace/agents/settings/evolution-settings.tsx`**

```typescript
"use client";

import { useState, useEffect } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useEvolutionSettings, useUpdateEvolutionSettings } from "@/core/agents/settings-hooks";
import type { EvolutionSettings } from "@/core/agents/settings-types";

interface EvolutionSettingsProps {
  agentName: string;
}

export function EvolutionSettingsComponent({ agentName }: EvolutionSettingsProps) {
  const { settings, isLoading } = useEvolutionSettings(agentName);
  const updateMutation = useUpdateEvolutionSettings(agentName);

  const [formData, setFormData] = useState<EvolutionSettings | null>(null);

  useEffect(() => {
    if (settings) {
      setFormData(settings);
    }
  }, [settings]);

  const handleSave = () => {
    if (!formData) return;
    updateMutation.mutate(formData);
  };

  if (isLoading) {
    return <div className="text-muted-foreground text-sm">加载中...</div>;
  }

  if (!formData) {
    return <div className="text-muted-foreground text-sm">无法加载设置</div>;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Evolution 设置</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Enable Switch */}
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium">启用 Evolution</label>
            <Switch
              checked={formData.enabled}
              onCheckedChange={(checked) =>
                setFormData({ ...formData, enabled: checked })
              }
            />
          </div>

          {/* Interval Hours Input */}
          <div className="space-y-2">
            <label className="text-sm font-medium">分析间隔（小时）</label>
            <Input
              type="number"
              min="1"
              value={formData.interval_hours}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  interval_hours: parseInt(e.target.value, 10) || 24,
                })
              }
            />
          </div>

          {/* Auto Trigger Switch */}
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium">自动触发分析</label>
            <Switch
              checked={formData.auto_trigger}
              onCheckedChange={(checked) =>
                setFormData({ ...formData, auto_trigger: checked })
              }
            />
          </div>

          {/* Save Button */}
          <Button
            onClick={handleSave}
            disabled={updateMutation.isPending}
            className="w-full"
          >
            {updateMutation.isPending ? "保存中..." : "保存设置"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
```

### 验证清单
- [ ] 组件正确加载和显示设置
- [ ] Switch 和 Input 组件正确工作
- [ ] 数字输入验证正确（最小值 1）
- [ ] 保存按钮正确触发 mutation
- [ ] 加载状态正确显示

---

## Phase 6: 创建设置页面

### 目标
创建主设置页面，集成 Tabs 和设置组件

### 实施步骤

**6.1 创建 `frontend/src/app/workspace/agents/[agent_name]/settings/page.tsx`**

```typescript
"use client";

import { use } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { HeartbeatSettingsComponent } from "@/components/workspace/agents/settings/heartbeat-settings";
import { EvolutionSettingsComponent } from "@/components/workspace/agents/settings/evolution-settings";

export default function AgentSettingsPage({
  params,
}: {
  params: Promise<{ agent_name: string }>;
}) {
  const { agent_name } = use(params);
  const router = useRouter();

  return (
    <div className="flex size-full flex-col">
      {/* Header */}
      <header className="flex shrink-0 items-center gap-3 border-b px-4 py-3">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => router.push("/workspace/agents")}
        >
          <ArrowLeftIcon className="h-4 w-4" />
        </Button>
        <h1 className="text-sm font-semibold">
          Agent 设置: {decodeURIComponent(agent_name)}
        </h1>
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-3xl">
          <Tabs defaultValue="heartbeat">
            <TabsList variant="line" className="mb-6">
              <TabsTrigger value="heartbeat">Heartbeat</TabsTrigger>
              <TabsTrigger value="evolution">Evolution</TabsTrigger>
            </TabsList>

            <TabsContent value="heartbeat">
              <HeartbeatSettingsComponent agentName={agent_name} />
            </TabsContent>

            <TabsContent value="evolution">
              <EvolutionSettingsComponent agentName={agent_name} />
            </TabsContent>
          </Tabs>
        </div>
      </main>
    </div>
  );
}
```

### 验证清单
- [ ] 页面路由正确（`/workspace/agents/[agent_name]/settings`）
- [ ] Header 正确显示 agent 名称（解码 URL 编码）
- [ ] 返回按钮正确导航到 Agent 列表页
- [ ] Tabs 正确切换内容
- [ ] 两个设置组件正确渲染

---

## Phase 7: 添加导航入口

### 目标
在 AgentCard 组件中添加设置按钮

### 实施步骤

**7.1 修改 `frontend/src/components/workspace/agents/agent-card.tsx`**

在 CardFooter 中添加设置按钮：

```typescript
import { SettingsIcon } from "lucide-react";

// 在 CardFooter 中添加
<Button
  size="icon"
  variant="ghost"
  className="h-8 w-8 shrink-0"
  onClick={() => router.push(`/workspace/agents/${agent.name}/settings`)}
  title="设置"
>
  <SettingsIcon className="h-3.5 w-3.5" />
</Button>
```

### 验证清单
- [ ] 设置按钮正确显示在 AgentCard 中
- [ ] 点击设置按钮正确导航到设置页面
- [ ] 按钮样式与现有按钮一致

---

## Phase 8: 最终验证

### 验证清单

**功能验证**:
- [ ] 可以从 Agent 列表页导航到设置页
- [ ] 设置页正确加载 Heartbeat 和 Evolution 设置
- [ ] 可以修改 Heartbeat 设置并保存
- [ ] 可以修改 Evolution 设置并保存
- [ ] 保存成功后显示 Toast 通知
- [ ] 保存失败后显示错误 Toast
- [ ] Tabs 切换正常工作

**UI/UX 验证**:
- [ ] 加载状态正确显示
- [ ] 错误状态正确处理
- [ ] 按钮禁用状态正确（保存中）
- [ ] 表单验证正确（数字输入）
- [ ] 响应式布局正常

**代码质量验证**:
- [ ] TypeScript 类型检查通过（`pnpm typecheck`）
- [ ] ESLint 检查通过（`pnpm lint`）
- [ ] 代码格式正确
- [ ] 无 console 警告或错误

---

## 反模式防护

**禁止的操作**:
- ❌ 不要创建不存在的 API 端点
- ❌ 不要添加后端未支持的字段
- ❌ 不要跳过错误处理
- ❌ 不要使用硬编码的 URL（必须使用 `getBackendBaseURL()`）
- ❌ 不要忘记 URL 编码 agent_name 参数
- ❌ 不要在 mutation 成功后忘记 invalidate queries

**必须遵循的模式**:
- ✅ 所有 API 调用必须提取 `detail` 字段作为错误消息
- ✅ 所有 mutation 必须在 onSuccess 中 invalidate 相关 queries
- ✅ 所有表单必须有加载状态和禁用状态
- ✅ 所有组件必须使用 Shadcn UI 组件
- ✅ 所有样式必须使用 Tailwind CSS

---

## 文件清单

**新建文件**:
1. `frontend/src/core/agents/settings-types.ts` - 类型定义
2. `frontend/src/core/agents/settings-api.ts` - API 函数
3. `frontend/src/core/agents/settings-hooks.ts` - React Query hooks
4. `frontend/src/components/workspace/agents/settings/heartbeat-settings.tsx` - Heartbeat 组件
5. `frontend/src/components/workspace/agents/settings/evolution-settings.tsx` - Evolution 组件
6. `frontend/src/app/workspace/agents/[agent_name]/settings/page.tsx` - 设置页面

**修改文件**:
1. `frontend/src/components/workspace/agents/agent-card.tsx` - 添加设置按钮

**总计**: 6 个新文件，1 个修改文件

---

## 预计工作量

- Phase 1-3: 类型、API、Hooks - 30 分钟
- Phase 4-5: 设置组件 - 45 分钟
- Phase 6-7: 页面和导航 - 30 分钟
- Phase 8: 验证和调试 - 15 分钟

**总计**: 约 2 小时

---

## 下一步

执行此计划后，使用 `/claude-mem:do` 命令开始实施。
