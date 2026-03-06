import { getBackendBaseURL } from "@/core/config";

import type {
  CreateScheduledTaskRequest,
  ScheduledTask,
  TaskExecutionRecord,
  UpdateScheduledTaskRequest,
} from "./types";

async function parseJSONOrNull(response: Response) {
  return response.json().catch(() => null) as Promise<
    | Record<string, unknown>
    | {
        detail?: string;
      }
    | null
  >;
}

function extractErrorDetail(data: unknown): string | undefined {
  if (typeof data !== "object" || data === null) {
    return undefined;
  }
  if ("detail" in data && typeof data.detail === "string") {
    return data.detail;
  }
  return undefined;
}

export async function listScheduledTasks(): Promise<ScheduledTask[]> {
  const response = await fetch(`${getBackendBaseURL()}/api/scheduler/tasks`);
  const payload = (await parseJSONOrNull(response)) as ScheduledTask[] | null;
  if (!response.ok) {
    throw new Error(
      extractErrorDetail(payload) ??
        `Failed to list scheduled tasks (${response.status})`,
    );
  }
  return payload ?? [];
}

export async function getScheduledTask(taskId: string): Promise<ScheduledTask> {
  const response = await fetch(
    `${getBackendBaseURL()}/api/scheduler/tasks/${encodeURIComponent(taskId)}`,
  );
  const payload = (await parseJSONOrNull(response)) as ScheduledTask | null;
  if (!response.ok) {
    throw new Error(
      extractErrorDetail(payload) ??
        `Failed to get scheduled task (${response.status})`,
    );
  }
  if (!payload) {
    throw new Error("Scheduled task not found");
  }
  return payload;
}

export async function createScheduledTask(
  request: CreateScheduledTaskRequest,
): Promise<ScheduledTask> {
  const response = await fetch(`${getBackendBaseURL()}/api/scheduler/tasks`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });
  const payload = (await parseJSONOrNull(response)) as ScheduledTask | null;
  if (!response.ok) {
    throw new Error(
      extractErrorDetail(payload) ??
        `Failed to create scheduled task (${response.status})`,
    );
  }
  if (!payload) {
    throw new Error("Invalid response when creating task");
  }
  return payload;
}

export async function updateScheduledTask(
  taskId: string,
  request: UpdateScheduledTaskRequest,
): Promise<ScheduledTask> {
  const response = await fetch(
    `${getBackendBaseURL()}/api/scheduler/tasks/${encodeURIComponent(taskId)}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    },
  );
  const payload = (await parseJSONOrNull(response)) as ScheduledTask | null;
  if (!response.ok) {
    throw new Error(
      extractErrorDetail(payload) ??
        `Failed to update scheduled task (${response.status})`,
    );
  }
  if (!payload) {
    throw new Error("Invalid response when updating task");
  }
  return payload;
}

export async function deleteScheduledTask(taskId: string): Promise<void> {
  const response = await fetch(
    `${getBackendBaseURL()}/api/scheduler/tasks/${encodeURIComponent(taskId)}`,
    {
      method: "DELETE",
    },
  );
  if (!response.ok) {
    const payload = await parseJSONOrNull(response);
    throw new Error(
      extractErrorDetail(payload) ??
        `Failed to delete scheduled task (${response.status})`,
    );
  }
}

export async function runScheduledTaskNow(
  taskId: string,
): Promise<{ task_id: string; run_id: string; status: string }> {
  const response = await fetch(
    `${getBackendBaseURL()}/api/scheduler/tasks/${encodeURIComponent(taskId)}/run`,
    {
      method: "POST",
    },
  );
  const payload = (await parseJSONOrNull(response)) as {
    task_id: string;
    run_id: string;
    status: string;
  } | null;
  if (!response.ok) {
    throw new Error(
      extractErrorDetail(payload) ??
        `Failed to run scheduled task (${response.status})`,
    );
  }
  if (!payload) {
    throw new Error("Invalid response when running task");
  }
  return payload;
}

export async function listScheduledTaskHistory(
  taskId: string,
): Promise<TaskExecutionRecord[]> {
  const response = await fetch(
    `${getBackendBaseURL()}/api/scheduler/tasks/${encodeURIComponent(taskId)}/history`,
  );
  const payload = (await parseJSONOrNull(response)) as TaskExecutionRecord[] | null;
  if (!response.ok) {
    throw new Error(
      extractErrorDetail(payload) ??
        `Failed to load scheduled task history (${response.status})`,
    );
  }
  return payload ?? [];
}
