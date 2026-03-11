# Phase 3: Agent 内容编辑器实施计划

**创建日期**: 2026-03-10
**目标**: 实现 Agent SOUL.md 和 IDENTITY.md 的编辑功能

---

## Phase 0: 文档发现总结

### 现有 Agent API

**后端端点** (`backend/src/gateway/routers/agents.py`):

| 端点 | 方法 | 描述 |
|------|------|------|
| `/api/agents` | GET | 列出所有自定义 agents |
| `/api/agents/{name}` | GET | 获取 agent 详情 + SOUL.md |
| `/api/agents/{name}` | PUT | 更新 agent 配置 + SOUL.md |
| `/api/default-agent/soul` | GET/PUT | 读写默认 agent SOUL.md |
| `/api/default-agent/identity` | GET/PUT | 读写默认 agent IDENTITY.md |

**发现**: 当前 API 对自定义 agent 没有 IDENTITY.md 的专门端点，需要添加。

### 路径配置

**路径定义** (`backend/src/config/paths.py`):
- SOUL.md: `{agent_dir}/SOUL.md`
- IDENTITY.md: `{agent_dir}/IDENTITY.md`

### 前端模式

**CodeMirror 编辑器** (`frontend/src/components/workspace/code-editor.tsx`):
- 使用 `@uiw/react-codemirror`
- 支持 markdown, python, javascript, json 等
- 支持 dark/light 主题

**Settings API 模式** (`frontend/src/core/agents/settings-api.ts`):
```typescript
// 标准模式
export async function getXxxSettings(agentName: string): Promise<XxxSettings> {
  const res = await fetch(`${getBackendBaseURL()}/api/...`);
  if (!res.ok) throw new Error(...);
  return res.json();
}

export async function updateXxxSettings(agentName: string, data: XxxSettings): Promise<void> {
  const res = await fetch(`${getBackendBaseURL()}/api/...`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(...);
}
```

**Settings Hooks 模式** (`frontend/src/core/agents/settings-hooks.ts`):
```typescript
export function useXxxSettings(agentName: string) {
  return useQuery({
    queryKey: ["xxx", agentName],
    queryFn: () => getXxxSettings(agentName),
  });
}

export function useUpdateXxxSettings(agentName: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: XxxSettings) => updateXxxSettings(agentName, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["xxx", agentName] });
      toast.success("保存成功");
    },
    onError: (error: Error) => toast.error(error.message),
  });
}
```

---

## Phase 1: 添加后端 IDENTITY.md API

### 目标
为自定义 Agent 添加 IDENTITY.md 的读取和更新端点。

### 实施步骤

**1.1 修改 `backend/src/gateway/routers/agents.py`**

添加两个新端点：
- `GET /api/agents/{name}/identity` - 读取 IDENTITY.md
- `PUT /api/agents/{name}/identity` - 更新 IDENTITY.md

```python
@router.get("/agents/{name}/identity")
async def get_agent_identity(name: str) -> dict:
    """Get agent's IDENTITY.md content."""
    paths = get_paths()
    identity_file = paths.agent_identity_file(name)
    if not identity_file.exists():
        return {"content": ""}
    return {"content": identity_file.read_text(encoding="utf-8")}

@router.put("/agents/{name}/identity")
async def update_agent_identity(name: str, body: dict) -> dict:
    """Update agent's IDENTITY.md content."""
    paths = get_paths()
    identity_file = paths.agent_identity_file(name)
    identity_file.parent.mkdir(parents=True, exist_ok=True)
    identity_file.write_text(body.get("content", ""), encoding="utf-8")
    return {"success": True}
```

### 验证清单
- [ ] GET 端点返回 IDENTITY.md 内容
- [ ] PUT 端点保存 IDENTITY.md 内容
- [ ] 错误处理正确（文件不存在时返回空内容）

---

## Phase 2: 创建前端 API 函数

### 目标
创建用于读取和更新 SOUL.md、IDENTITY.md 的 API 函数。

### 实施步骤

**2.1 创建 `frontend/src/core/agents/editor-api.ts`**

```typescript
import { getBackendBaseURL } from "@/core/config";

export async function getAgentSoul(agentName: string): Promise<string> {
  const res = await fetch(
    `${getBackendBaseURL()}/api/agents/${encodeURIComponent(agentName)}`
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { detail?: string };
    throw new Error(err.detail ?? `Failed to load SOUL.md: ${res.statusText}`);
  }
  const data = await res.json();
  return data.soul ?? "";
}

export async function updateAgentSoul(
  agentName: string,
  content: string
): Promise<void> {
  const res = await fetch(
    `${getBackendBaseURL()}/api/agents/${encodeURIComponent(agentName)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ soul: content }),
    }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { detail?: string };
    throw new Error(err.detail ?? `Failed to update SOUL.md: ${res.statusText}`);
  }
}

export async function getAgentIdentity(agentName: string): Promise<string> {
  const res = await fetch(
    `${getBackendBaseURL()}/api/agents/${encodeURIComponent(agentName)}/identity`
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { detail?: string };
    throw new Error(err.detail ?? `Failed to load IDENTITY.md: ${res.statusText}`);
  }
  const data = await res.json();
  return data.content ?? "";
}

