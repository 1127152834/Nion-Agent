# Phase 4: Heartbeat Logs Viewer 实施计划

**创建日期**: 2026-03-10
**目标**: 实现 Heartbeat 执行日志查看功能

---

## Phase 0: 文档发现总结

### 后端 API 端点

**文件**: `backend/src/gateway/routers/heartbeat.py`

| 端点 | 方法 | 描述 |
|------|------|------|
| `/api/heartbeat/logs` | GET | 获取日志列表 |
| `/api/heartbeat/logs/{log_id}` | GET | 获取单个日志详情 |

**查询参数**:
- `agent_name`: Agent 名称（默认 `_default`）
- `template_id`: 按模板 ID 过滤
- `status`: 按状态过滤
- `limit`: 返回数量（默认 50）
- `offset`: 偏移量

### 日志数据结构

**HeartbeatLogRecord** (`backend/src/heartbeat/models.py`):
```python
class HeartbeatLogRecord(BaseModel):
    id: str
    heartbeat_type: str
    timestamp: datetime
    status: str
    result_type: HeartbeatResultType
    result: dict[str, Any]
    duration_seconds: int
    error_message: str | None = None
    user_visible: bool = True
```

### 前端模式参考

**参考文件**: `frontend/src/components/workspace/scheduler/task-manager.tsx`

- 使用 Card 组件显示日志列表
- 使用 Badge 组件显示状态标签
- 使用 Dialog 显示日志详情
- 状态样式函数: `statusClass(status)` - 返回颜色类名

---

## Phase 1: 创建前端 API 函数

### 目标
创建用于获取 Heartbeat 日志的 API 函数。

### 实施步骤

**1.1 创建 `frontend/src/core/agents/heartbeat-api.ts`**

```typescript
import { getBackendBaseURL } from "@/core/config";

export interface HeartbeatLogRecord {
  id: string;
  heartbeat_type: string;
  timestamp: string;
  status: string;
  result_type: string;
  result: Record<string, unknown>;
  duration_seconds: number;
  error_message: string | null;
  user_visible: boolean;
}

export interface HeartbeatLogsParams {
  agentName: string;
  templateId?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

export async function getHeartbeatLogs(
  params: HeartbeatLogsParams
): Promise<HeartbeatLogRecord[]> {
  const { agentName, templateId, status, limit = 50, offset = 0 } = params;
  const searchParams = new URLSearchParams();
  searchParams.set("agent_name", agentName);
  if (templateId) searchParams.set("template_id", templateId);
  if (status) searchParams.set("status", status);
  searchParams.set("limit", String(limit));
  searchParams.set("offset", String(offset));

  const res = await fetch(
    `${getBackendBaseURL()}/api/heartbeat/logs?${searchParams}`
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { detail?: string };
    throw new Error(err.detail ?? `Failed to load heartbeat logs: ${res.statusText}`);
  }
  return res.json();
}

export async function getHeartbeatLog(
  agentName: string,
  logId: string
): Promise<HeartbeatLogRecord> {
  const res = await fetch(
    `${getBackendBaseURL()}/api/heartbeat/logs/${logId}?agent_name=${encodeURIComponent(agentName)}`
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { detail?: string };
    throw new Error(err.detail ?? `Failed to load heartbeat log: ${res.statusText}`);
  }
  return res.json();
}
```

### 验证清单
- [ ] API 函数正确导入
- [ ] 错误处理正确
- [ ] 类型定义正确

---

## Phase 2: 创建前端 Hooks

### 目标
创建用于获取 Heartbeat 日志的 React Query hooks。

### 实施步骤

**2.1 创建 `frontend/src/core/agents/heartbeat-hooks.ts`**

```typescript
import { useQuery } from "@tanstack/react-query";

import {
  getHeartbeatLog,
  getHeartbeatLogs,
  type HeartbeatLogRecord,
  type HeartbeatLogsParams,
} from "./heartbeat-api";

export function useHeartbeatLogs(params: HeartbeatLogsParams) {
  return useQuery({
    queryKey: ["heartbeat", "logs", params.agentName, params.templateId, params.status, params.offset],
    queryFn: () => getHeartbeatLogs(params),
    staleTime: 30 * 1000,
  });
}

export function useHeartbeatLog(agentName: string, logId: string) {
  return useQuery({
    queryKey: ["heartbeat", "log", agentName, logId],
    queryFn: () => getHeartbeatLog(agentName, logId),
    staleTime: 30 * 1000,
    enabled: !!logId,
  });
}
```

