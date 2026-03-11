import { useQuery } from "@tanstack/react-query";

import {
  getHeartbeatLog,
  getHeartbeatLogs,
  type HeartbeatLogsParams,
} from "./heartbeat-api";

export function useHeartbeatLogs(params: HeartbeatLogsParams) {
  return useQuery({
    queryKey: ["heartbeat", "logs", params.agentName, params.templateId, params.status, params.offset],
    queryFn: () => getHeartbeatLogs(params),
    staleTime: 30 * 1000,
  });
}

export function useHeartbeatLog(agentName: string, logId: string) {
  return useQuery({
    queryKey: ["heartbeat", "log", agentName, logId],
    queryFn: () => getHeartbeatLog(agentName, logId),
    staleTime: 30 * 1000,
    enabled: !!logId,
  });
}