export async function updateAgentIdentity(
  agentName: string,
  content: string
): Promise<void> {
  const res = await fetch(
    `${getBackendBaseURL()}/api/agents/${encodeURIComponent(agentName)}/identity`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { detail?: string };
    throw new Error(err.detail ?? `Failed to update IDENTITY.md: ${res.statusText}`);
  }
}
```

### 验证清单
- [ ] API 函数正确导入
- [ ] 错误处理正确
- [ ] 类型定义正确

---

## Phase 3: 创建前端 Hooks

### 目标
创建用于 SOUL.md、IDENTITY.md 管理的 React Query hooks。

### 实施步骤

**3.1 创建 `frontend/src/core/agents/editor-hooks.ts`**

```typescript
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import {
  getAgentIdentity,
  getAgentSoul,
  updateAgentIdentity,
  updateAgentSoul,
} from "./editor-api";

export function useAgentSoul(agentName: string) {
  return useQuery({
    queryKey: ["agent", "soul", agentName],
    queryFn: () => getAgentSoul(agentName),
    staleTime: 30 * 1000,
  });
}

export function useUpdateAgentSoul(agentName: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (content: string) => updateAgentSoul(agentName, content),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agent", "soul", agentName] });
      toast.success("SOUL.md 已保存");
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });
}

export function useAgentIdentity(agentName: string) {
  return useQuery({
    queryKey: ["agent", "identity", agentName],
    queryFn: () => getAgentIdentity(agentName),
    staleTime: 30 * 1000,
  });
}

export function useUpdateAgentIdentity(agentName: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (content: string) => updateAgentIdentity(agentName, content),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agent", "identity", agentName] });
      toast.success("IDENTITY.md 已保存");
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });
}
```

### 验证清单
- [ ] Hooks 正确使用 TanStack Query 模式
- [ ] 缓存失效逻辑正确
- [ ] 成功/错误 toast 正确

---

## Phase 4: 创建编辑器组件

### 目标
创建 SOUL.md 和 IDENTITY.md 的编辑器组件。

### 实施步骤

**4.1 创建 `frontend/src/components/workspace/agents/settings/editor-section.tsx`**

```typescript
"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CodeEditor } from "@/components/workspace/code-editor";
import { useAgentIdentity, useAgentSoul, useUpdateAgentIdentity, useUpdateAgentSoul } from "@/core/agents/editor-hooks";
import { useI18n } from "@/core/i18n/hooks";

interface EditorSectionProps {
  agentName: string;
}

