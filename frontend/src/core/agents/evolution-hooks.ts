import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { useI18n } from "@/core/i18n/hooks";

import {
  acceptSuggestion,
  dismissSuggestion,
  getEvolutionReports,
  getEvolutionSuggestions,
} from "./evolution-api";

export function useEvolutionReports(agentName: string) {
  return useQuery({
    queryKey: ["evolution", "reports", agentName],
    queryFn: () => getEvolutionReports(agentName),
    staleTime: 30 * 1000,
  });
}

export function useEvolutionSuggestions(agentName: string, status?: string) {
  return useQuery({
    queryKey: ["evolution", "suggestions", agentName, status],
    queryFn: () => getEvolutionSuggestions(agentName, status),
    staleTime: 30 * 1000,
  });
}

export function useDismissSuggestion(agentName: string) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (suggestionId: string) => dismissSuggestion(agentName, suggestionId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["evolution", "suggestions", agentName] });
      toast.success(t.agents.settings.toasts.suggestionDismissed);
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });
}

export function useAcceptSuggestion(agentName: string) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (suggestionId: string) => acceptSuggestion(agentName, suggestionId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["evolution", "suggestions", agentName] });
      toast.success(t.agents.settings.toasts.suggestionAccepted);
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });
}
