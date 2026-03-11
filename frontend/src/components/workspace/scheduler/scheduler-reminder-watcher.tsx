"use client";

import { useEffect, useRef } from "react";

import { useI18n } from "@/core/i18n/hooks";
import { useNotification } from "@/core/notification/hooks";
import { listScheduledTasks } from "@/core/scheduler";
import type { ScheduledTask } from "@/core/scheduler";

const POLL_INTERVAL_MS = 30_000;

function signatureOf(task: ScheduledTask): string {
  return `${task.last_run_at ?? ""}:${task.status}`;
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

export function SchedulerReminderWatcher() {
  const { t } = useI18n();
  const initializedRef = useRef(false);
  const lastSeenRef = useRef<Record<string, string>>({});
  const { showNotification } = useNotification();

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      try {
        const tasks = await listScheduledTasks();
        if (cancelled) {
          return;
        }
        const reminders = tasks.filter(
          (task) => task.mode === "reminder" && task.enabled,
        );

        const nextSeen: Record<string, string> = {};
        for (const task of reminders) {
          nextSeen[task.id] = signatureOf(task);
        }

        if (!initializedRef.current) {
          initializedRef.current = true;
          lastSeenRef.current = nextSeen;
          return;
        }

        for (const task of reminders) {
          const nextSignature = nextSeen[task.id];
          const previousSignature = lastSeenRef.current[task.id];
          if (!nextSignature || !previousSignature || nextSignature === previousSignature) {
            continue;
          }
          if (!task.last_run_at || task.status !== "completed") {
            continue;
          }
          if (!(document.hidden || !document.hasFocus())) {
            continue;
          }

          const title = task.reminder_title ?? task.name ?? t.scheduler.taskManager.reminderFallbackTitle;
          showNotification(title, {
            body: reminderBody(task),
            tag: `scheduler-reminder-${task.id}-${task.last_run_at}`,
          });
        }

        lastSeenRef.current = nextSeen;
      } catch {
        // Ignore polling errors to avoid interrupting chat experience.
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
  }, [showNotification]);

  return null;
}
