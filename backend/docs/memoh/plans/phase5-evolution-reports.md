# Phase 5: Evolution Reports Viewer 实施计划

**创建日期**: 2026-03-10
**目标**: 实现 Evolution 分析报告和建议查看功能

---

## Phase 0: 文档发现总结

### 后端 API 端点

| 端点 | 方法 | 描述 |
|------|------|------|
| `/api/evolution/reports` | GET | 获取报告列表 |
| `/api/evolution/reports/{report_id}` | GET | 获取单个报告 |
| `/api/evolution/suggestions` | GET | 获取建议列表（可按状态过滤）|
| `/api/evolution/suggestions/{id}/dismiss` | POST | 拒绝建议 |
| `/api/evolution/suggestions/{id}/accept` | POST | 接受建议 |

### 数据结构

**EvolutionReport**:
- report_id, timestamp, status, duration_seconds, suggestions[], summary, error_message

**EvolutionSuggestion**:
- id, report_id, type (MEMORY/SOUL/AGENT), content, evidence_summary, impact_scope, confidence, priority (LOW/MEDIUM/HIGH), status (PENDING/ACCEPTED/DISMISSED)

---

## Phase 1: 创建前端 API 函数

创建 `frontend/src/core/agents/evolution-api.ts`:

```typescript
import { getBackendBaseURL } from "@/core/config";

export interface EvolutionSuggestion {
  id: string;
  report_id: string;
  type: string;
  target_domain: string;
  content: string;
  evidence_summary: string;
  impact_scope: string;
  confidence: number;
  priority: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface EvolutionReport {
  report_id: string;
  timestamp: string;
  status: string;
  duration_seconds: number;
  input_sources: Record<string, unknown>;
  suggestions: EvolutionSuggestion[];
  summary: string;
  error_message: string | null;
}

export async function getEvolutionReports(
  agentName: string,
  limit = 50
): Promise<EvolutionReport[]> {
  const res = await fetch(
    `${getBackendBaseURL()}/api/evolution/reports?agent_name=${encodeURIComponent(agentName)}&limit=${limit}`
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { detail?: string };
    throw new Error(err.detail ?? `Failed to load reports: ${res.statusText}`);
  }
  return res.json();
}

export async function getEvolutionSuggestions(
  agentName: string,
  status?: string
): Promise<EvolutionSuggestion[]> {
  const params = new URLSearchParams({ agent_name: agentName });
  if (status) params.set("status", status);

  const res = await fetch(`${getBackendBaseURL()}/api/evolution/suggestions?${params}`);
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { detail?: string };
    throw new Error(err.detail ?? `Failed to load suggestions: ${res.statusText}`);
  }
  return res.json();
}

export async function dismissSuggestion(
  agentName: string,
  suggestionId: string
): Promise<EvolutionSuggestion> {
  const res = await fetch(
    `${getBackendBaseURL()}/api/evolution/suggestions/${suggestionId}/dismiss?agent_name=${encodeURIComponent(agentName)}`,
    { method: "POST" }
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { detail?: string };
    throw new Error(err.detail ?? `Failed to dismiss suggestion: ${res.statusText}`);
  }
  return res.json();
}

export async function acceptSuggestion(
  agentName: string,
  suggestionId: string
): Promise<EvolutionSuggestion> {
  const res = await fetch(
    `${getBackendBaseURL()}/api/evolution/suggestions/${suggestionId}/accept?agent_name=${encodeURIComponent(agentName)}`,
    { method: "POST" }
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { detail?: string };
    throw new Error(err.detail ?? `Failed to accept suggestion: ${res.statusText}`);
  }
  return res.json();
}
```

---

## Phase 2: 创建 React Query hooks

创建 `frontend/src/core/agents/evolution-hooks.ts`:

```typescript
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import {
  acceptSuggestion,
  dismissSuggestion,
  getEvolutionReports,
  getEvolutionSuggestions,
} from "./evolution-api";

export function useEvolutionReports(agentName: string) {
  return useQuery({
    queryKey: ["evolution", "reports", agentName],
    queryFn: () => getEvolutionReports(agentName),
    staleTime: 30 * 1000,
  });
}

export function useEvolutionSuggestions(agentName: string, status?: string) {
  return useQuery({
    queryKey: ["evolution", "suggestions", agentName, status],
    queryFn: () => getEvolutionSuggestions(agentName, status),
    staleTime: 30 * 1000,
  });
}

export function useDismissSuggestion(agentName: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (suggestionId: string) => dismissSuggestion(agentName, suggestionId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["evolution", "suggestions", agentName] });
      toast.success("建议已拒绝");
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });
}

export function useAcceptSuggestion(agentName: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (suggestionId: string) => acceptSuggestion(agentName, suggestionId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["evolution", "suggestions", agentName] });
      toast.success("建议已接受");
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });
}
```

---

## Phase 3: 创建查看器组件

创建 `frontend/src/components/workspace/agents/settings/evolution-reports.tsx`:

使用 Card 显示报告列表和建议，Dialog 显示详情，Badge 显示状态和优先级。

关键功能：
- 报告列表（时间戳、状态、建议数量）
- 建议列表（类型、内容、优先级、状态）
- 状态过滤（pending/accepted/dismissed）
- 建议操作（接受/拒绝按钮）
- 详情 Dialog（evidence_summary, impact_scope, confidence）

---

## Phase 4: 集成到 Settings 页面

修改 `frontend/src/app/workspace/agents/[agent_name]/settings/page.tsx`:

添加 "Reports" Tab 和对应的 TabsContent。

---

## Phase 5: 验证

**代码质量**:
- [ ] TypeScript 类型检查通过
- [ ] ESLint 检查通过

**功能验证**:
- [ ] 报告列表正确显示
- [ ] 建议列表正确显示
- [ ] 状态过滤正常工作
- [ ] 接受/拒绝按钮正常工作
- [ ] 详情 Dialog 正确显示

---

## 文件清单

**新建文件**:
1. `frontend/src/core/agents/evolution-api.ts`
2. `frontend/src/core/agents/evolution-hooks.ts`
3. `frontend/src/components/workspace/agents/settings/evolution-reports.tsx`

**修改文件**:
1. `frontend/src/app/workspace/agents/[agent_name]/settings/page.tsx`

**总计**: 3 个新文件，1 个修改文件
