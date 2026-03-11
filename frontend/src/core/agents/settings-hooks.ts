import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { useI18n } from "@/core/i18n/hooks";

import {
  getHeartbeatSettings,
  updateHeartbeatSettings,
  getEvolutionSettings,
  updateEvolutionSettings,
} from "./settings-api";
import type { HeartbeatSettings, EvolutionSettings } from "./settings-types";

// Heartbeat Hooks
export function useHeartbeatSettings(agentName: string) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["heartbeat", "settings", agentName],
    queryFn: () => getHeartbeatSettings(agentName),
  });
  return { settings: data ?? null, isLoading, error };
}

export function useUpdateHeartbeatSettings(agentName: string) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (settings: HeartbeatSettings) =>
      updateHeartbeatSettings(agentName, settings),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["heartbeat", "settings", agentName],
      });
      toast.success(t.agents.settings.toasts.heartbeatSaved);
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });
}

// Evolution Hooks
export function useEvolutionSettings(agentName: string) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["evolution", "settings", agentName],
    queryFn: () => getEvolutionSettings(agentName),
  });
  return { settings: data ?? null, isLoading, error };
}

export function useUpdateEvolutionSettings(agentName: string) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (settings: EvolutionSettings) =>
      updateEvolutionSettings(agentName, settings),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["evolution", "settings", agentName],
      });
      toast.success(t.agents.settings.toasts.evolutionSaved);
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });
}
