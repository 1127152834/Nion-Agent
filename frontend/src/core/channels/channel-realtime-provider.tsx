"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { getBackendBaseURL } from "@/core/config";
import { useI18n } from "@/core/i18n/hooks";
import { env } from "@/env";

import type {
  ChannelAgentLifecycleEventType,
  ChannelEventEnvelope,
  ChannelTerminalEventType,
  ChannelThreadRealtimeState,
} from "./channel-realtime-types";
import type { ChannelPlatform } from "./types";

const CHANNEL_REALTIME_PLATFORM: ChannelPlatform = "dingtalk";
const DEFAULT_WORKSPACE_ID = "default";
const THREAD_STATE_CLEANUP_INTERVAL_MS = 30_000;
const THREAD_STATE_TTL_MS = 120_000;
const RECONNECT_BASE_DELAY_MS = 1_000;
const RECONNECT_MAX_DELAY_MS = 30_000;

type ChannelRealtimeContextValue = {
  connected: boolean;
  error: string | null;
  threadStates: Record<string, ChannelThreadRealtimeState>;
};

const ChannelRealtimeContext = createContext<ChannelRealtimeContextValue>({
  connected: false,
  error: null,
  threadStates: {},
});

function normalizeWorkspaceId(workspaceId: string | null | undefined): string {
  const normalized = typeof workspaceId === "string" ? workspaceId.trim() : "";
  return normalized || DEFAULT_WORKSPACE_ID;
}

function isLifecycleEventType(type: string): type is ChannelAgentLifecycleEventType {
  return (
    type === "agent_started"
    || type === "agent_partial"
    || type === "agent_state"
    || type === "agent_finished"
    || type === "agent_failed"
  );
}

function isTerminalEventType(type: string): type is ChannelTerminalEventType {
  return type === "agent_finished" || type === "agent_failed";
}

function parseSequence(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, value);
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      return Math.max(0, parsed);
    }
  }
  return 0;
}

function parseEventAt(payload: Record<string, unknown>, timestamp?: string): string | null {
  const payloadAt = typeof payload.at === "string" ? payload.at.trim() : "";
  if (payloadAt) {
    return payloadAt;
  }
  const normalizedTimestamp = typeof timestamp === "string" ? timestamp.trim() : "";
  return normalizedTimestamp || null;
}

function parseThreadId(payload: Record<string, unknown>): string | null {
  const rawThreadId = typeof payload.thread_id === "string" ? payload.thread_id.trim() : "";
  if (!rawThreadId) {
    return null;
  }
  const compact = rawThreadId.replace(/-/g, "");
  if (/^[0-9a-fA-F]{32}$/.test(compact)) {
    const lower = compact.toLowerCase();
    return [
      lower.slice(0, 8),
      lower.slice(8, 12),
      lower.slice(12, 16),
      lower.slice(16, 20),
      lower.slice(20),
    ].join("-");
  }
  return rawThreadId;
}

function parseStateValues(payload: Record<string, unknown>): Record<string, unknown> | null {
  const values = payload.values;
  if (!values || typeof values !== "object" || Array.isArray(values)) {
    return null;
  }
  return values as Record<string, unknown>;
}

function extractTextFromContent(content: unknown): string {
  if (typeof content === "string") {
    return content.trim();
  }
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (!item || typeof item !== "object") {
          return "";
        }
        const text = (item as { text?: unknown }).text;
        return typeof text === "string" ? text : "";
      })
      .join("\n")
      .trim();
  }
  return "";
}

function extractLatestAssistantTextFromValues(values: Record<string, unknown>): string {
  const messages = values.messages;
  if (!Array.isArray(messages)) {
    return "";
  }
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || typeof message !== "object") {
      continue;
    }
    const messageType = (message as { type?: unknown }).type;
    const normalizedType = typeof messageType === "string"
      ? messageType.trim().toLowerCase()
      : "";
    if (normalizedType !== "ai" && normalizedType !== "assistant") {
      continue;
    }
    const content = (message as { content?: unknown }).content;
    const extracted = extractTextFromContent(content);
    if (extracted) {
      return extracted;
    }
  }
  return "";
}

function normalizeMessageType(message: unknown): string {
  if (!message || typeof message !== "object") {
    return "";
  }
  const rawType = (message as { type?: unknown; role?: unknown }).type
    ?? (message as { role?: unknown }).role;
  return typeof rawType === "string" ? rawType.trim().toLowerCase() : "";
}

function hasVisibleAssistantTextAfterLastHuman(messages: unknown[]): boolean {
  let lastHumanIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const messageType = normalizeMessageType(messages[index]);
    if (messageType === "human" || messageType === "user") {
      lastHumanIndex = index;
      break;
    }
  }
  if (lastHumanIndex < 0) {
    return false;
  }
  const tail = messages.slice(lastHumanIndex + 1);
  for (const message of tail) {
    const messageType = normalizeMessageType(message);
    if (messageType !== "ai" && messageType !== "assistant") {
      continue;
    }
    const content = (message as { content?: unknown }).content;
    if (extractTextFromContent(content)) {
      return true;
    }
  }
  return false;
}

