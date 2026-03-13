"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

import { getBackendBaseURL } from "@/core/config";
import { useI18n } from "@/core/i18n/hooks";
import { useNotification } from "@/core/notification/hooks";
import type { ScheduledTask } from "@/core/scheduler";

const TASKS_QUERY_KEY_PREFIX = ["scheduler", "tasks"] as const;
const HISTORY_QUERY_KEY_PREFIX = ["scheduler", "history"] as const;
const DASHBOARD_QUERY_KEY = ["scheduler", "dashboard"] as const;

function signatureOf(task: ScheduledTask): string {
  return `${task.last_run_at ?? ""}:${task.status}`;
}

function excerpt(text: string, max = 200): string {
  const normalized = text.trim();
  if (!normalized) {
    return normalized;
  }
  return normalized.length > max ? normalized.slice(0, max) + "..." : normalized;
}

function reminderBody(task: ScheduledTask): string {
  const resultReminder = task.last_result?.reminder;
  if (
    resultReminder &&
    typeof resultReminder === "object" &&
    "message" in resultReminder &&
    typeof resultReminder.message === "string"
  ) {
    return resultReminder.message;
  }
  if (task.reminder_message) {
    return task.reminder_message;
  }
  if (task.description) {
    return task.description;
  }
  return task.name;
}

