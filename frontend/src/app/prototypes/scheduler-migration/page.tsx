"use client";

import { ArrowUpRightIcon, Layers3Icon, PanelsTopLeftIcon, PencilRulerIcon } from "lucide-react";
import { useState, type ComponentType, type ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  SchedulerSettingsPanel,
  SchedulerTaskEditorForm,
  createSchedulerTaskDraftFromTask,
} from "@/components/workspace/agents/settings/scheduler-settings";
import {
  SchedulerDashboardView,
} from "@/components/workspace/scheduler/scheduler-dashboard";
import { useI18n } from "@/core/i18n/hooks";
import type {
  SchedulerDashboard,
  ScheduledTask,
  TaskExecutionRecord,
} from "@/core/scheduler";

const prototypeAgentName = "Strategy Desk";
const prototypeTimezone = "Asia/Shanghai";
const timezoneSettingsHref = `/workspace/agents/${encodeURIComponent(prototypeAgentName)}/settings?section=heartbeat`;

const prototypeTasks: ScheduledTask[] = [
  {
    id: "task-daily-ops-digest",
    agent_name: prototypeAgentName,
    name: "Daily Ops Digest",
    description: "Summarize cross-project status and blockers.",
    mode: "workflow",
    trigger: {
      type: "cron",
      cron_expression: "0 9 * * *",
      timezone: prototypeTimezone,
    },
    steps: [
      {
        id: "step-1",
        name: "default-step",
        parallel: false,
        depends_on: [],
        agents: [
          {
            agent_name: prototypeAgentName,
            prompt: "Summarize project health, blockers, and concrete next actions for today.",
            timeout_seconds: 300,
            retry_on_failure: false,
            max_retries: 0,
          },
        ],
      },
    ],
    max_concurrent_steps: 3,
    timeout_seconds: 3600,
    enabled: true,
    created_by: "workspace-user",
    created_at: "2026-03-10T09:00:00Z",
    last_run_at: "2026-03-13T01:00:00Z",
    next_run_at: "2026-03-14T01:00:00Z",
    status: "completed",
    last_result: {
      summary: "3 projects on track, 1 blocker escalated.",
    },
    last_error: null,
  },
  {
    id: "task-weekly-decision-brief",
    agent_name: prototypeAgentName,
    name: "Weekly Decision Brief",
    description: "Draft a decision memo every Friday.",
    mode: "workflow",
    trigger: {
      type: "interval",
      interval_seconds: 604800,
      timezone: prototypeTimezone,
    },
    steps: [
      {
        id: "step-1",
        name: "default-step",
        parallel: false,
        depends_on: [],
        agents: [
          {
            agent_name: prototypeAgentName,
            prompt: "Generate a weekly decision brief with risks, pending asks, and recommendations.",
            timeout_seconds: 300,
            retry_on_failure: false,
            max_retries: 0,
          },
        ],
      },
    ],
    max_concurrent_steps: 3,
    timeout_seconds: 3600,
    enabled: false,
    created_by: "workspace-user",
    created_at: "2026-03-08T09:00:00Z",
    last_run_at: "2026-03-12T09:00:00Z",
    next_run_at: "2026-03-19T09:00:00Z",
    status: "failed",
    last_result: null,
    last_error: "Tool quota exceeded in briefing step.",
  },
];

const prototypeHistory: TaskExecutionRecord[] = [
  {
    run_id: "run-2026-03-13-0900",
    task_id: "task-daily-ops-digest",
    started_at: "2026-03-13T01:00:00Z",
    completed_at: "2026-03-13T01:00:32Z",
    status: "completed",
    success: true,
    result: {
      summary: "Status digest delivered to workspace.",
    },
    error: null,
  },
  {
    run_id: "run-2026-03-12-0900",
    task_id: "task-daily-ops-digest",
    started_at: "2026-03-12T01:00:00Z",
    completed_at: "2026-03-12T01:00:41Z",
    status: "failed",
    success: false,
    result: null,
    error: "Market data connector timed out.",
  },
];

const prototypeDashboard: SchedulerDashboard = {
  agent_count_with_tasks: 3,
  task_count: 8,
  success_rate_24h: 0.92,
  failed_task_count_24h: 1,
  agents: [
    {
      agent_name: prototypeAgentName,
      task_count: 2,
      success_rate_24h: 0.92,
      failed_runs_24h: 1,
    },
    {
      agent_name: "Insight Radar",
      task_count: 4,
      success_rate_24h: 0.88,
      failed_runs_24h: 2,
    },
    {
      agent_name: "Growth Copilot",
      task_count: 2,
      success_rate_24h: 1,
      failed_runs_24h: 0,
    },
  ],
};

const primaryPrototypeTask = prototypeTasks[0]!;

function PrototypeFrame({
  badge,
  title,
  description,
  icon: Icon,
  children,
}: {
  badge: string;
  title: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
  children: ReactNode;
}) {
  return (
    <section className="relative overflow-hidden rounded-[32px] border border-border/80 bg-card/95 shadow-sm">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-r from-primary/10 via-primary/5 to-transparent" />
        <div className="absolute -top-20 right-8 size-48 rounded-full bg-primary/10 blur-3xl" />
      </div>
      <div className="relative space-y-6 p-6 lg:p-8">
        <div className="flex flex-col gap-4 border-b border-border/70 pb-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-3">
            <Badge variant="outline" className="w-fit rounded-full px-3 py-1 text-[11px] uppercase tracking-[0.18em]">
              {badge}
            </Badge>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Icon className="size-5 text-primary" />
                <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
              </div>
              <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{description}</p>
            </div>
          </div>
          <div className="rounded-2xl border border-dashed border-border/80 bg-background/70 px-4 py-3 text-xs leading-5 text-muted-foreground">
            Prototype frame
          </div>
        </div>
        {children}
      </div>
    </section>
  );
}

