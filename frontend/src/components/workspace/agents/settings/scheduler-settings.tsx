"use client";

import {
  HistoryIcon,
  Loader2Icon,
  PlayCircleIcon,
  PlusIcon,
  SquarePenIcon,
  Trash2Icon,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { MarkdownContent } from "@/components/workspace/messages/markdown-content";
import { ProcesslogViewerDialog } from "@/components/workspace/scheduler/processlog-viewer-dialog";
import { ConfirmActionDialog } from "@/components/workspace/settings/confirm-action-dialog";
import { useHeartbeatSettings } from "@/core/agents/settings-hooks";
import { useI18n } from "@/core/i18n/hooks";
import {
  useCreateScheduledTask,
  useClearScheduledTaskHistory,
  useDeleteScheduledTask,
  useRunScheduledTaskNow,
  useScheduledTaskHistory,
  useScheduledTasks,
  useUpdateScheduledTask,
} from "@/core/scheduler";
import type {
  ScheduledTask,
  TaskExecutionRecord,
  TriggerConfig,
  TriggerType,
  UpdateScheduledTaskRequest,
} from "@/core/scheduler";

type SchedulerEditorMode = "create" | "edit";

export type SchedulerTaskDraft = {
  name: string;
  triggerType: TriggerType;
  triggerValue: string;
  prompt: string;
};

type SchedulerSettingsPanelProps = {
  agentName: string;
  timezone: string;
  timezoneSettingsHref: string;
  tasks: ScheduledTask[];
  selectedTask: ScheduledTask | null;
  selectedTaskId: string | null;
  selectedHistory: TaskExecutionRecord[];
  runningTaskId?: string | null;
  isLoading?: boolean;
  isHistoryLoading?: boolean;
  onSelectTask: (taskId: string) => void;
  onCreateTask: () => void;
  onEditTask: (task: ScheduledTask) => void;
  onRunTask: (taskId: string) => void;
  onClearHistory?: (task: ScheduledTask) => void;
  onDeleteTask: (task: ScheduledTask) => void;
  onToggleTask: (task: ScheduledTask, enabled: boolean) => void;
  editorInline?: React.ReactNode;
};

type SchedulerTaskEditorFormProps = {
  agentName: string;
  timezone: string;
  timezoneSettingsHref: string;
  draft: SchedulerTaskDraft;
  mode: SchedulerEditorMode;
  isSubmitting?: boolean;
  onDraftChange: (draft: SchedulerTaskDraft) => void;
  onCancel?: () => void;
  onSubmit: () => void;
};

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

function toDateTimeLocalValue(value?: string | null) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const timezoneOffset = date.getTimezoneOffset() * 60 * 1000;
  return new Date(date.getTime() - timezoneOffset).toISOString().slice(0, 16);
}

function promptFromTask(task: ScheduledTask) {
  return task.steps[0]?.agents[0]?.prompt ?? "";
}

function extractReminderMessageFromRecord(record: TaskExecutionRecord): string | null {
  const result = record.result;
  if (!result || typeof result !== "object") {
    return null;
  }
  if (!("reminder" in result)) {
    return null;
  }
  const reminder = result.reminder;
  if (!reminder || typeof reminder !== "object") {
    return null;
  }
  if ("message" in reminder && typeof reminder.message === "string") {
    return reminder.message;
  }
  return null;
}

function extractWorkflowOutputFromRecord(record: TaskExecutionRecord, task: ScheduledTask): string | null {
  const result = record.result;
  if (!result || typeof result !== "object") {
    return null;
  }
  if (!("steps" in result) || typeof result.steps !== "object" || result.steps === null) {
    return null;
  }

  const stepsResult = result.steps as Record<string, unknown>;
  for (let i = task.steps.length - 1; i >= 0; i -= 1) {
    const stepId = task.steps[i]?.id;
    if (!stepId) {
      continue;
    }
    const step = stepsResult[stepId];
    if (!step || typeof step !== "object") {
      continue;
    }
    const results = "results" in step ? (step as { results?: unknown }).results : null;
    if (!Array.isArray(results) || results.length === 0) {
      continue;
    }
    const last = results[results.length - 1] as unknown;
    if (last && typeof last === "object" && "output" in last && typeof last.output === "string") {
      return last.output;
    }
  }
  return null;
}