function ensureFinalReplyInValues(
  values: Record<string, unknown> | null,
  finalReplyText: string,
): Record<string, unknown> | null {
  if (!values) {
    return null;
  }
  const trimmedReply = finalReplyText.trim();
  if (!trimmedReply) {
    return values;
  }
  const rawMessages = values.messages;
  if (!Array.isArray(rawMessages)) {
    return values;
  }
  if (hasVisibleAssistantTextAfterLastHuman(rawMessages)) {
    return values;
  }
  return {
    ...values,
    messages: [
      ...rawMessages,
      {
        id: `channel-final-${Date.now()}`,
        type: "ai",
        content: trimmedReply,
      },
    ],
  };
}

function buildFallbackStateValues(
  pendingUserText: string | null,
  finalReplyText: string,
): Record<string, unknown> | null {
  const normalizedReply = finalReplyText.trim();
  if (!normalizedReply) {
    return null;
  }
  const messages: Array<Record<string, unknown>> = [];
  const normalizedPending = (pendingUserText ?? "").trim();
  if (normalizedPending) {
    messages.push({
      id: `channel-human-${Date.now()}`,
      type: "human",
      content: normalizedPending,
    });
  }
  messages.push({
    id: `channel-final-${Date.now()}`,
    type: "ai",
    content: normalizedReply,
  });
  return {
    title: "Untitled",
    messages,
    artifacts: [],
  };
}

function matchesWorkspace(
  payload: Record<string, unknown>,
  currentWorkspaceId: string | null | undefined,
): boolean {
  const workspaceId = typeof payload.workspace_id === "string"
    ? payload.workspace_id.trim()
    : "";
  if (!workspaceId) {
    return false;
  }
  return workspaceId === normalizeWorkspaceId(currentWorkspaceId);
}

function cleanupExpiredStates(
  states: Record<string, ChannelThreadRealtimeState>,
): Record<string, ChannelThreadRealtimeState> {
  const now = Date.now();
  let changed = false;
  const next: Record<string, ChannelThreadRealtimeState> = {};
  for (const [threadId, state] of Object.entries(states)) {
    if (state.running) {
      next[threadId] = state;
      continue;
    }
    const referenceAt = state.terminalAt ?? state.lastEventAt;
    const timeValue = referenceAt ? Date.parse(referenceAt) : Number.NaN;
    if (!Number.isFinite(timeValue) || now - timeValue <= THREAD_STATE_TTL_MS) {
      next[threadId] = state;
      continue;
    }
    changed = true;
  }
  return changed ? next : states;
}