function PrototypeEditorCard() {
  const { t } = useI18n();
  const copy = t.scheduler.settings;
  const [draft, setDraft] = useState(createSchedulerTaskDraftFromTask(primaryPrototypeTask));

  return (
    <Card className="rounded-2xl border-border/80 shadow-sm">
      <CardHeader className="border-b">
        <CardTitle>{copy.editor.editTitle}</CardTitle>
        <CardDescription>{copy.editor.editDescription}</CardDescription>
      </CardHeader>
      <CardContent className="pt-6">
        <SchedulerTaskEditorForm
          agentName={prototypeAgentName}
          timezone={prototypeTimezone}
          timezoneSettingsHref={timezoneSettingsHref}
          draft={draft}
          mode="edit"
          onDraftChange={setDraft}
          onSubmit={() => undefined}
        />
      </CardContent>
    </Card>
  );
}

export default function SchedulerMigrationPrototypePage() {
  const { t } = useI18n();
  const copy = t.scheduler;

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(120,120,120,0.12),transparent_32%),linear-gradient(180deg,rgba(120,120,120,0.06),transparent_24%)]">
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-8 px-4 py-8 md:px-6 lg:px-8">
        <section className="relative overflow-hidden rounded-[32px] border border-border/80 bg-card shadow-sm">
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute -left-10 top-0 h-56 w-56 rounded-full bg-primary/12 blur-3xl" />
            <div className="absolute bottom-0 right-0 h-64 w-64 rounded-full bg-primary/8 blur-3xl" />
          </div>
          <div className="relative flex flex-col gap-6 p-6 lg:flex-row lg:items-end lg:justify-between lg:p-8">
            <div className="space-y-4">
              <Badge variant="outline" className="rounded-full px-3 py-1 text-[11px] uppercase tracking-[0.18em]">
                Scheduler migration prototype
              </Badge>
              <div className="space-y-3">
                <h1 className="text-3xl font-semibold tracking-tight lg:text-4xl">
                  定时任务迁移到智能体设置
                </h1>
                <p className="max-w-4xl text-sm leading-7 text-muted-foreground lg:text-base">
                  单张长图串联看板化入口、智能体内任务管理，以及右侧编辑抽屉打开态。页面全部使用真实组件和固定 mock 数据，不依赖后端接口。
                </p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <Card className="rounded-2xl border-border/80 bg-background/70 py-4">
                <CardHeader className="gap-1 pb-0">
                  <CardDescription>Frame 1</CardDescription>
                  <CardTitle className="text-base">看板入口</CardTitle>
                </CardHeader>
              </Card>
              <Card className="rounded-2xl border-border/80 bg-background/70 py-4">
                <CardHeader className="gap-1 pb-0">
                  <CardDescription>Frame 2</CardDescription>
                  <CardTitle className="text-base">智能体任务页</CardTitle>
                </CardHeader>
              </Card>
              <Card className="rounded-2xl border-border/80 bg-background/70 py-4">
                <CardHeader className="gap-1 pb-0">
                  <CardDescription>Frame 3</CardDescription>
                  <CardTitle className="text-base">编辑抽屉态</CardTitle>
                </CardHeader>
              </Card>
            </div>
          </div>
        </section>

        <PrototypeFrame
          badge="Frame 1"
          title={copy.dashboard.title}
          description="侧栏保留统一入口，但页面只承担跨智能体聚合看板角色，点击卡片进入对应智能体设置。"
          icon={PanelsTopLeftIcon}
        >
          <SchedulerDashboardView dashboard={prototypeDashboard} />
        </PrototypeFrame>

        <PrototypeFrame
          badge="Frame 2"
          title={copy.settings.title.replace("{agent}", prototypeAgentName)}
          description="任务配置与执行历史迁入智能体设置，统一依赖当前智能体的人设、记忆、工具与心跳时区。"
          icon={Layers3Icon}
        >
          <SchedulerSettingsPanel
            agentName={prototypeAgentName}
            timezone={prototypeTimezone}
            timezoneSettingsHref={timezoneSettingsHref}
            tasks={prototypeTasks}
            selectedTask={primaryPrototypeTask}
            selectedTaskId={primaryPrototypeTask.id}
            selectedHistory={prototypeHistory}
            onSelectTask={() => undefined}
            onCreateTask={() => undefined}
            onEditTask={() => undefined}
            onRunTask={() => undefined}
            onDeleteTask={() => undefined}
            onToggleTask={() => undefined}
          />
        </PrototypeFrame>

        <PrototypeFrame
          badge="Frame 3"
          title="编辑态预览"
          description="抽屉保持在同一上下文中打开，时区只读展示并引导回心跳设置修改，表单字段固定为名称、触发类型、触发值、Prompt。"
          icon={PencilRulerIcon}
        >
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <ArrowUpRightIcon className="size-4 text-primary" />
              右侧展示为嵌入式抽屉样式，便于在高保真长图里完整保留编辑上下文。
            </div>
            <SchedulerSettingsPanel
              agentName={prototypeAgentName}
              timezone={prototypeTimezone}
              timezoneSettingsHref={timezoneSettingsHref}
              tasks={prototypeTasks}
              selectedTask={primaryPrototypeTask}
              selectedTaskId={primaryPrototypeTask.id}
              selectedHistory={prototypeHistory}
              onSelectTask={() => undefined}
              onCreateTask={() => undefined}
              onEditTask={() => undefined}
              onRunTask={() => undefined}
              onDeleteTask={() => undefined}
              onToggleTask={() => undefined}
              editorInline={<PrototypeEditorCard />}
            />
          </div>
        </PrototypeFrame>
      </div>
    </main>
  );
}
