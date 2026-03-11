import { getBackendBaseURL } from "@/core/config";

export interface HeartbeatLogRecord {
  id: string;
  heartbeat_type: string;
  timestamp: string;
  status: string;
  result_type: string;
  result: Record<string, unknown>;
  duration_seconds: number;
  error_message: string | null;
  user_visible: boolean;
}

export interface HeartbeatLogsParams {
  agentName: string;
  templateId?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

export async function getHeartbeatLogs(
  params: HeartbeatLogsParams
): Promise<HeartbeatLogRecord[]> {
  const { agentName, templateId, status, limit = 50, offset = 0 } = params;
  const searchParams = new URLSearchParams();
  searchParams.set("agent_name", agentName);
  if (templateId) searchParams.set("template_id", templateId);
  if (status) searchParams.set("status", status);
  searchParams.set("limit", String(limit));
  searchParams.set("offset", String(offset));

  const res = await fetch(
    `${getBackendBaseURL()}/api/heartbeat/logs?${searchParams}`
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { detail?: string };
    throw new Error(err.detail ?? `Failed to load heartbeat logs: ${res.statusText}`);
  }
  return res.json();
}

export async function getHeartbeatLog(
  agentName: string,
  logId: string
): Promise<HeartbeatLogRecord> {
  const res = await fetch(
    `${getBackendBaseURL()}/api/heartbeat/logs/${logId}?agent_name=${encodeURIComponent(agentName)}`
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { detail?: string };
    throw new Error(err.detail ?? `Failed to load heartbeat log: ${res.statusText}`);
  }
  return res.json();
}