export function ChannelRealtimeProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const { t } = useI18n();
  const m = t.migration.core?.channelRealtimeProvider;
  const copy = {
    backendUrlEmpty:
      m?.backendUrlEmptyZh
      ?? "Channel realtime sync unavailable: backend URL is empty",
    disconnectedReconnecting:
      m?.disconnectedReconnectingZh
      ?? "Channel realtime sync disconnected. Reconnecting...",
  } as const;
  const workspaceId = "default";
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [threadStates, setThreadStates] = useState<Record<string, ChannelThreadRealtimeState>>({});
  const reconnectAttemptRef = useRef(0);

  const enabled = env.NEXT_PUBLIC_STATIC_WEBSITE_ONLY !== "true"
    && env.NEXT_PUBLIC_CHANNEL_DESKTOP_SYNC_ENABLED !== "false";

  useEffect(() => {
    setThreadStates({});
  }, [workspaceId]);

  useEffect(() => {
    if (!enabled) {
      setConnected(false);
      setError(null);
      return;
    }
    let disposed = false;
    let source: EventSource | null = null;
    let reconnectTimer: number | null = null;

    const scheduleReconnect = () => {
      if (disposed) {
        return;
      }
      const attempt = reconnectAttemptRef.current;
      const delay = Math.min(
        RECONNECT_MAX_DELAY_MS,
        RECONNECT_BASE_DELAY_MS * (2 ** Math.max(0, attempt)),
      );
      reconnectAttemptRef.current += 1;
      reconnectTimer = window.setTimeout(() => {
        connect();
      }, delay);
    };

    const connect = () => {
      if (disposed) {
        return;
      }
      const baseUrl = getBackendBaseURL();
      if (!baseUrl) {
        setConnected(false);
        setError(copy.backendUrlEmpty);
        scheduleReconnect();
        return;
      }
      source = new EventSource(`${baseUrl}/api/channels/${CHANNEL_REALTIME_PLATFORM}/events`);

      source.addEventListener("ready", () => {
        if (disposed) {
          return;
        }
        reconnectAttemptRef.current = 0;
        setConnected(true);
        setError(null);
      });

      source.addEventListener("channel_event", (rawEvent) => {
        if (disposed) {
          return;
        }
        let envelope: ChannelEventEnvelope | null = null;
        try {
          const messageEvent = rawEvent as MessageEvent<string>;
          envelope = JSON.parse(messageEvent.data) as ChannelEventEnvelope;
        } catch {
          return;
        }
        if (!envelope) {
          return;
        }
        if (envelope.platform !== CHANNEL_REALTIME_PLATFORM) {
          return;
        }
        const eventType = (envelope.type || "").trim();
        if (!isLifecycleEventType(eventType)) {
          return;
        }
        const payload = envelope.payload ?? {};
        if (!matchesWorkspace(payload, workspaceId)) {
          return;
        }
        const threadId = parseThreadId(payload);
        if (!threadId) {
          return;
        }
        const eventAt = parseEventAt(payload, envelope.timestamp);
        setThreadStates((previous) => {
          const prevState = previous[threadId];
          const seq = parseSequence(payload.seq);
          const platform = CHANNEL_REALTIME_PLATFORM;
          if (eventType === "agent_started") {
            const pendingUserText = typeof payload.request_text === "string"
              ? payload.request_text
              : null;
            return {
              ...previous,
              [threadId]: {
                threadId,
                platform,
                running: true,
                pendingUserText,
                partialText: "",
                finalReplyText: null,
                stateValues: null,
                seq: 0,
                lastEventAt: eventAt,
                terminalEvent: null,
                terminalAt: null,
              },
            };
          }
          if (eventType === "agent_state") {
            const nextValues = parseStateValues(payload);
            if (!nextValues && !prevState) {
              return previous;
            }
            const extractedPartialText = nextValues
              ? extractLatestAssistantTextFromValues(nextValues)
              : "";
            return {
              ...previous,
              [threadId]: {
                threadId,
                platform,
                running: prevState?.running ?? true,
                pendingUserText: prevState?.pendingUserText ?? null,
                partialText: extractedPartialText.length > 0
                  ? extractedPartialText
                  : (prevState?.partialText ?? ""),
                finalReplyText: prevState?.finalReplyText ?? null,
                stateValues: nextValues ?? prevState?.stateValues ?? null,
                seq: seq > 0 ? seq : (prevState?.seq ?? 0),
                lastEventAt: eventAt,
                terminalEvent: null,
                terminalAt: null,
              },
            };
          }
          if (eventType === "agent_partial") {
            const nextPartialText = typeof payload.partial_text === "string"
              ? payload.partial_text
              : "";
            if (
              prevState
              && seq > 0
              && prevState.seq > 0
              && seq <= prevState.seq
              && prevState.partialText === nextPartialText
            ) {
              return previous;
            }
            return {
              ...previous,
              [threadId]: {
                threadId,
                platform,
                running: true,
                pendingUserText: prevState?.pendingUserText ?? null,
                partialText: nextPartialText.length > 0
                  ? nextPartialText
                  : (prevState?.partialText ?? ""),
                finalReplyText: prevState?.finalReplyText ?? null,
                stateValues: prevState?.stateValues ?? null,
                seq: seq > 0 ? seq : (prevState?.seq ?? 0),
                lastEventAt: eventAt,
                terminalEvent: null,
                terminalAt: null,
              },
            };
          }
          if (isTerminalEventType(eventType)) {
            const terminalReplyText = typeof payload.reply_text === "string"
              ? payload.reply_text.trim()
              : "";
            const nextStateValues = ensureFinalReplyInValues(
              prevState?.stateValues ?? null,
              terminalReplyText,
            );
            const fallbackStateValues = buildFallbackStateValues(
              prevState?.pendingUserText ?? null,
              terminalReplyText,
            );
            return {
              ...previous,
              [threadId]: {
                threadId,
                platform,
                running: false,
                pendingUserText: prevState?.pendingUserText ?? null,
                partialText: "",
                finalReplyText: terminalReplyText || (prevState?.finalReplyText ?? null),
                stateValues: nextStateValues ?? fallbackStateValues ?? prevState?.stateValues ?? null,
                seq: prevState?.seq ?? 0,
                lastEventAt: eventAt,
                terminalEvent: eventType,
                terminalAt: eventAt,
              },
            };
          }
          return previous;
        });
        if (eventType === "agent_started" || isTerminalEventType(eventType)) {
          void queryClient.invalidateQueries({ queryKey: ["threads", "search"] });
        }
      });

      source.onerror = () => {
        if (disposed) {
          return;
        }
        setConnected(false);
        setError(copy.disconnectedReconnecting);
        source?.close();
        source = null;
        scheduleReconnect();
      };
    };

    connect();

    return () => {
      disposed = true;
      setConnected(false);
      if (reconnectTimer != null) {
        window.clearTimeout(reconnectTimer);
      }
      source?.close();
    };
  }, [copy.backendUrlEmpty, copy.disconnectedReconnecting, enabled, queryClient, workspaceId]);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const timer = window.setInterval(() => {
      setThreadStates((previous) => cleanupExpiredStates(previous));
    }, THREAD_STATE_CLEANUP_INTERVAL_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, [enabled]);

  const value = useMemo<ChannelRealtimeContextValue>(
    () => ({
      connected,
      error,
      threadStates,
    }),
    [connected, error, threadStates],
  );

  return (
    <ChannelRealtimeContext.Provider value={value}>
      {children}
    </ChannelRealtimeContext.Provider>
  );
}

export function useChannelRealtimeContext(): ChannelRealtimeContextValue {
  return useContext(ChannelRealtimeContext);
}
