import type { AgentThreadState } from "./types";

export const THREAD_INIT_GRACE_MS = 15_000;
export const THREAD_EMPTY_STATE_POLL_INTERVAL_MS = 250;
export const THREAD_EMPTY_STATE_MAX_POLLS = 6;

type ThreadMetaLike = {
  status?: string | null;
  created_at?: string | null;
};

function parseCreatedAtMs(createdAt: string | null | undefined): number | null {
  if (typeof createdAt !== "string" || createdAt.trim().length === 0) {
    return null;
  }
  const parsed = Date.parse(createdAt);
  return Number.isFinite(parsed) ? parsed : null;
}

export function hasThreadRenderableState(values: unknown): boolean {
  if (!values || typeof values !== "object") {
    return false;
  }

  const state = values as Partial<AgentThreadState>;
  const hasTitle = typeof state.title === "string" && state.title.trim().length > 0;
  const hasMessages = Array.isArray(state.messages) && state.messages.length > 0;
  return hasTitle || hasMessages;
}

export function isThreadLikelyInitializing(
  meta: ThreadMetaLike | null | undefined,
  options?: {
    nowMs?: number;
    graceMs?: number;
  },
): boolean {
  if (!meta) {
    return false;
  }

  if (meta.status === "busy") {
    return true;
  }

  const createdAtMs = parseCreatedAtMs(meta.created_at);
  if (createdAtMs === null) {
    return false;
  }

  const nowMs = options?.nowMs ?? Date.now();
  const graceMs = options?.graceMs ?? THREAD_INIT_GRACE_MS;
  return nowMs - createdAtMs <= graceMs;
}
