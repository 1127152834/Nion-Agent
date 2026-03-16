import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { useI18n } from "@/core/i18n/hooks";

import {
  getAgentIdentity,
  getAgentSoul,
  updateAgentIdentity,
  updateAgentSoul,
} from "./editor-api";
import { agentKeys } from "./query-keys";

export function useAgentSoul(agentName: string) {
  return useQuery({
    queryKey: agentKeys.soul(agentName),
    queryFn: () => getAgentSoul(agentName),
    staleTime: 30 * 1000,
  });
}

export function useUpdateAgentSoul(agentName: string) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (content: string) => updateAgentSoul(agentName, content),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: agentKeys.soul(agentName) });
      toast.success(t.agents.settings.toasts.soulSaved);
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });
}

export function useAgentIdentity(agentName: string) {
  return useQuery({
    queryKey: agentKeys.identity(agentName),
    queryFn: () => getAgentIdentity(agentName),
    staleTime: 30 * 1000,
  });
}

export function useUpdateAgentIdentity(agentName: string) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (content: string) => updateAgentIdentity(agentName, content),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: agentKeys.identity(agentName) });
      toast.success(t.agents.settings.toasts.identitySaved);
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });
}