function extractArtifactsFromRecord(record: TaskExecutionRecord): string[] {
  const result = record.result;
  if (!result || typeof result !== "object") {
    return [];
  }
  if (!("artifacts" in result)) {
    return [];
  }
  const artifacts = result.artifacts;
  if (!Array.isArray(artifacts)) {
    return [];
  }
  return artifacts.filter((item): item is string => typeof item === "string");
}

function extractExecutionLogFromRecord(record: TaskExecutionRecord): string | null {
  const result = record.result;
  if (!result || typeof result !== "object") {
    return null;
  }
  const raw = "execution_log" in result ? result.execution_log : null;
  if (typeof raw !== "string") {
    return null;
  }
  const normalized = raw.trim();
  return normalized ? normalized : null;
}

export function createEmptySchedulerTaskDraft(): SchedulerTaskDraft {
  return {
    name: "",
    triggerType: "cron",
    triggerValue: "0 9 * * *",
    prompt: "",
  };
}

export function createSchedulerTaskDraftFromTask(task: ScheduledTask): SchedulerTaskDraft {
  let triggerValue = "";
  if (task.trigger.type === "cron") {
    triggerValue = task.trigger.cron_expression ?? "";
  } else if (task.trigger.type === "interval") {
    triggerValue = String(task.trigger.interval_seconds ?? "");
  } else {
    triggerValue = toDateTimeLocalValue(task.trigger.scheduled_time);
  }

  return {
    name: task.name,
    triggerType: task.trigger.type,
    triggerValue,
    prompt: promptFromTask(task),
  };
}

function triggerDescription(task: ScheduledTask, copy: ReturnType<typeof useI18n>["t"]["scheduler"]["settings"]) {
  if (task.trigger.type === "cron") {
    return `${copy.trigger.cron}: ${task.trigger.cron_expression ?? "-"}`;
  }
  if (task.trigger.type === "interval") {
    return `${copy.trigger.interval}: ${task.trigger.interval_seconds ?? "-"}s`;
  }
  return `${copy.trigger.once}: ${formatDateTime(task.trigger.scheduled_time)}`;
}

function buildTriggerConfig(draft: SchedulerTaskDraft, timezone: string): TriggerConfig {
  if (draft.triggerType === "cron") {
    return {
      type: "cron",
      cron_expression: draft.triggerValue.trim(),
      timezone,
    };
  }

  if (draft.triggerType === "interval") {
    return {
      type: "interval",
      interval_seconds: Number(draft.triggerValue),
      timezone,
    };
  }

  const date = new Date(draft.triggerValue);
  return {
    type: "once",
    scheduled_time: date.toISOString(),
    timezone,
  };
}

function buildTaskRequest(
  agentName: string,
  timezone: string,
  draft: SchedulerTaskDraft,
  enabled: boolean,
): UpdateScheduledTaskRequest {
  return {
    agent_name: agentName,
    name: draft.name.trim(),
    mode: "workflow",
    description: "",
    trigger: buildTriggerConfig(draft, timezone),
    steps: [
      {
        id: "step-1",
        name: "default-step",
        parallel: false,
        depends_on: [],
        agents: [
          {
            agent_name: agentName,
            prompt: draft.prompt.trim(),
            timeout_seconds: 300,
            retry_on_failure: false,
            max_retries: 0,
          },
        ],
      },
    ],
    enabled,
    max_concurrent_steps: 3,
    timeout_seconds: 3600,
  };
}

function toUpdateRequest(
  task: ScheduledTask,
  timezone: string,
  draft: SchedulerTaskDraft,
  enabled: boolean,
): UpdateScheduledTaskRequest {
  return buildTaskRequest(task.agent_name, timezone, draft, enabled);
}

function toToggleRequest(task: ScheduledTask, enabled: boolean): UpdateScheduledTaskRequest {
  const base: UpdateScheduledTaskRequest = {
    agent_name: task.agent_name,
    name: task.name,
    description: task.description ?? "",
    mode: task.mode,
    trigger: task.trigger,
    steps: task.steps ?? [],
    on_complete: task.on_complete ?? undefined,
    on_failure: task.on_failure ?? undefined,
    notification_webhook: task.notification_webhook ?? undefined,
    max_concurrent_steps: task.max_concurrent_steps,
    timeout_seconds: task.timeout_seconds,
    retry_policy: task.retry_policy ?? undefined,
    enabled,
  };

  if (task.mode === "reminder") {
    return {
      ...base,
      steps: [],
      reminder_title: task.reminder_title ?? task.name,
      reminder_message: task.reminder_message ?? task.description ?? task.name,
    };
  }

  return base;
}

