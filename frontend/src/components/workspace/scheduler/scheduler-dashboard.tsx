"use client";

import {
  ArrowUpRightIcon,
  BotIcon,
  Clock3Icon,
  OctagonAlertIcon,
  SparklesIcon,
} from "lucide-react";
import { useMemo } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useI18n } from "@/core/i18n/hooks";
import { useAppRouter } from "@/core/navigation";
import { useScheduledTasks, useSchedulerDashboard } from "@/core/scheduler";
import type { ScheduledTask, SchedulerDashboard as SchedulerDashboardData } from "@/core/scheduler";

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function formatDateTime(value?: string | null) {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

type SchedulerDashboardViewProps = {
  dashboard: SchedulerDashboardData | null;
  isLoading?: boolean;
  onAgentClick?: (agentName: string) => void;
  recentTasks?: ScheduledTask[];
  onTaskOpen?: (agentName: string) => void;
};

export function SchedulerDashboardView({
  dashboard,
  isLoading = false,
  onAgentClick,
  recentTasks = [],
  onTaskOpen,
}: SchedulerDashboardViewProps) {
  const { t } = useI18n();
  const copy = t.scheduler.dashboard;
  const statusCopy = t.scheduler.settings.status;

  const metrics = [
    {
      id: "agent_count_with_tasks",
      label: copy.metrics.agentCount,
      value: dashboard?.agent_count_with_tasks ?? 0,
      icon: BotIcon,
      description: copy.metrics.agentCountHint,
    },
    {
      id: "task_count",
      label: copy.metrics.taskCount,
      value: dashboard?.task_count ?? 0,
      icon: Clock3Icon,
      description: copy.metrics.taskCountHint,
    },
    {
      id: "success_rate_24h",
      label: copy.metrics.successRate,
      value: formatPercent(dashboard?.success_rate_24h ?? 0),
      icon: SparklesIcon,
      description: copy.metrics.successRateHint,
    },
    {
      id: "failed_task_count_24h",
      label: copy.metrics.failedTaskCount,
      value: dashboard?.failed_task_count_24h ?? 0,
      icon: OctagonAlertIcon,
      description: copy.metrics.failedTaskCountHint,
    },
  ];

  const agents = [...(dashboard?.agents ?? [])].sort((a, b) => {
    if (b.task_count !== a.task_count) {
      return b.task_count - a.task_count;
    }
    return a.agent_name.localeCompare(b.agent_name);
  });

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 md:px-6">
      <section className="overflow-hidden rounded-3xl border border-border/80 bg-card shadow-sm">
        <div className="flex flex-col gap-4 p-6 md:flex-row md:items-end md:justify-between">
          <div className="space-y-3">
            <Badge variant="outline" className="w-fit rounded-full px-3 py-1 text-[11px] uppercase tracking-[0.18em]">
              {copy.badge}
            </Badge>
            <div className="space-y-2">
              <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
                {copy.title}
              </h1>
              <p className="text-muted-foreground max-w-3xl text-sm leading-6 md:text-base">
                {copy.description}
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => {
          const MetricIcon = metric.icon;
          return (
            <Card key={metric.id} className="rounded-2xl border-border/80 shadow-sm">
              <CardHeader className="pb-3">
                <CardDescription className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide">
                  <MetricIcon className="size-3.5 text-primary" />
                  {metric.label}
                </CardDescription>
                <CardTitle className="text-3xl font-semibold tracking-tight">
                  {metric.value}
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <p className="text-muted-foreground text-sm leading-6">{metric.description}</p>
              </CardContent>
            </Card>
          );
        })}
      </section>

      <section className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">{copy.agentsTitle}</h2>
            <p className="text-muted-foreground text-sm leading-6">{copy.agentsDescription}</p>
          </div>
        </div>

        {isLoading ? (
          <Card className="rounded-2xl border-border/80 shadow-sm">
            <CardContent className="py-8 text-sm text-muted-foreground">{copy.loading}</CardContent>
          </Card>
        ) : agents.length === 0 ? (
          <Card className="rounded-2xl border-border/80 shadow-sm">
            <CardContent className="py-8">
              <div className="space-y-2">
                <p className="text-sm font-medium">{copy.emptyTitle}</p>
                <p className="text-muted-foreground text-sm leading-6">{copy.emptyDescription}</p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {agents.map((agent) => (
              <Card key={agent.agent_name} className="rounded-2xl border-border/80 shadow-sm">
                <CardHeader className="gap-3 pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <CardTitle className="text-base">{agent.agent_name}</CardTitle>
                      <CardDescription>{copy.cardDescription}</CardDescription>
                    </div>
                    <Badge variant="secondary">{copy.taskCountBadge.replace("{count}", String(agent.task_count))}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-xl bg-muted/40 p-3">
                      <div className="text-muted-foreground text-xs">{copy.successRateLabel}</div>
                      <div className="mt-1 text-xl font-semibold">{formatPercent(agent.success_rate_24h)}</div>
                    </div>
                    <div className="rounded-xl bg-muted/40 p-3">
                      <div className="text-muted-foreground text-xs">{copy.failedRunsLabel}</div>
                      <div className="mt-1 text-xl font-semibold">{agent.failed_runs_24h}</div>
                    </div>
                  </div>

                  <Button
                    className="w-full justify-between rounded-xl"
                    variant="outline"
                    onClick={() => onAgentClick?.(agent.agent_name)}
                  >
                    {copy.openAgentSettings}
                    <ArrowUpRightIcon className="size-4" />
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">{copy.recentTitle}</h2>
          <p className="text-muted-foreground text-sm leading-6">{copy.recentDescription}</p>
        </div>

        {isLoading ? (
          <Card className="rounded-2xl border-border/80 shadow-sm">
            <CardContent className="py-8 text-sm text-muted-foreground">{copy.loading}</CardContent>
          </Card>
        ) : recentTasks.length === 0 ? (
          <Card className="rounded-2xl border-border/80 shadow-sm">
            <CardContent className="py-8 text-sm text-muted-foreground">{copy.recentEmpty}</CardContent>
          </Card>
        ) : (
          <Card className="rounded-2xl border-border/80 shadow-sm">
            <CardContent className="space-y-3 py-6">
              {recentTasks.map((task) => (
                <div
                  key={task.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/70 bg-muted/10 p-4"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-semibold">{task.name}</p>
                      <Badge variant="secondary">{statusCopy[task.status]}</Badge>
                      <Badge variant="outline">{task.agent_name}</Badge>
                    </div>
                    <div className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs">
                      <span>{copy.recentLastRun}{formatDateTime(task.last_run_at)}</span>
                      <span>{copy.recentNextRun}{formatDateTime(task.next_run_at)}</span>
                    </div>
                  </div>

                  <Button
                    variant="outline"
                    className="shrink-0 rounded-xl"
                    onClick={() => onTaskOpen?.(task.agent_name)}
                  >
                    {copy.recentOpen}
                    <ArrowUpRightIcon className="size-4" />
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </section>
    </div>
  );
}

export function SchedulerDashboard() {
  const { dashboard, isLoading } = useSchedulerDashboard();
  const { tasks, isLoading: isTasksLoading } = useScheduledTasks();
  const router = useAppRouter();
  const recentTasks = useMemo(() => {
    const sorted = [...tasks].sort((a, b) => {
      const aTime = a.last_run_at ? new Date(a.last_run_at).getTime() : new Date(a.created_at).getTime();
      const bTime = b.last_run_at ? new Date(b.last_run_at).getTime() : new Date(b.created_at).getTime();
      if (bTime !== aTime) {
        return bTime - aTime;
      }
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
    return sorted.slice(0, 8);
  }, [tasks]);

  return (
    <SchedulerDashboardView
      dashboard={dashboard}
      isLoading={isLoading || isTasksLoading}
      onAgentClick={(agentName) => {
        router.push(`/workspace/agents/${encodeURIComponent(agentName)}/settings?section=scheduler`);
      }}
      recentTasks={recentTasks}
      onTaskOpen={(agentName) => {
        router.push(`/workspace/agents/${encodeURIComponent(agentName)}/settings?section=scheduler`);
      }}
    />
  );
}
