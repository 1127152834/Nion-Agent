import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  createScheduledTask,
  deleteScheduledTask,
  getScheduledTask,
  listScheduledTaskHistory,
  listScheduledTasks,
  runScheduledTaskNow,
  updateScheduledTask,
} from "./api";
import type {
  CreateScheduledTaskRequest,
  UpdateScheduledTaskRequest,
} from "./types";

const SCHEDULER_TASKS_QUERY_KEY = ["scheduler", "tasks"] as const;
const SCHEDULER_HISTORY_QUERY_KEY = ["scheduler", "history"] as const;

export function useScheduledTasks() {
  const { data, isLoading, error, refetch, isRefetching } = useQuery({
    queryKey: SCHEDULER_TASKS_QUERY_KEY,
    queryFn: () => listScheduledTasks(),
  });

  return {
    tasks: data ?? [],
    isLoading,
    error,
    refetch,
    isRefetching,
  };
}

export function useScheduledTask(taskId: string | null | undefined) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: [...SCHEDULER_TASKS_QUERY_KEY, taskId],
    queryFn: () => getScheduledTask(taskId!),
    enabled: !!taskId,
  });

  return {
    task: data ?? null,
    isLoading,
    error,
    refetch,
  };
}

export function useCreateScheduledTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: CreateScheduledTaskRequest) => createScheduledTask(request),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: SCHEDULER_TASKS_QUERY_KEY });
    },
  });
}

export function useUpdateScheduledTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      taskId,
      request,
    }: {
      taskId: string;
      request: UpdateScheduledTaskRequest;
    }) => updateScheduledTask(taskId, request),
    onSuccess: (_task, { taskId }) => {
      void queryClient.invalidateQueries({ queryKey: SCHEDULER_TASKS_QUERY_KEY });
      void queryClient.invalidateQueries({
        queryKey: [...SCHEDULER_TASKS_QUERY_KEY, taskId],
      });
    },
  });
}

export function useDeleteScheduledTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) => deleteScheduledTask(taskId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: SCHEDULER_TASKS_QUERY_KEY });
    },
  });
}

export function useRunScheduledTaskNow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) => runScheduledTaskNow(taskId),
    onSuccess: ({ task_id }) => {
      void queryClient.invalidateQueries({ queryKey: SCHEDULER_TASKS_QUERY_KEY });
      void queryClient.invalidateQueries({
        queryKey: [...SCHEDULER_HISTORY_QUERY_KEY, task_id],
      });
    },
  });
}

export function useScheduledTaskHistory(taskId: string | null | undefined) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: [...SCHEDULER_HISTORY_QUERY_KEY, taskId],
    queryFn: () => listScheduledTaskHistory(taskId!),
    enabled: !!taskId,
  });

  return {
    history: data ?? [],
    isLoading,
    error,
    refetch,
  };
}
