# 定时任务系统实现计划

## 功能概述

创建一个强大的定时任务系统，支持：
- **定时触发**: Cron 表达式、固定间隔、指定时间
- **条件触发**: 事件驱动（如用户事件、文件变化、Webhook）
- **多智能体协作**: 串行/并行执行，支持依赖关系
- **任务指标**: 完成后回调、状态报告、输出验证
- **资源指定**: 指定使用哪些 skill、MCP 工具、上下文

---

## Phase 0: 文档发现总结

### 现有架构

| 组件 | 位置 | 关键 API |
|------|------|----------|
| Agent 创建 | `backend/src/agents/lead_agent/agent.py` | `make_lead_agent(config)` |
| 工具加载 | `backend/src/tools/tools.py` | `get_available_tools(groups, include_mcp, model_name, subagent_enabled)` |
| Skills 加载 | `backend/src/skills/loader.py` | `load_skills(enabled_only=True)` |
| MCP 集成 | `backend/src/mcp/cache.py` | `get_cached_mcp_tools()` |
| 子Agent 执行 | `backend/src/subagents/executor.py` | `SubagentExecutor.execute_async()` |
| 子Agent 配置 | `backend/src/subagents/config.py` | `SubagentConfig` dataclass |
| Thread 状态 | `backend/src/agents/thread_state.py` | `ThreadState` schema |

### 参考模式

- **Task Tool**: 后端轮询模式，避免 LLM 轮询
- **子Agent 限制**: `MAX_CONCURRENT_SUBAGENTS = 3`
- **执行超时**: 5 分钟默认，可配置

---

## Phase 1: 数据模型设计

### 后端模型

```python
# backend/src/scheduler/models.py
from dataclasses import dataclass, field
from enum import Enum
from typing import Any
from datetime import datetime

class TriggerType(Enum):
    CRON = "cron"              # Cron 表达式
    INTERVAL = "interval"      # 固定间隔
    ONCE = "once"              # 单次执行
    EVENT = "event"            # 事件触发

class TaskStatus(Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"

@dataclass
class TriggerConfig:
    type: TriggerType
    # Cron: "0 9 * * *"
    cron_expression: str | None = None
    # Interval: 3600 (秒)
    interval_seconds: int | None = None
    # Once: "2026-03-07T09:00:00"
    scheduled_time: datetime | None = None
    # Event: ["user_created", "file_changed"]
    event_type: str | None = None
    event_filters: dict | None = None

@dataclass
class AgentStep:
    """单步智能体任务配置"""
    agent_name: str              # 如 "general-purpose", "bash"
    agent_config: dict | None = None  # 自定义 agent 配置
    prompt: str                  # 任务描述
    skill: str | None = None     # 指定使用的 skill
    tools: list[str] | None = None   # 指定使用的工具
    mcp_servers: list[str] | None = None  # 指定 MCP 服务器
    context_refs: list[str] | None = None  # @上下文/文件引用
    timeout_seconds: int = 300
    retry_on_failure: bool = False
    max_retries: int = 0

@dataclass
class WorkflowStep:
    """工作流步骤（可包含多个 Agent 串行/并行）"""
    id: str
    name: str
    agents: list[AgentStep] = field(default_factory=list)
    # 并行: agents 同时执行; 串行: 按顺序执行
    parallel: bool = False
    # 依赖: 上一步的哪些输出作为这一步的输入
    depends_on: list[str] = field(default_factory=list)
    # 完成后条件
    completion_criteria: dict | None = None  # 如 {"type": "output_contains", "pattern": "..."}

@dataclass
class ScheduledTask:
    id: str
    name: str
    description: str | None

    # 触发配置
    trigger: TriggerConfig

    # 工作流（多步骤）
    steps: list[WorkflowStep]

    # 任务指标
    on_complete: str | None = None       # 回调 URL
    on_failure: str | None = None         # 失败回调
    notification_webhook: str | None = None

    # 执行配置
    max_concurrent_steps: int = 3
    timeout_seconds: int = 3600           # 整体超时
    retry_policy: dict | None = None       # {"max_attempts": 3, "backoff": "exponential"}

    # 元数据
    enabled: bool = True
    created_by: str
    created_at: datetime
    last_run_at: datetime | None = None
    next_run_at: datetime | None = None

    # 运行时状态
    status: TaskStatus = TaskStatus.PENDING
    last_result: dict | None = None
    last_error: str | None = None
```

