import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { useI18n } from "@/core/i18n/hooks";

import {
  executeHeartbeat,
  getHeartbeatLog,
  getHeartbeatLogs,
  getHeartbeatStatus,
  getHeartbeatTemplates,
  type HeartbeatLogsParams,
} from "./heartbeat-api";
import { agentKeys } from "./query-keys";

export function useHeartbeatLogs(params: HeartbeatLogsParams) {
  return useQuery({
    queryKey: agentKeys.heartbeat.logsList(params.agentName, params.templateId, params.status, params.offset),
    queryFn: () => getHeartbeatLogs(params),
    staleTime: 30 * 1000,
  });
}

export function useHeartbeatLog(agentName: string, logId: string) {
  return useQuery({
    queryKey: agentKeys.heartbeat.log(agentName, logId),
    queryFn: () => getHeartbeatLog(agentName, logId),
    staleTime: 30 * 1000,
    enabled: !!logId,
  });
}

export function useHeartbeatStatus(agentName: string) {
  return useQuery({
    queryKey: agentKeys.heartbeat.status(agentName),
    queryFn: () => getHeartbeatStatus(agentName),
    staleTime: 30 * 1000,
  });
}

export function useHeartbeatTemplates() {
  return useQuery({
    queryKey: agentKeys.heartbeat.templates(),
    queryFn: () => getHeartbeatTemplates(),
    staleTime: 5 * 60 * 1000,
  });
}

export function useExecuteHeartbeat(agentName: string) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (templateId: string) => executeHeartbeat(agentName, templateId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: agentKeys.heartbeat.all(agentName) });
      toast.success(t.agents.settings.toasts.heartbeatRunTriggered);
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });
}
