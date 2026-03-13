"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

import { useI18n } from "@/core/i18n/hooks";
import { useNotification } from "@/core/notification/hooks";
import { listScheduledTasks } from "@/core/scheduler";
import type { ScheduledTask } from "@/core/scheduler";

const POLL_INTERVAL_MS = 3_000;
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

export function SchedulerTaskWatcher() {
  const { t } = useI18n();
  const initializedRef = useRef(false);
  const lastSeenRef = useRef<Record<string, string>>({});
  const { showNotification } = useNotification();
  const queryClient = useQueryClient();

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      try {
        const tasks = await listScheduledTasks();
        if (cancelled) {
          return;
        }

        // Keep react-query caches in sync so scheduler pages update without manual refresh.
        queryClient.setQueryData([...TASKS_QUERY_KEY_PREFIX, "all"], tasks);
        const perAgent: Record<string, ScheduledTask[]> = {};
        for (const task of tasks) {
          const bucket = (perAgent[task.agent_name] ??= []);
          bucket.push(task);
        }
        for (const [agentName, agentTasks] of Object.entries(perAgent)) {
          queryClient.setQueryData([...TASKS_QUERY_KEY_PREFIX, agentName], agentTasks);
        }

        const nextSeen: Record<string, string> = {};
        for (const task of tasks) {
          nextSeen[task.id] = signatureOf(task);
        }

        if (!initializedRef.current) {
          initializedRef.current = true;
          lastSeenRef.current = nextSeen;
          return;
        }

        for (const task of tasks) {
          const nextSignature = nextSeen[task.id];
          const previousSignature = lastSeenRef.current[task.id];
          if (!nextSignature || !previousSignature || nextSignature === previousSignature) {
            continue;
          }
          if (!task.last_run_at) {
            continue;
          }
          if (task.status !== "completed" && task.status !== "failed") {
            continue;
          }

          // Refresh history + dashboard metrics for this task.
          void queryClient.invalidateQueries({
            queryKey: [...HISTORY_QUERY_KEY_PREFIX, task.id],
          });
          void queryClient.invalidateQueries({ queryKey: DASHBOARD_QUERY_KEY });

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

        }

        lastSeenRef.current = nextSeen;
      } catch {
        // Ignore polling errors to avoid interrupting user experience.
      }
    };

    void poll();
    const timer = window.setInterval(() => {
      void poll();
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [queryClient, showNotification, t.scheduler.taskManager.reminderFallbackTitle]);

  return null;
}