### 前端模型

```typescript
// frontend/src/core/scheduler/types.ts
export type TriggerType = 'cron' | 'interval' | 'once' | 'event';

export interface TriggerConfig {
  type: TriggerType;
  cronExpression?: string;
  intervalSeconds?: number;
  scheduledTime?: string;
  eventType?: string;
  eventFilters?: Record<string, unknown>;
}

export interface AgentStep {
  agentName: string;
  agentConfig?: Record<string, unknown>;
  prompt: string;
  skill?: string;
  tools?: string[];
  mcpServers?: string[];
  contextRefs?: string[];
  timeoutSeconds: number;
  retryOnFailure: boolean;
  maxRetries: number;
}

export interface WorkflowStep {
  id: string;
  name: string;
  agents: AgentStep[];
  parallel: boolean;
  dependsOn: string[];
  completionCriteria?: {
    type: 'output_contains' | 'output_matches' | 'no_error';
    pattern?: string;
  };
}

export interface ScheduledTask {
  id: string;
  name: string;
  description?: string;
  trigger: TriggerConfig;
  steps: WorkflowStep[];
  onComplete?: string;
  onFailure?: string;
  notificationWebhook?: string;
  maxConcurrentSteps: number;
  timeoutSeconds: number;
  retryPolicy?: {
    maxAttempts: number;
    backoff: 'none' | 'linear' | 'exponential';
  };
  enabled: boolean;
  createdBy: string;
  createdAt: string;
  lastRunAt?: string;
  nextRunAt?: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  lastResult?: Record<string, unknown>;
  lastError?: string;
}
```

---

## Phase 2: 后端实现

### 2.1 调度器核心

**文件**: `backend/src/scheduler/runner.py`

```python
import croniter
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger

class TaskScheduler:
    def __init__(self):
        self._scheduler = BackgroundScheduler(timezone=timezone.utc)
        self._executor = ThreadPoolExecutor(max_workers=5)
        self._tasks: dict[str, ScheduledTask] = {}

    def add_task(self, task: ScheduledTask) -> None:
        """添加定时任务"""
        self._tasks[task.id] = task
        self._schedule_task(task)

    def remove_task(self, task_id: str) -> None:
        """移除任务"""
        self._scheduler.remove_job(task_id)
        del self._tasks[task_id]

    def _schedule_task(self, task: ScheduledTask) -> None:
        """根据触发器类型调度任务"""
        if task.trigger.type == TriggerType.CRON:
            trigger = CronTrigger.from_crontab(task.trigger.cron_expression)
        elif task.trigger.type == TriggerType.INTERVAL:
            trigger = IntervalTrigger(seconds=task.trigger.interval_seconds)
        elif task.trigger.type == TriggerType.ONCE:
            trigger = DateTrigger(run_date=task.trigger.scheduled_time)
        else:
            return

        self._scheduler.add_job(
            self._execute_task,
            trigger,
            args=[task.id],
            id=task.id,
            next_run_time=task.next_run_at
        )

    def _execute_task(self, task_id: str) -> None:
        """执行任务主入口"""
        task = self._tasks.get(task_id)
        if not task or not task.enabled:
            return

        # 更新状态
        task.status = TaskStatus.RUNNING
        task.last_run_at = datetime.now(timezone.utc)

        # 执行工作流
        result = asyncio.run(self._execute_workflow(task.steps))

        # 处理结果
        if result["success"]:
            task.status = TaskStatus.COMPLETED
            task.last_result = result
            if task.on_complete:
                self._send_webhook(task.on_complete, result)
        else:
            task.status = TaskStatus.FAILED
            task.last_error = result.get("error")
            if task.on_failure:
                self._send_webhook(task.on_failure, result)

        # 更新下次运行时间
        self._update_next_run(task)
```

