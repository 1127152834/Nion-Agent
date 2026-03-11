import { getBackendBaseURL } from "@/core/config";

import type {
  AgentDirectoryCard,
  GovernanceStatus,
  MemoryItem,
  UserMemory,
} from "./types";

export type MemoryViewScope = "global" | "agent";

function toErrorMessage(payload: unknown, fallback: string): string {
  if (
    payload &&
    typeof payload === "object" &&
    "detail" in payload &&
    typeof (payload as { detail?: unknown }).detail === "string"
  ) {
    return (payload as { detail: string }).detail;
  }
  return fallback;
}

function buildScopeSearch(
  scope: MemoryViewScope,
  agentName?: string | null,
): string {
  const search = new URLSearchParams();
  search.set("scope", scope);
  if (scope === "agent" && agentName) {
    search.set("agent_name", agentName);
  }
  return search.toString();
}

export async function loadMemoryView(params?: {
  scope?: MemoryViewScope;
  agentName?: string | null;
}): Promise<UserMemory> {
  const scope = params?.scope ?? "global";
  const search = buildScopeSearch(scope, params?.agentName);
  const endpoint =
    scope === "global"
      ? `${getBackendBaseURL()}/api/memory`
      : `${getBackendBaseURL()}/api/memory/view?${search}`;
  const res = await fetch(endpoint);
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { detail?: string };
    throw new Error(
      toErrorMessage(err, `Failed to load memory view: ${res.statusText}`),
    );
  }
  return (await res.json()) as UserMemory;
}

export async function loadMemoryItems(params?: {
  scope?: MemoryViewScope;
  agentName?: string | null;
}): Promise<MemoryItem[]> {
  const scope = params?.scope ?? "global";
  const search = buildScopeSearch(scope, params?.agentName);
  const res = await fetch(`${getBackendBaseURL()}/api/memory/items?${search}`);
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { detail?: string };
    throw new Error(
      toErrorMessage(err, `Failed to load memory items: ${res.statusText}`),
    );
  }
  const json = (await res.json()) as { items?: MemoryItem[] };
  return Array.isArray(json.items) ? json.items : [];
}

export async function loadMemoryCatalog(): Promise<AgentDirectoryCard[]> {
  const res = await fetch(`${getBackendBaseURL()}/api/memory/catalog`);
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { detail?: string };
    throw new Error(
      toErrorMessage(err, `Failed to load memory catalog: ${res.statusText}`),
    );
  }
  const json = (await res.json()) as { items?: AgentDirectoryCard[] };
  return Array.isArray(json.items) ? json.items : [];
}

export async function loadGovernanceStatus(): Promise<GovernanceStatus> {
  const res = await fetch(`${getBackendBaseURL()}/api/memory/governance/status`);
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { detail?: string };
    throw new Error(
      toErrorMessage(
        err,
        `Failed to load memory governance status: ${res.statusText}`,
      ),
    );
  }
  return (await res.json()) as GovernanceStatus;
}