### 验证清单
- [ ] Hooks 正确使用 TanStack Query 模式
- [ ] 缓存失效逻辑正确

---

## Phase 3: 创建日志查看器组件

### 目标
创建 Heartbeat 日志列表和详情组件。

### 实施步骤

**3.1 创建 `frontend/src/components/workspace/agents/settings/heartbeat-logs.tsx`**

```typescript
"use client";

import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useHeartbeatLog, useHeartbeatLogs } from "@/core/agents/heartbeat-hooks";
import { useI18n } from "@/core/i18n/hooks";
import { cn } from "@/lib/utils";

interface HeartbeatLogsViewerProps {
  agentName: string;
}

function statusClass(status: string): string {
  if (status === "success") return "bg-emerald-100 text-emerald-700";
  if (status === "failed") return "bg-red-100 text-red-700";
  if (status === "running") return "bg-blue-100 text-blue-700";
  return "bg-gray-100 text-gray-700";
}

function statusLabel(status: string, isZh: boolean): string {
  if (!isZh) return status;
  if (status === "success") return "成功";
  if (status === "failed") return "失败";
  if (status === "running") return "运行中";
  return status;
}

export function HeartbeatLogsViewer({ agentName }: HeartbeatLogsViewerProps) {
  const { locale } = useI18n();
  const isZh = locale.startsWith("zh");
  const [selectedLogId, setSelectedLogId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("");

  const { data: logs, isLoading, error } = useHeartbeatLogs({
    agentName,
    status: statusFilter || undefined,
    limit: 50,
  });

  const { data: selectedLog } = useHeartbeatLog(agentName, selectedLogId ?? "");

  const formatDate = (timestamp: string) => {
    return new Date(timestamp).toLocaleString(isZh ? "zh-CN" : "en-US", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const formatDuration = (seconds: number) => {
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${minutes}m ${secs}s`;
  };

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
          <CardTitle className="text-base">
            {isZh ? "执行日志" : "Execution Logs"}
          </CardTitle>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="h-8 rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="">{isZh ? "全部状态" : "All Status"}</option>
            <option value="success">{isZh ? "成功" : "Success"}</option>
            <option value="failed">{isZh ? "失败" : "Failed"}</option>
            <option value="running">{isZh ? "运行中" : "Running"}</option>
          </select>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="py-8 text-center text-muted-foreground">
              {isZh ? "加载中..." : "Loading..."}
            </div>
          ) : error ? (
            <div className="py-8 text-center text-destructive">
              {isZh ? "无法加载日志" : "Failed to load logs"}
            </div>
          ) : logs?.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">
              {isZh ? "暂无日志" : "No logs"}
            </div>
          ) : (
            <div className="space-y-2">
              {logs?.map((log) => (
                <div
                  key={log.id}
                  className="flex items-center justify-between rounded-md border p-3 cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => setSelectedLogId(log.id)}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium truncate">{log.heartbeat_type}</span>
                      <Badge className={cn("shrink-0", statusClass(log.status))}>
                        {statusLabel(log.status, isZh)}
                      </Badge>
                    </div>
                    <div className="text-muted-foreground text-xs mt-1">
                      {formatDate(log.timestamp)}
                    </div>
                  </div>
                  <div className="text-muted-foreground text-sm shrink-0 ml-4">
                    {formatDuration(log.duration_seconds)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Log Detail Dialog */}
      <Dialog open={!!selectedLogId} onOpenChange={() => setSelectedLogId(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>
              {isZh ? "日志详情" : "Log Details"} - {selectedLog?.heartbeat_type}
            </DialogTitle>
          </DialogHeader>
          {selectedLog && (
            <div className="space-y-4">
              <div className="flex items-center gap-4">
                <Badge className={cn(statusClass(selectedLog.status))}>
                  {statusLabel(selectedLog.status, isZh)}
                </Badge>
                <span className="text-muted-foreground text-sm">
                  {formatDate(selectedLog.timestamp)}
                </span>
                <span className="text-muted-foreground text-sm">
                  {isZh ? "耗时" : "Duration"}: {formatDuration(selectedLog.duration_seconds)}
                </span>
              </div>
              {selectedLog.error_message && (
                <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
                  <strong>{isZh ? "错误信息" : "Error"}:</strong> {selectedLog.error_message}
                </div>
              )}
              <div>
                <h4 className="text-sm font-medium mb-2">
                  {isZh ? "结果" : "Result"}
                </h4>
                <pre className="bg-muted p-3 rounded-md overflow-auto text-xs max-h-60">
                  {JSON.stringify(selectedLog.result, null, 2)}
                </pre>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
```

### 验证清单
- [ ] 日志列表正确显示
- [ ] 状态过滤正确工作
- [ ] 日志详情 Dialog 正确显示
- [ ] 日期和时长格式化正确

---

## Phase 4: 集成到 Settings 页面

### 目标
将日志查看器添加到 Agent Settings 页面。

### 实施步骤

**4.1 修改 `frontend/src/app/workspace/agents/[agent_name]/settings/page.tsx`**

添加 Logs Tab：

```typescript
import { HeartbeatLogsViewer } from "@/components/workspace/agents/settings/heartbeat-logs";

// In the Tabs:
<TabsTrigger value="logs">{isZh ? "日志" : "Logs"}</TabsTrigger>

// In the TabsContent:
<TabsContent value="logs">
  <HeartbeatLogsViewer agentName={agent_name} />
</TabsContent>
```

### 验证清单
- [ ] Logs Tab 正确显示
- [ ] 日志查看器正确加载

---

## Phase 5: 最终验证

### 验证清单

**功能验证**:
- [ ] GET /api/heartbeat/logs 正确返回日志列表
- [ ] GET /api/heartbeat/logs/{id} 正确返回日志详情
- [ ] 前端 API 函数正确调用
- [ ] React Query hooks 正确管理状态
- [ ] 日志列表正确显示
- [ ] 状态过滤正确工作
- [ ] 日志详情 Dialog 正确显示

**UI/UX 验证**:
- [ ] 加载状态正确显示
- [ ] 错误状态正确显示
- [ ] 空状态正确显示
- [ ] 状态 Badge 颜色正确
- [ ] 日期和时长格式化正确

**代码质量验证**:
- [ ] TypeScript 类型检查通过
- [ ] ESLint 检查通过
- [ ] Import 顺序正确
- [ ] 代码格式正确

---

## 反模式防护

**禁止的操作**:
- ❌ 不要使用 localStorage 存储日志数据
- ❌ 不要跳过错误处理
- ❌ 不要硬编码 API URL（使用 getBackendBaseURL）

**必须遵循的模式**:
- ✅ 使用 TanStack Query 管理服务端状态
- ✅ 使用 Dialog 显示日志详情
- ✅ 使用 Badge 显示状态标签
- ✅ 使用 sonner 显示 toast 通知（如果需要）
- ✅ 遵循项目的 import 顺序规则

---

## 文件清单

**新建文件**:
1. `frontend/src/core/agents/heartbeat-api.ts` - API 函数 + 类型
2. `frontend/src/core/agents/heartbeat-hooks.ts` - React Query hooks
3. `frontend/src/components/workspace/agents/settings/heartbeat-logs.tsx` - 日志查看器组件

**修改文件**:
1. `frontend/src/app/workspace/agents/[agent_name]/settings/page.tsx` - 添加 Logs Tab

**总计**: 3 个新文件，1 个修改文件

---

## 预计工作量

- Phase 1: 前端 API - 10 分钟
- Phase 2: 前端 Hooks - 10 分钟
- Phase 3: 日志查看器组件 - 30 分钟
- Phase 4: 集成到页面 - 10 分钟
- Phase 5: 验证和调试 - 10 分钟

**总计**: 约 70 分钟

---

## 下一步

执行此计划后，使用 `/claude-mem:do` 命令开始实施。