### 2.2 工作流执行引擎

**文件**: `backend/src/scheduler/workflow.py`

```python
class WorkflowExecutor:
    def __init__(self, max_concurrent: int = 3):
        self._semaphore = asyncio.Semaphore(max_concurrent)

    async def execute(self, steps: list[WorkflowStep]) -> dict:
        """执行整个工作流"""
        context: dict[str, Any] = {}  # 步骤间共享上下文

        for step in steps:
            # 检查依赖
            if not self._check_dependencies(step, context):
                return {"success": False, "error": f"Dependencies not met for step {step.id}"}

            # 准备输入
            step_input = self._prepare_input(step, context)

            # 执行步骤
            if step.parallel:
                results = await self._execute_parallel(step.agents, step_input)
            else:
                results = [await self._execute_serial(step.agents, step_input)]

            # 检查完成条件
            if step.completion_criteria:
                if not self._check_completion(step.completion_criteria, results):
                    return {"success": False, "error": f"Completion criteria not met for step {step.id}"}

            # 更新上下文
            context[step.id] = results

        return {"success": True, "context": context}

    async def _execute_agent(self, agent_step: AgentStep, input_data: dict) -> dict:
        """执行单个 Agent 步骤"""
        # 1. 构建 agent 配置
        config = self._build_agent_config(agent_step)

        # 2. 准备 prompt（注入上下文引用）
        prompt = self._inject_context(agent_step.prompt, input_data)

        # 3. 创建并执行 agent
        agent = make_lead_agent(config)
        result = await agent.ainvoke({"messages": [HumanMessage(content=prompt)]})

        return {
            "agent": agent_step.agent_name,
            "skill": agent_step.skill,
            "output": result["messages"][-1].content,
            "artifacts": result.get("artifacts", [])
        }

    def _build_agent_config(self, agent_step: AgentStep) -> RunnableConfig:
        """构建 agent 配置"""
        config = agent_step.agent_config or {}

        # 限制工具
        if agent_step.tools or agent_step.skill or agent_step.mcp_servers:
            # 需要自定义工具过滤逻辑
            pass

        return RunnableConfig(configurable=config)

    def _inject_context(self, prompt: str, context: dict) -> str:
        """注入上下文引用"""
        # 处理 @文件引用、@MCP 引用等
        return prompt
```

### 2.3 Gateway API 路由

**文件**: `backend/src/gateway/routers/scheduler.py`

```python
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/api/scheduler", tags=["scheduler"])

class CreateTaskRequest(BaseModel):
    name: str
    description: str | None = None
    trigger: TriggerConfig
    steps: list[WorkflowStep]
    on_complete: str | None = None
    on_failure: str | None = None
    notification_webhook: str | None = None
    max_concurrent_steps: int = 3
    timeout_seconds: int = 3600
    retry_policy: dict | None = None
    enabled: bool = True

@router.get("/tasks")
async def list_tasks() -> list[ScheduledTask]:
    """列出所有定时任务"""
    pass

@router.post("/tasks")
async def create_task(req: CreateTaskRequest) -> ScheduledTask:
    """创建定时任务"""
    pass

@router.get("/tasks/{task_id}")
async def get_task(task_id: str) -> ScheduledTask:
    """获取任务详情"""
    pass

@router.put("/tasks/{task_id}")
async def update_task(task_id: str, req: CreateTaskRequest) -> ScheduledTask:
    """更新任务"""
    pass

@router.delete("/tasks/{task_id}")
async def delete_task(task_id: str) -> dict:
    """删除任务"""
    pass

@router.post("/tasks/{task_id}/run")
async def run_task_now(task_id: str) -> dict:
    """立即执行任务"""
    pass

@router.get("/tasks/{task_id}/history")
async def get_task_history(task_id: str) -> list[dict]:
    """获取任务执行历史"""
    pass
```

