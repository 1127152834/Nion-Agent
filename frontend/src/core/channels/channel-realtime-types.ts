import type { ChannelPlatform } from "./types";

export type ChannelAgentLifecycleEventType =
  | "agent_started"
  | "agent_partial"
  | "agent_state"
  | "agent_finished"
  | "agent_failed";

export type ChannelTerminalEventType = "agent_finished" | "agent_failed";

export interface ChannelEventEnvelope {
  platform: string;
  type: string;
  payload?: Record<string, unknown>;
  timestamp?: string;
}

export interface ChannelThreadRealtimeState {
  threadId: string;
  platform: ChannelPlatform;
  running: boolean;
  pendingUserText: string | null;
  partialText: string;
  finalReplyText: string | null;
  stateValues: Record<string, unknown> | null;
  seq: number;
  lastEventAt: string | null;
  terminalEvent: ChannelTerminalEventType | null;
  terminalAt: string | null;
}
