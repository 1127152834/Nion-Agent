import { useChannelRealtimeContext } from "./channel-realtime-provider";
import type { ChannelThreadRealtimeState } from "./channel-realtime-types";

function normalizeThreadId(threadId: string): string {
  const normalized = threadId.trim();
  if (!normalized) {
    return "";
  }
  const compact = normalized.replace(/-/g, "");
  if (!/^[0-9a-fA-F]{32}$/.test(compact)) {
    return normalized;
  }
  const lower = compact.toLowerCase();
  return [
    lower.slice(0, 8),
    lower.slice(8, 12),
    lower.slice(12, 16),
    lower.slice(16, 20),
    lower.slice(20),
  ].join("-");
}

export function useChannelThreadRealtime(
  threadId: string | null | undefined,
): ChannelThreadRealtimeState | null {
  const { threadStates } = useChannelRealtimeContext();
  if (!threadId) {
    return null;
  }
  const direct = threadStates[threadId];
  if (direct) {
    return direct;
  }
  const normalized = normalizeThreadId(threadId);
  if (!normalized) {
    return null;
  }
  return threadStates[normalized] ?? null;
}

export function useChannelRealtimeThreadStates(): Record<string, ChannelThreadRealtimeState> {
  return useChannelRealtimeContext().threadStates;
}
