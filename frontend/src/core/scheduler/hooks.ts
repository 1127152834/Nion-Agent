import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  clearScheduledTaskHistory,
  createScheduledTask,
  deleteScheduledTask,
  getScheduledTask,
  getSchedulerDashboard,
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
const SCHEDULER_DASHBOARD_QUERY_KEY = ["scheduler", "dashboard"] as const;

export function useSchedulerDashboard() {
  const { data, isLoading, error, refetch, isRefetching } = useQuery({
    queryKey: SCHEDULER_DASHBOARD_QUERY_KEY,
    queryFn: () => getSchedulerDashboard(),
  });

  return {
    dashboard: data ?? null,
    isLoading,
    error,
    refetch,
    isRefetching,
  };
}

export function useScheduledTasks(agentName?: string | null) {
  const { data, isLoading, error, refetch, isRefetching } = useQuery({
    queryKey: [...SCHEDULER_TASKS_QUERY_KEY, agentName ?? "all"],
    queryFn: () => listScheduledTasks(agentName ?? undefined),
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
    queryKey: [...SCHEDULER_TASKS_QUERY_KEY, "detail", taskId],
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

export function useCreateScheduledTask(agentName?: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: CreateScheduledTaskRequest) => createScheduledTask(request),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: SCHEDULER_DASHBOARD_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: SCHEDULER_TASKS_QUERY_KEY });
      if (agentName) {
        void queryClient.invalidateQueries({
          queryKey: [...SCHEDULER_TASKS_QUERY_KEY, agentName],
        });
      }
    },
  });
}

export function useUpdateScheduledTask(agentName?: string | null) {
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
      void queryClient.invalidateQueries({ queryKey: SCHEDULER_DASHBOARD_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: SCHEDULER_TASKS_QUERY_KEY });
      if (agentName) {
        void queryClient.invalidateQueries({
          queryKey: [...SCHEDULER_TASKS_QUERY_KEY, agentName],
        });
      }
      void queryClient.invalidateQueries({
        queryKey: [...SCHEDULER_TASKS_QUERY_KEY, "detail", taskId],
      });
    },
  });
}

export function useDeleteScheduledTask(agentName?: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) => deleteScheduledTask(taskId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: SCHEDULER_DASHBOARD_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: SCHEDULER_TASKS_QUERY_KEY });
      if (agentName) {
        void queryClient.invalidateQueries({
          queryKey: [...SCHEDULER_TASKS_QUERY_KEY, agentName],
        });
      }
    },
  });
}

export function useRunScheduledTaskNow(agentName?: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) => runScheduledTaskNow(taskId),
    onSuccess: ({ task_id }) => {
      void queryClient.invalidateQueries({ queryKey: SCHEDULER_DASHBOARD_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: SCHEDULER_TASKS_QUERY_KEY });
      if (agentName) {
        void queryClient.invalidateQueries({
          queryKey: [...SCHEDULER_TASKS_QUERY_KEY, agentName],
        });
      }
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

export function useClearScheduledTaskHistory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) => clearScheduledTaskHistory(taskId),
    onSuccess: (_data, taskId) => {
      queryClient.setQueryData([...SCHEDULER_HISTORY_QUERY_KEY, taskId], []);
      void queryClient.invalidateQueries({ queryKey: SCHEDULER_DASHBOARD_QUERY_KEY });
    },
  });
}