function taskStatusTone(status: ScheduledTask["status"]) {
  switch (status) {
    case "completed":
      return "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300";
    case "running":
      return "bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300";
    case "failed":
      return "bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300";
    case "cancelled":
      return "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300";
    default:
      return "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300";
  }
}

export function SchedulerTaskEditorForm({
  agentName,
  timezone,
  timezoneSettingsHref,
  draft,
  mode,
  isSubmitting = false,
  onDraftChange,
  onCancel,
  onSubmit,
}: SchedulerTaskEditorFormProps) {
  const { t } = useI18n();
  const copy = t.scheduler.settings;
  const editorCopy = copy.editor;

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-dashed border-border/80 bg-muted/25 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium">{editorCopy.timezoneLabel}</p>
            <p className="text-muted-foreground mt-1 text-sm leading-6">
              {editorCopy.timezoneDescription.replace("{timezone}", timezone)}
            </p>
          </div>
          <Button asChild variant="outline" size="sm" className="rounded-xl">
            <Link href={timezoneSettingsHref}>{editorCopy.timezoneAction}</Link>
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        <Label>{editorCopy.nameLabel}</Label>
        <Input
          value={draft.name}
          onChange={(event) => onDraftChange({ ...draft, name: event.target.value })}
          placeholder={editorCopy.namePlaceholder.replace("{agent}", agentName)}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>{editorCopy.triggerTypeLabel}</Label>
          <Select
            value={draft.triggerType}
            onValueChange={(value: TriggerType) => {
              let nextTriggerValue = draft.triggerValue;
              if (value === "cron") {
                nextTriggerValue = draft.triggerType === "cron" ? draft.triggerValue : "0 9 * * *";
              } else if (value === "interval") {
                nextTriggerValue = draft.triggerType === "interval" ? draft.triggerValue : "3600";
              } else {
                nextTriggerValue = draft.triggerType === "once" ? draft.triggerValue : "";
              }
              onDraftChange({
                ...draft,
                triggerType: value,
                triggerValue: nextTriggerValue,
              });
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="cron">{editorCopy.triggerTypeCron}</SelectItem>
              <SelectItem value="interval">{editorCopy.triggerTypeInterval}</SelectItem>
              <SelectItem value="once">{editorCopy.triggerTypeOnce}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>
            {draft.triggerType === "cron"
              ? editorCopy.cronLabel
              : draft.triggerType === "interval"
                ? editorCopy.intervalLabel
                : editorCopy.onceLabel}
          </Label>
          <Input
            type={draft.triggerType === "once" ? "datetime-local" : "text"}
            value={draft.triggerValue}
            onChange={(event) => onDraftChange({ ...draft, triggerValue: event.target.value })}
            placeholder={
              draft.triggerType === "cron"
                ? "0 9 * * *"
                : draft.triggerType === "interval"
                  ? "3600"
                  : "2026-03-15T09:00"
            }
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label>{editorCopy.promptLabel}</Label>
        <Textarea
          value={draft.prompt}
          onChange={(event) => onDraftChange({ ...draft, prompt: event.target.value })}
          className="min-h-40"
          placeholder={editorCopy.promptPlaceholder.replace("{agent}", agentName)}
        />
      </div>

      <div className="flex items-center justify-end gap-2">
        {onCancel ? (
          <Button type="button" variant="outline" onClick={onCancel}>
            {t.common.cancel}
          </Button>
        ) : null}
        <Button type="button" onClick={onSubmit} disabled={isSubmitting}>
          {isSubmitting
            ? mode === "create"
              ? editorCopy.creating
              : editorCopy.saving
            : mode === "create"
              ? editorCopy.createAction
              : editorCopy.saveAction}
        </Button>
      </div>
    </div>
  );
}

export function SchedulerSettingsPanel({
  agentName,
  timezone,
  tasks,
  selectedTask,
  selectedTaskId,
  selectedHistory,
  runningTaskId,
  isLoading = false,
  isHistoryLoading = false,
  onSelectTask,
  onCreateTask,
  onEditTask,
  onRunTask,
  onClearHistory,
  onDeleteTask,
  onToggleTask,
  editorInline,
}: SchedulerSettingsPanelProps) {
  const { t } = useI18n();
  const copy = t.scheduler.settings;
  const [detailRecord, setDetailRecord] = useState<TaskExecutionRecord | null>(null);
  const [processlogTraceId, setProcesslogTraceId] = useState<string | null>(null);
  const [processlogOpen, setProcesslogOpen] = useState(false);
  const successRate = useMemo(() => {
    if (selectedHistory.length === 0) {
      return 0;
    }
    const successCount = selectedHistory.filter((item) => item.success).length;
    return successCount / selectedHistory.length;
  }, [selectedHistory]);

  const gridClassName = editorInline
    ? "grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.75fr)_360px]"
    : "grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]";

  return (
    <div className="space-y-4">
      <Dialog
        open={!!detailRecord}
        onOpenChange={(open) => {
          if (!open) {
            setDetailRecord(null);
          }
        }}
      >
        <DialogContent className="max-h-[85vh] w-full max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>执行详情</DialogTitle>
            <DialogDescription>
              {detailRecord ? (
                <span className="font-mono text-xs">
                  run_id: {detailRecord.run_id}
                  {detailRecord.trace_id ? `  trace_id: ${detailRecord.trace_id}` : ""}
                </span>
              ) : null}
            </DialogDescription>
          </DialogHeader>

          {detailRecord ? (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl bg-muted/40 p-3">
                  <div className="text-muted-foreground text-xs">开始</div>
                  <div className="mt-1 text-sm font-medium">{formatDateTime(detailRecord.started_at)}</div>
                </div>
                <div className="rounded-xl bg-muted/40 p-3">
                  <div className="text-muted-foreground text-xs">结束</div>
                  <div className="mt-1 text-sm font-medium">{formatDateTime(detailRecord.completed_at)}</div>
                </div>
              </div>

              {detailRecord.error ? (
                <div className="rounded-2xl border border-border/80 bg-rose-500/5 p-3 text-sm text-rose-700 dark:text-rose-200">
                  {detailRecord.error}
                </div>
              ) : null}

              {extractExecutionLogFromRecord(detailRecord) ? (
                <div className="rounded-2xl border border-border/80 bg-muted/20 p-3">
                  <div className="text-muted-foreground text-xs">执行日志</div>
                  <div className="mt-2 text-sm leading-6">
                    <MarkdownContent
                      content={extractExecutionLogFromRecord(detailRecord) ?? ""}
                      isLoading={false}
                      rehypePlugins={[]}
                      className="my-0"
                    />
                  </div>
                </div>
              ) : null}

              {selectedTask?.mode === "reminder" ? (
                <div className="rounded-2xl border border-border/80 bg-muted/20 p-3">
                  <div className="text-muted-foreground text-xs">提醒内容</div>
                  <div className="mt-2 whitespace-pre-wrap text-sm leading-6">
                    {extractReminderMessageFromRecord(detailRecord) ?? "-"}
                  </div>
                </div>
              ) : selectedTask?.mode === "workflow" ? (
                <div className="rounded-2xl border border-border/80 bg-muted/20 p-3">
                  <div className="text-muted-foreground text-xs">输出摘要</div>
                  <div className="mt-2 whitespace-pre-wrap text-sm leading-6">
                    {extractWorkflowOutputFromRecord(detailRecord, selectedTask) ?? "-"}
                  </div>
                </div>
              ) : null}

              {extractArtifactsFromRecord(detailRecord).length > 0 ? (
                <div className="rounded-2xl border border-border/80 bg-muted/20 p-3">
                  <div className="text-muted-foreground text-xs">产物</div>
                  <div className="mt-2 space-y-1">
                    {extractArtifactsFromRecord(detailRecord).slice(0, 20).map((path) => (
                      <div key={path} className="font-mono text-xs text-muted-foreground">
                        {path}
                      </div>
                    ))}
                    {extractArtifactsFromRecord(detailRecord).length > 20 ? (
                      <div className="text-muted-foreground text-xs">
                        仅展示前 20 个产物路径
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {detailRecord.result ? (
                <details className="rounded-2xl border border-border/80 p-3">
                  <summary className="text-muted-foreground cursor-pointer text-xs">
                    查看原始结果 (JSON)
                  </summary>
                  <pre className="mt-2 max-h-[45vh] overflow-auto rounded-xl bg-muted/30 p-3 text-xs leading-5">
                    {JSON.stringify(detailRecord.result, null, 2)}
                  </pre>
                </details>
              ) : null}
            </div>
          ) : null}

          <DialogFooter className="flex flex-wrap justify-between gap-2">
            <div className="flex flex-wrap gap-2">
              {detailRecord?.thread_id ? (
                <Button asChild variant="outline">
                  <Link href={`/workspace/chats/${encodeURIComponent(detailRecord.thread_id)}`}>
                    打开会话
                  </Link>
                </Button>
              ) : null}
              {detailRecord?.trace_id ? (
                <Button
                  variant="outline"
                  onClick={() => {
                    setProcesslogTraceId(detailRecord.trace_id ?? null);
                    setProcesslogOpen(true);
                  }}
                >
                  系统事件
                </Button>
              ) : null}
            </div>
            <Button variant="outline" onClick={() => setDetailRecord(null)}>
              {t.common.close}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ProcesslogViewerDialog
        traceId={processlogTraceId}
        open={processlogOpen}
        onOpenChange={(open) => {
          setProcesslogOpen(open);
          if (!open) {
            setProcesslogTraceId(null);
          }
        }}
      />

      <Card className="rounded-2xl border-border/80 shadow-sm">
        <CardHeader className="gap-4 md:flex-row md:items-end md:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Badge variant="outline">{copy.badge}</Badge>
              <Badge variant="secondary">{copy.timezoneBadge.replace("{timezone}", timezone)}</Badge>
            </div>
            <div className="space-y-1">
              <CardTitle className="text-xl">{copy.title.replace("{agent}", agentName)}</CardTitle>
              <CardDescription className="max-w-3xl leading-6">
                {copy.description}
              </CardDescription>
            </div>
          </div>

          <div className="flex gap-2">
            <Button className="rounded-xl" onClick={onCreateTask}>
              <PlusIcon className="size-4" />
              {copy.createTask}
            </Button>
          </div>
        </CardHeader>
      </Card>

      <div className={gridClassName}>
        <Card className="rounded-2xl border-border/80 shadow-sm">
          <CardHeader>
            <CardTitle>{copy.taskListTitle}</CardTitle>
            <CardDescription>{copy.taskListDescription}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {isLoading ? (
              <p className="text-sm text-muted-foreground">{copy.loading}</p>
            ) : tasks.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border/80 bg-muted/20 p-5">
                <p className="text-sm font-medium">{copy.emptyTitle}</p>
                <p className="text-muted-foreground mt-2 text-sm leading-6">{copy.emptyDescription}</p>
              </div>
            ) : (
              tasks.map((task) => {
                const isRunning = task.status === "running" || runningTaskId === task.id;
                return (
                  <div
                    key={task.id}
                    onClick={() => onSelectTask(task.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onSelectTask(task.id);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                    className={`w-full cursor-pointer rounded-2xl border p-4 text-left transition-colors ${selectedTaskId === task.id ? "border-primary/50 bg-primary/5" : "border-border/80 hover:bg-muted/30"}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-sm font-medium">{task.name}</p>
                          <span className={`rounded-full px-2 py-1 text-[11px] font-medium ${taskStatusTone(task.status)}`}>
                            {copy.status[task.status]}
                          </span>
                        </div>
                        <div className="text-muted-foreground space-y-1 text-xs leading-5">
                          <p>{triggerDescription(task, copy)}</p>
                          <p>{copy.nextRunPrefix}{formatDateTime(task.next_run_at)}</p>
                        </div>
                      </div>

                      <div
                        className="flex shrink-0 items-center gap-1"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <div className="mr-1 flex items-center gap-2 rounded-full border border-border/70 bg-background/90 px-2 py-1">
                          <Switch
                            checked={task.enabled}
                            disabled={isRunning}
                            onCheckedChange={(enabled) => onToggleTask(task, enabled)}
                          />
                          <span className="text-muted-foreground text-xs">
                            {task.enabled ? copy.enabledLabel : copy.disabledLabel}
                          </span>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => onRunTask(task.id)}
                          disabled={isRunning}
                        >
                          {isRunning ? (
                            <Loader2Icon className="size-4 animate-spin" />
                          ) : (
                            <PlayCircleIcon className="size-4" />
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => onEditTask(task)}
                          disabled={isRunning || task.mode !== "workflow"}
                        >
                          <SquarePenIcon className="size-4" />
                        </Button>
                        <Button variant="ghost" size="icon-sm" onClick={() => onDeleteTask(task)} disabled={isRunning}>
                          <Trash2Icon className="size-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-border/80 shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <HistoryIcon className="size-4 text-primary" />
              {copy.historyTitle}
            </CardTitle>
            <CardDescription>
              {selectedTask ? selectedTask.name : copy.historyEmptyHint}
            </CardDescription>
            {selectedTask && onClearHistory ? (
              <CardAction>
                <Button
                  variant="link"
                  size="sm"
                  className="h-auto px-0 py-0 text-xs font-medium text-muted-foreground hover:text-foreground motion-safe:transition-all motion-safe:hover:-translate-y-0.5"
                  disabled={isHistoryLoading || selectedHistory.length === 0}
                  onClick={() => onClearHistory(selectedTask)}
                >
                  {copy.clearHistory}
                </Button>
              </CardAction>
            ) : null}
          </CardHeader>
          <CardContent className="space-y-4">
            {selectedTask ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl bg-muted/40 p-3">
                  <div className="text-muted-foreground text-xs">{copy.metrics.historyCount}</div>
                  <div className="mt-1 text-xl font-semibold">{selectedHistory.length}</div>
                </div>
                <div className="rounded-xl bg-muted/40 p-3">
                  <div className="text-muted-foreground text-xs">{copy.metrics.successRate}</div>
                  <div className="mt-1 text-xl font-semibold">{formatPercent(successRate)}</div>
                </div>
              </div>
            ) : null}

            {isHistoryLoading ? (
              <p className="text-sm text-muted-foreground">{copy.loading}</p>
            ) : !selectedTask ? (
              /* 空态提示已在 CardDescription 展示，避免重复渲染同一条文案。 */
              null
            ) : selectedHistory.length === 0 ? (
              <p className="text-sm text-muted-foreground">{copy.noHistory}</p>
            ) : (
              <div className="space-y-3">
                {selectedHistory.map((record) => (
                  <div key={record.run_id} className="rounded-2xl border border-border/80 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1">
                        <p className="text-sm font-medium">{formatDateTime(record.started_at)}</p>
                        <div className="text-muted-foreground text-xs leading-5">
                          <p>{copy.historyStartPrefix}{formatDateTime(record.started_at)}</p>
                          <p>{copy.historyEndPrefix}{formatDateTime(record.completed_at)}</p>
                        </div>
                      </div>
                      <span className={`rounded-full px-2 py-1 text-[11px] font-medium ${taskStatusTone(record.status)}`}>
                        {copy.status[record.status]}
                      </span>
                    </div>

                    {selectedTask?.mode === "reminder" && record.success ? (
                      <p className="text-muted-foreground mt-3 whitespace-pre-wrap text-xs leading-5">
                        {extractReminderMessageFromRecord(record) ?? "-"}
                      </p>
                    ) : selectedTask?.mode === "workflow" && record.success ? (
                      <p className="text-muted-foreground mt-3 whitespace-pre-wrap text-xs leading-5">
                        {(extractWorkflowOutputFromRecord(record, selectedTask) ?? "").trim()
                          ? extractWorkflowOutputFromRecord(record, selectedTask)
                          : "-"}
                      </p>
                    ) : null}

                    {record.error ? (
                      <p className="mt-3 text-xs leading-5 text-rose-600 dark:text-rose-300">
                        {copy.historyErrorPrefix}{record.error}
                      </p>
                    ) : null}

                    <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
                      {record.thread_id ? (
                        <Button asChild variant="outline" size="sm">
                          <Link href={`/workspace/chats/${encodeURIComponent(record.thread_id)}`}>
                            打开会话
                          </Link>
                        </Button>
                      ) : null}
                      {record.trace_id ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setProcesslogTraceId(record.trace_id ?? null);
                            setProcesslogOpen(true);
                          }}
                        >
                          系统事件
                        </Button>
                      ) : null}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setDetailRecord(record);
                        }}
                      >
                        执行日志
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {editorInline}
      </div>
    </div>
  );
}

export function AgentSchedulerSettingsSection({ agentName }: { agentName: string }) {
  const { t } = useI18n();
  const copy = t.scheduler.settings;
  const { settings: heartbeatSettings } = useHeartbeatSettings(agentName);
  const timezone = heartbeatSettings?.timezone ?? "UTC";
  const timezoneSettingsHref = `/workspace/agents/${encodeURIComponent(agentName)}/settings?section=heartbeat`;

  const { tasks, isLoading } = useScheduledTasks(agentName);
  const createMutation = useCreateScheduledTask(agentName);
  const updateMutation = useUpdateScheduledTask(agentName);
  const deleteMutation = useDeleteScheduledTask(agentName);
  const runMutation = useRunScheduledTaskNow(agentName);
  const clearHistoryMutation = useClearScheduledTaskHistory();

  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<SchedulerEditorMode>("create");
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [draft, setDraft] = useState<SchedulerTaskDraft>(createEmptySchedulerTaskDraft());
  const [taskPendingDelete, setTaskPendingDelete] = useState<ScheduledTask | null>(null);
  const [taskPendingClearHistory, setTaskPendingClearHistory] = useState<ScheduledTask | null>(null);
  const [runningTaskId, setRunningTaskId] = useState<string | null>(null);

  const { history, isLoading: isHistoryLoading } = useScheduledTaskHistory(selectedTaskId);

  useEffect(() => {
    if (!selectedTaskId) {
      if (tasks.length > 0) {
        setSelectedTaskId(tasks[0]?.id ?? null);
      }
      return;
    }

    // Keep selection if the task still exists.
    if (tasks.some((task) => task.id === selectedTaskId)) {
      return;
    }

    if (tasks.length === 0) {
      setSelectedTaskId(null);
      return;
    }

    setSelectedTaskId(tasks[0]?.id ?? null);
  }, [selectedTaskId, tasks]);

  const taskBeingEdited = tasks.find((task) => task.id === editingTaskId) ?? null;
  const selectedTaskForPanel = useMemo(
    () => tasks.find((task) => task.id === selectedTaskId) ?? null,
    [selectedTaskId, tasks],
  );

  const validateDraft = () => {
    if (!draft.name.trim() || !draft.prompt.trim()) {
      toast.error(copy.validation.required, { toasterId: "scheduler" });
      return false;
    }

    if (draft.triggerType === "interval") {
      const seconds = Number(draft.triggerValue);
      if (!Number.isFinite(seconds) || seconds <= 0) {
        toast.error(copy.validation.invalidInterval, { toasterId: "scheduler" });
        return false;
      }
    }

    if (draft.triggerType === "once") {
      const date = new Date(draft.triggerValue);
      if (Number.isNaN(date.getTime())) {
        toast.error(copy.validation.invalidScheduleTime, { toasterId: "scheduler" });
        return false;
      }
    }

    if (draft.triggerType === "cron" && !draft.triggerValue.trim()) {
      toast.error(copy.validation.invalidCron, { toasterId: "scheduler" });
      return false;
    }

    return true;
  };

  const openCreate = () => {
    setEditorMode("create");
    setEditingTaskId(null);
    setDraft(createEmptySchedulerTaskDraft());
    setEditorOpen(true);
  };

  const openEdit = (task: ScheduledTask) => {
    setEditorMode("edit");
    setEditingTaskId(task.id);
    setDraft(createSchedulerTaskDraftFromTask(task));
    setEditorOpen(true);
  };

  const handleSubmit = async () => {
    if (!validateDraft()) {
      return;
    }

    try {
      if (editorMode === "create") {
        const created = await createMutation.mutateAsync(
          buildTaskRequest(agentName, timezone, draft, true),
        );
        setSelectedTaskId(created.id);
        toast.success(copy.toastCreateSuccess, { toasterId: "scheduler" });
      } else if (taskBeingEdited) {
        await updateMutation.mutateAsync({
          taskId: taskBeingEdited.id,
          request: toUpdateRequest(taskBeingEdited, timezone, draft, taskBeingEdited.enabled),
        });
        setSelectedTaskId(taskBeingEdited.id);
        toast.success(copy.toastUpdateSuccess, { toasterId: "scheduler" });
      }
      setEditorOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : copy.toastSaveFailed, { toasterId: "scheduler" });
    }
  };

  const handleToggleTask = async (task: ScheduledTask, enabled: boolean) => {
    try {
      await updateMutation.mutateAsync({
        taskId: task.id,
        request: toToggleRequest(task, enabled),
      });
      toast.success(enabled ? copy.toastEnabled : copy.toastDisabled, { toasterId: "scheduler" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : copy.toastSaveFailed, { toasterId: "scheduler" });
    }
  };

  const handleRunTask = async (taskId: string) => {
    if (runningTaskId) {
      return;
    }
    setRunningTaskId(taskId);
    try {
      await runMutation.mutateAsync(taskId);
      // 立即执行属于“触发动作”而不是“结果”，此处不再弹出「已触发执行/run_id」提示。
      // 任务完成/失败由 SchedulerTaskWatcher 统一给出结果通知，避免重复打扰。
      setSelectedTaskId(taskId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : copy.toastRunFailed, { toasterId: "scheduler" });
    } finally {
      setRunningTaskId(null);
    }
  };

  const handleDeleteTask = async () => {
    if (!taskPendingDelete) {
      return;
    }

    try {
      await deleteMutation.mutateAsync(taskPendingDelete.id);
      if (selectedTaskId === taskPendingDelete.id) {
        setSelectedTaskId(null);
      }
      toast.success(copy.toastDeleteSuccess, { toasterId: "scheduler" });
      setTaskPendingDelete(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : copy.toastDeleteFailed, { toasterId: "scheduler" });
    }
  };

  const handleClearHistory = async () => {
    if (!taskPendingClearHistory) {
      return;
    }

    try {
      await clearHistoryMutation.mutateAsync(taskPendingClearHistory.id);
      // 成功反馈交给 UI 自身变化（记录数归零、列表清空），避免额外 success toast 打扰。
      setTaskPendingClearHistory(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : copy.toastClearHistoryFailed, { toasterId: "scheduler" });
    }
  };

  return (
    <>
      <SchedulerSettingsPanel
        agentName={agentName}
        timezone={timezone}
        timezoneSettingsHref={timezoneSettingsHref}
        tasks={tasks}
        selectedTask={selectedTaskForPanel}
        selectedTaskId={selectedTaskId}
        selectedHistory={history}
        runningTaskId={runningTaskId}
        isLoading={isLoading}
        isHistoryLoading={isHistoryLoading}
        onSelectTask={setSelectedTaskId}
        onCreateTask={openCreate}
        onEditTask={openEdit}
        onRunTask={handleRunTask}
        onClearHistory={setTaskPendingClearHistory}
        onDeleteTask={setTaskPendingDelete}
        onToggleTask={handleToggleTask}
      />

      <Sheet open={editorOpen} onOpenChange={setEditorOpen}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
          <SheetHeader className="border-b px-6 py-5">
            <SheetTitle>
              {editorMode === "create" ? copy.editor.createTitle : copy.editor.editTitle}
            </SheetTitle>
            <SheetDescription>
              {editorMode === "create" ? copy.editor.createDescription : copy.editor.editDescription}
            </SheetDescription>
          </SheetHeader>

          <div className="px-6 py-5">
            <SchedulerTaskEditorForm
              agentName={agentName}
              timezone={timezone}
              timezoneSettingsHref={timezoneSettingsHref}
              draft={draft}
              mode={editorMode}
              isSubmitting={createMutation.isPending || updateMutation.isPending}
              onDraftChange={setDraft}
              onCancel={() => setEditorOpen(false)}
              onSubmit={() => {
                void handleSubmit();
              }}
            />
          </div>
        </SheetContent>
      </Sheet>

      <ConfirmActionDialog
        open={!!taskPendingDelete}
        onOpenChange={(open) => {
          if (!open) {
            setTaskPendingDelete(null);
          }
        }}
        title={copy.deleteDialogTitle}
        description={
          taskPendingDelete
            ? copy.deleteDialogDescription.replace("{name}", taskPendingDelete.name)
            : copy.deleteDialogDescription.replace("{name}", "")
        }
        confirmText={copy.deleteDialogConfirm}
        confirmVariant="destructive"
        confirmDisabled={deleteMutation.isPending}
        onConfirm={() => {
          void handleDeleteTask();
        }}
      />

      <ConfirmActionDialog
        open={!!taskPendingClearHistory}
        onOpenChange={(open) => {
          if (!open) {
            setTaskPendingClearHistory(null);
          }
        }}
        title={copy.clearHistoryDialogTitle}
        description={
          taskPendingClearHistory
            ? copy.clearHistoryDialogDescription.replace("{name}", taskPendingClearHistory.name)
            : copy.clearHistoryDialogDescription.replace("{name}", "")
        }
        confirmText={copy.clearHistoryDialogConfirm}
        confirmVariant="destructive"
        confirmDisabled={clearHistoryMutation.isPending}
        onConfirm={() => {
          void handleClearHistory();
        }}
      />
    </>
  );
}