function workflowOutput(task: ScheduledTask): string | null {
  const lastResult = task.last_result;
  if (!lastResult || typeof lastResult !== "object") {
    return null;
  }
  const stepsResult = "steps" in lastResult ? lastResult.steps : null;
  if (!stepsResult || typeof stepsResult !== "object") {
    return null;
  }
  const stepsObj = stepsResult as Record<string, unknown>;

  for (let i = task.steps.length - 1; i >= 0; i -= 1) {
    const stepId = task.steps[i]?.id;
    if (!stepId) {
      continue;
    }
    const step = stepsObj[stepId];
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

function errorOf(task: ScheduledTask): string | null {
  if (task.last_error) {
    return task.last_error;
  }
  const lastResult = task.last_result;
  if (lastResult && typeof lastResult === "object" && "error" in lastResult && typeof lastResult.error === "string") {
    return lastResult.error;
  }
  return null;
}

type SchedulerSnapshotEvent = {
  timestamp?: string;
  tasks?: ScheduledTask[];
};

type SchedulerTaskUpsertedEvent = {
  reason?: string;
  task?: ScheduledTask;
};

type SchedulerTaskDeletedEvent = {
  task_id?: string;
  agent_name?: string | null;
};

type SchedulerTaskRunEvent = {
  task_id?: string;
  agent_name?: string | null;
  task?: ScheduledTask | null;
  record?: {
    run_id?: string;
    status?: string;
    success?: boolean;
    started_at?: string;
    completed_at?: string | null;
  } | null;
};

type SchedulerTaskRunLogUpdatedEvent = {
  task_id?: string;
  run_id?: string;
};

function sortTasks(tasks: ScheduledTask[]): ScheduledTask[] {
  return [...tasks].sort((a, b) => b.created_at.localeCompare(a.created_at));
}

function upsertTask(list: ScheduledTask[] | undefined, task: ScheduledTask): ScheduledTask[] {
  const previous = Array.isArray(list) ? list : [];
  const index = previous.findIndex((item) => item.id === task.id);
  if (index === -1) {
    return sortTasks([task, ...previous]);
  }
  const next = [...previous];
  next[index] = task;
  return sortTasks(next);
}

function removeTask(list: ScheduledTask[] | undefined, taskId: string): ScheduledTask[] {
  const previous = Array.isArray(list) ? list : [];
  return previous.filter((item) => item.id !== taskId);
}

export function SchedulerTaskWatcher() {
  const { t } = useI18n();
  const initializedRef = useRef(false);
  const lastSeenRef = useRef<Record<string, string>>({});
  const { showNotification } = useNotification();
  const queryClient = useQueryClient();

  useEffect(() => {
    let disposed = false;
    let reconnectTimer: number | null = null;
    let source: EventSource | null = null;

    const reconnectDelayMs = 2_500;

    const syncTaskCaches = (tasks: ScheduledTask[]) => {
      const normalized = sortTasks(tasks);

      queryClient.setQueryData([...TASKS_QUERY_KEY_PREFIX, "all"], normalized);
      const perAgent: Record<string, ScheduledTask[]> = {};
      for (const task of normalized) {
        const bucket = (perAgent[task.agent_name] ??= []);
        bucket.push(task);
      }
      for (const [agentName, agentTasks] of Object.entries(perAgent)) {
        queryClient.setQueryData([...TASKS_QUERY_KEY_PREFIX, agentName], agentTasks);
      }

      // Keep detail caches warm for views that are open.
      for (const task of normalized) {
        queryClient.setQueryData([...TASKS_QUERY_KEY_PREFIX, "detail", task.id], task);
      }
    };

    const notifyTaskFinished = (task: ScheduledTask) => {
      if (!task.last_run_at) {
        return;
      }
      if (task.status !== "completed" && task.status !== "failed") {
        return;
      }

      const isForeground = !document.hidden && document.hasFocus();
      const isFailure = task.status === "failed";
      const title =
        task.mode === "reminder"
          ? task.reminder_title ?? task.name ?? t.scheduler.taskManager.reminderFallbackTitle
          : isFailure
            ? `任务失败：${task.name}`
            : `任务完成：${task.name}`;

      const body = excerpt(
        isFailure
          ? errorOf(task) ?? "执行失败"
          : task.mode === "reminder"
            ? reminderBody(task)
            : workflowOutput(task) ?? "执行完成",
        240,
      );

      if (isForeground) {
        const toastId = `scheduler-task-${task.id}-${task.last_run_at}`;
        const toastFn = isFailure ? toast.error : toast.success;
        toastFn(title, {
          id: toastId,
          toasterId: "scheduler",
          description: <span className="whitespace-pre-line">{body}</span>,
          duration: Infinity,
          dismissible: false,
          action: {
            label: "确认",
            onClick: () => {
              toast.dismiss(toastId);
            },
          },
        });
      } else {
        showNotification(title, {
          body,
          tag: `scheduler-task-${task.id}-${task.last_run_at}`,
          requireInteraction: true,
        });
      }
    };

    const handleSnapshot = (tasks: ScheduledTask[]) => {
      syncTaskCaches(tasks);

      const nextSeen: Record<string, string> = {};
      for (const task of tasks) {
        nextSeen[task.id] = signatureOf(task);
      }

      if (!initializedRef.current) {
        initializedRef.current = true;
        lastSeenRef.current = nextSeen;
        return;
      }

      // On reconnect, we may have missed a few events. Diff snapshot and surface any
      // finished runs so notifications remain best-effort "at least once".
      for (const task of tasks) {
        const nextSignature = nextSeen[task.id];
        const previousSignature = lastSeenRef.current[task.id];
        if (!nextSignature || !previousSignature || nextSignature === previousSignature) {
          continue;
        }
        notifyTaskFinished(task);
        void queryClient.invalidateQueries({ queryKey: [...HISTORY_QUERY_KEY_PREFIX, task.id] });
      }
      void queryClient.invalidateQueries({ queryKey: DASHBOARD_QUERY_KEY });

      lastSeenRef.current = nextSeen;
    };

    const openStream = () => {
      if (disposed) {
        return;
      }

      source = new EventSource(`${getBackendBaseURL()}/api/scheduler/events`);

      source.addEventListener("snapshot", (raw) => {
        if (disposed) {
          return;
        }
        try {
          const event = raw as MessageEvent<string>;
          const payload = JSON.parse(event.data) as SchedulerSnapshotEvent;
          const tasks = Array.isArray(payload.tasks) ? payload.tasks : [];
          handleSnapshot(tasks);
        } catch {
          // Ignore parse errors (backward compatible).
        }
      });

      source.addEventListener("task_upserted", (raw) => {
        if (disposed) {
          return;
        }
        try {
          const event = raw as MessageEvent<string>;
          const payload = JSON.parse(event.data) as SchedulerTaskUpsertedEvent;
          const task = payload.task;
          if (!task) {
            return;
          }

          queryClient.setQueryData(
            [...TASKS_QUERY_KEY_PREFIX, "all"],
            (prev: ScheduledTask[] | undefined) => upsertTask(prev, task),
          );
          queryClient.setQueryData(
            [...TASKS_QUERY_KEY_PREFIX, task.agent_name],
            (prev: ScheduledTask[] | undefined) => upsertTask(prev, task),
          );
          queryClient.setQueryData([...TASKS_QUERY_KEY_PREFIX, "detail", task.id], task);
          lastSeenRef.current[task.id] = signatureOf(task);
        } catch {
          // Ignore parse errors.
        }
      });

      source.addEventListener("task_deleted", (raw) => {
        if (disposed) {
          return;
        }
        try {
          const event = raw as MessageEvent<string>;
          const payload = JSON.parse(event.data) as SchedulerTaskDeletedEvent;
          const taskId = payload.task_id;
          if (!taskId) {
            return;
          }
          queryClient.setQueryData(
            [...TASKS_QUERY_KEY_PREFIX, "all"],
            (prev: ScheduledTask[] | undefined) => removeTask(prev, taskId),
          );
          if (payload.agent_name) {
            queryClient.setQueryData(
              [...TASKS_QUERY_KEY_PREFIX, payload.agent_name],
              (prev: ScheduledTask[] | undefined) => removeTask(prev, taskId),
            );
          }
          void queryClient.removeQueries({ queryKey: [...TASKS_QUERY_KEY_PREFIX, "detail", taskId] });
          delete lastSeenRef.current[taskId];
        } catch {
          // Ignore parse errors.
        }
      });

      const handleRunEvent = (payload: SchedulerTaskRunEvent, isFinished: boolean) => {
        const task = payload.task ?? null;
        if (!task) {
          return;
        }

        queryClient.setQueryData(
          [...TASKS_QUERY_KEY_PREFIX, "all"],
          (prev: ScheduledTask[] | undefined) => upsertTask(prev, task),
        );
        queryClient.setQueryData(
          [...TASKS_QUERY_KEY_PREFIX, task.agent_name],
          (prev: ScheduledTask[] | undefined) => upsertTask(prev, task),
        );
        queryClient.setQueryData([...TASKS_QUERY_KEY_PREFIX, "detail", task.id], task);

        const nextSignature = signatureOf(task);
        const previousSignature = lastSeenRef.current[task.id];
        lastSeenRef.current[task.id] = nextSignature;

        if (!isFinished) {
          return;
        }

        // Refresh history + dashboard metrics for this task.
        void queryClient.invalidateQueries({ queryKey: [...HISTORY_QUERY_KEY_PREFIX, task.id] });
        void queryClient.invalidateQueries({ queryKey: DASHBOARD_QUERY_KEY });

        // Best-effort dedupe across reconnects.
        if (previousSignature && previousSignature === nextSignature) {
          return;
        }
        notifyTaskFinished(task);
      };

      source.addEventListener("task_run_started", (raw) => {
        if (disposed) {
          return;
        }
        try {
          const event = raw as MessageEvent<string>;
          const payload = JSON.parse(event.data) as SchedulerTaskRunEvent;
          handleRunEvent(payload, false);
        } catch {
          // Ignore parse errors.
        }
      });

      source.addEventListener("task_run_finished", (raw) => {
        if (disposed) {
          return;
        }
        try {
          const event = raw as MessageEvent<string>;
          const payload = JSON.parse(event.data) as SchedulerTaskRunEvent;
          handleRunEvent(payload, true);
        } catch {
          // Ignore parse errors.
        }
      });

      source.addEventListener("task_run_log_updated", (raw) => {
        if (disposed) {
          return;
        }
        try {
          const event = raw as MessageEvent<string>;
          const payload = JSON.parse(event.data) as SchedulerTaskRunLogUpdatedEvent;
          const taskId = payload.task_id;
          if (!taskId) {
            return;
          }
          void queryClient.invalidateQueries({ queryKey: [...HISTORY_QUERY_KEY_PREFIX, taskId] });
        } catch {
          // Ignore parse errors.
        }
      });

      source.onerror = () => {
        if (disposed) {
          return;
        }
        source?.close();
        source = null;
        if (reconnectTimer != null) {
          window.clearTimeout(reconnectTimer);
        }
        reconnectTimer = window.setTimeout(openStream, reconnectDelayMs);
      };
    };

    openStream();

    return () => {
      disposed = true;
      if (reconnectTimer != null) {
        window.clearTimeout(reconnectTimer);
      }
      source?.close();
    };
  }, [queryClient, showNotification, t.scheduler.taskManager.reminderFallbackTitle]);

  return null;
}