---

## Phase 3: 前端实现

### 3.1 任务列表页面

**文件**: `frontend/src/app/workspace/scheduler/page.tsx`

- 任务卡片列表视图
- 状态徽章（运行中/已完成/失败）
- 快速操作（启用/禁用/立即执行/删除）

### 3.2 任务创建/编辑对话框

**文件**: `frontend/src/components/workspace/scheduler/task-editor.tsx`

使用 **步骤式表单**：

1. **触发器配置**
   - 类型选择（Cron/间隔/单次/事件）
   - Cron 表达式输入 + 预览下次执行时间
   - 间隔秒数输入
   - 日期时间选择器

2. **工作流设计**
   - 可视化步骤编辑器
   - 拖拽排序
   - 添加串行/并行步骤
   - 每步骤配置：
     - Agent 选择（下拉）
     - Skill 选择（多选）
     - 工具选择（多选）
     - MCP 服务器选择
     - Prompt 模板（带变量提示）
     - 上下文引用（@文件、@之前的输出）

3. **完成条件**
   - 输出包含文本
   - 正则匹配
   - 无错误

4. **通知设置**
   - 完成回调 URL
   - 失败回调 URL

### 3.3 任务执行历史

**文件**: `frontend/src/components/workspace/scheduler/task-history.tsx`

- 时间线视图
- 每步骤输入/输出
- 错误详情

---

## Phase 4: 事件触发器

### 4.1 文件变化触发器

```python
# backend/src/scheduler/triggers/filesystem.py
class FileWatchTrigger:
    def __init__(self, path_pattern: str, event_type: str = "modified"):
        self._path_pattern = path_pattern
        self._event_type = event_type
```

---

## Phase 5: 用户体验优化

### 5.1 自然语言任务创建

使用 LLM 解析用户描述：

```
用户输入: "每天早上9点，让调研人员用市场调研skill分析小米汽车，然后把报告给开发人员生成HTML"

解析结果:
{
  "trigger": {"type": "cron", "cron_expression": "0 9 * * *"},
  "steps": [
    {
      "id": "step1",
      "name": "市场调研",
      "agents": [{"agent_name": "general-purpose", "skill": "市场调研", "prompt": "分析小米汽车"}],
      "parallel": false
    },
    {
      "id": "step2",
      "name": "生成报告",
      "depends_on": ["step1"],
      "agents": [{"agent_name": "general-purpose", "skill": "ui-ux-pro-max", "prompt": "生成调研报告HTML"}],
      "parallel": false
    }
  ]
}
```

### 5.2 任务模板系统

预设模板：
- "每日热点新闻摘要"
- "每周技术周报"
- "定时健康检查"
- "数据备份任务"

---

## 验证清单

- [ ] 后端调度器正确执行 Cron 表达式
- [ ] 多步骤工作流串行执行符合依赖顺序
- [ ] 多步骤工作流并行执行同时进行
- [ ] 任务超时正确终止
- [ ] 失败回调正确发送
- [ ] 前端任务创建表单验证通过
- [ ] 前端任务历史显示正确
- [ ] 自然语言解析生成正确配置

---

## 参考实现

- **Temporal**: 用于复杂工作流编排，Schedule 功能用于定时任务
- **n8n**: 开源工作流自动化，有强大的定时和事件触发
- **GitHub Actions**: 定时工作流参考
- **APScheduler**: Python 定时任务库（本计划选用）

---

## 实施时间线

1. **Phase 1-2**: 数据模型 + 调度器核心（后端） — 3 天
2. **Phase 2**: 工作流执行引擎 + Gateway API — 2 天
3. **Phase 3**: 前端任务管理界面 — 3 天
4. **Phase 4**: 事件触发器 — 2 天
5. **Phase 5**: 自然语言解析 + 模板系统 — 2 天

**总计**: 约 12 天