export function SoulEditor({ agentName }: EditorSectionProps) {
  const { t } = useI18n();
  const { data: content, isLoading, error } = useAgentSoul(agentName);
  const updateMutation = useUpdateAgentSoul(agentName);
  const [localContent, setLocalContent] = useState("");
  const [hasChanges, setHasChanges] = useState(false);

  // Sync server data to local state when loaded
  useState(() => {
    if (content !== undefined) {
      setLocalContent(content);
    }
  });

  const handleSave = () => {
    updateMutation.mutate(localContent);
    setHasChanges(false);
  };

  const handleCancel = () => {
    setLocalContent(content ?? "");
    setHasChanges(false);
  };

  if (isLoading) {
    return <Card><CardContent className="py-8">加载中...</CardContent></Card>;
  }

  if (error) {
    return <Card><CardContent className="py-8 text-destructive">无法加载 SOUL.md</CardContent></Card>;
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-base">SOUL.md</CardTitle>
        <div className="flex gap-2">
          {hasChanges && (
            <>
              <Button variant="outline" size="sm" onClick={handleCancel}>
                取消
              </Button>
              <Button size="sm" onClick={handleSave} disabled={updateMutation.isPending}>
                {updateMutation.isPending ? "保存中..." : "保存"}
              </Button>
            </>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <CodeEditor
          value={localContent}
          onChange={(value) => {
            setLocalContent(value);
            setHasChanges(value !== content);
          }}
          language="markdown"
          className="min-h-[400px]"
        />
      </CardContent>
    </Card>
  );
}

export function IdentityEditor({ agentName }: EditorSectionProps) {
  // Similar structure to SoulEditor
  // Uses useAgentIdentity / useUpdateAgentIdentity
}
```

**注意**: 由于 `useState` 在 React 中不能直接接受函数作为初始化器（那是 `useState(() => value)` 的用法），需要使用 `useEffect` 来同步数据。

修正后的实现：

```typescript
"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CodeEditor } from "@/components/workspace/code-editor";
import { useAgentIdentity, useAgentSoul, useUpdateAgentIdentity, useUpdateAgentSoul } from "@/core/agents/editor-hooks";
import { useI18n } from "@/core/i18n/hooks";

interface EditorSectionProps {
  agentName: string;
}

export function SoulEditor({ agentName }: EditorSectionProps) {
  const { t } = useI18n();
  const { data: content, isLoading, error } = useAgentSoul(agentName);
  const updateMutation = useUpdateAgentSoul(agentName);
  const [localContent, setLocalContent] = useState("");
  const [hasChanges, setHasChanges] = useState(false);

  // Sync server data to local state when loaded
  useEffect(() => {
    if (content !== undefined) {
      setLocalContent(content);
    }
  }, [content]);

  const handleSave = () => {
    updateMutation.mutate(localContent);
    setHasChanges(false);
  };

  const handleCancel = () => {
    setLocalContent(content ?? "");
    setHasChanges(false);
  };

  if (isLoading) {
    return <Card><CardContent className="py-8">加载中...</CardContent></Card>;
  }

  if (error) {
    return <Card><CardContent className="py-8 text-destructive">无法加载 SOUL.md</CardContent></Card>;
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
        <CardTitle className="text-base">SOUL.md</CardTitle>
        <div className="flex gap-2">
          {hasChanges && (
            <>
              <Button variant="outline" size="sm" onClick={handleCancel}>
                取消
              </Button>
              <Button size="sm" onClick={handleSave} disabled={updateMutation.isPending}>
                {updateMutation.isPending ? "保存中..." : "保存"}
              </Button>
            </>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <CodeEditor
          value={localContent}
          onChange={(value) => {
            setLocalContent(value);
            setHasChanges(value !== content);
          }}
          language="markdown"
          className="min-h-[400px]"
        />
      </CardContent>
    </Card>
  );
}
```

### 验证清单
- [ ] 组件正确导入 CodeEditor
- [ ] 加载状态正确显示
- [ ] 错误状态正确显示
- [ ] 保存/取消按钮逻辑正确
- [ ] 内容变化检测正确

---

## Phase 5: 集成到 Settings 页面

### 目标
将编辑器组件添加到 Agent Settings 页面。

### 实施步骤

**5.1 修改 `frontend/src/app/workspace/agents/[agent_name]/settings/page.tsx`**

在现有的 Tabs 中添加新的 Tab：

```typescript
import { SoulEditor, IdentityEditor } from "@/components/workspace/agents/settings/editor-section";

// In the Tabs content:
<TabsContent value="soul" className="mt-4 space-y-4">
  <SoulEditor agentName={agentName} />
</TabsContent>
<TabsContent value="identity" className="mt-4 space-y-4">
  <IdentityEditor agentName={agentName} />
</TabsContent>
```

**5.2 更新 Tabs 列表**

```typescript
// 在 tabs 数组中添加:
{ id: "soul", label: "SOUL" },
{ id: "identity", label: "IDENTITY" },
```

### 验证清单
- [ ] 新的 Tab 正确显示
- [ ] 编辑器组件正确加载
- [ ] 保存功能正常工作

---

## Phase 6: 最终验证

### 验证清单

**功能验证**:
- [ ] GET /api/agents/{name}/identity 正确返回内容
- [ ] PUT /api/agents/{name}/identity 正确保存内容
- [ ] 前端 API 函数正确调用
- [ ] React Query hooks 正确管理状态
- [ ] 编辑器正确显示和保存内容

**UI/UX 验证**:
- [ ] 加载状态正确显示
- [ ] 错误状态正确显示
- [ ] 保存按钮显示正确状态
- [ ] 取消按钮正确重置内容
- [ ] CodeMirror 编辑器正常工作

**代码质量验证**:
- [ ] TypeScript 类型检查通过
- [ ] ESLint 检查通过
- [ ] Import 顺序正确
- [ ] 代码格式正确

---

## 反模式防护

**禁止的操作**:
- ❌ 不要直接修改 backend/src/agents/ 目录下的文件
- ❌ 不要使用 localStorage 存储编辑内容（应使用服务端存储）
- ❌ 不要跳过错误处理
- ❌ 不要在组件内部创建 API 函数（应在独立文件中定义）

**必须遵循的模式**:
- ✅ 使用 TanStack Query 管理服务端状态
- ✅ 使用 CodeEditor 组件进行内容编辑
- ✅ 使用 sonner 显示 toast 通知
- ✅ 使用 useEffect 同步服务端数据到本地状态
- ✅ 遵循项目的 import 顺序规则

---

## 文件清单

**新建文件**:
1. `frontend/src/core/agents/editor-api.ts` - API 函数
2. `frontend/src/core/agents/editor-hooks.ts` - React Query hooks
3. `frontend/src/components/workspace/agents/settings/editor-section.tsx` - 编辑器组件

**修改文件**:
1. `backend/src/gateway/routers/agents.py` - 添加 IDENTITY.md 端点
2. `frontend/src/app/workspace/agents/[agent_name]/settings/page.tsx` - 添加 Tab

**总计**: 3 个新文件，2 个修改文件

---

## 预计工作量

- Phase 1: 后端 API - 15 分钟
- Phase 2: 前端 API - 10 分钟
- Phase 3: 前端 Hooks - 10 分钟
- Phase 4: 编辑器组件 - 30 分钟
- Phase 5: 集成到页面 - 15 分钟
- Phase 6: 验证和调试 - 10 分钟

**总计**: 约 90 分钟

---

## 下一步

执行此计划后，使用 `/claude-mem:do` 命令开始实施。
