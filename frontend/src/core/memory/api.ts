import { getBackendBaseURL } from "@/core/config";

import type {
  AgentDirectoryCard,
  MemoryQueryExplain,
  OpenVikingGovernanceStatus,
  OpenVikingMemoryItem,
  OpenVikingStatus,
  ProcesslogExport,
} from "./types";

export type MemoryViewScope = "global" | "agent" | "auto";

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
  if ((scope === "agent" || scope === "auto") && agentName) {
    search.set("agent_name", agentName);
  }
  return search.toString();
}

export async function loadMemoryItems(params?: {
  scope?: MemoryViewScope;
  agentName?: string | null;
}): Promise<OpenVikingMemoryItem[]> {
  const scope = params?.scope ?? "auto";
  const search = buildScopeSearch(scope, params?.agentName);
  const res = await fetch(`${getBackendBaseURL()}/api/openviking/items?${search}`);
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { detail?: string };
    throw new Error(
      toErrorMessage(err, `Failed to load OpenViking items: ${res.statusText}`),
    );
  }
  const json = (await res.json()) as { items?: OpenVikingMemoryItem[] };
  return Array.isArray(json.items) ? json.items : [];
}

export async function loadGovernanceStatus(): Promise<OpenVikingGovernanceStatus> {
  const res = await fetch(`${getBackendBaseURL()}/api/openviking/governance/status`);
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { detail?: string };
    throw new Error(
      toErrorMessage(
        err,
        `Failed to load OpenViking governance status: ${res.statusText}`,
      ),
    );
  }
  return (await res.json()) as OpenVikingGovernanceStatus;
}

export async function loadMemoryCatalog(): Promise<AgentDirectoryCard[]> {
  const governance = await loadGovernanceStatus();
  return Array.isArray(governance.catalog) ? governance.catalog : [];
}

export async function loadOpenVikingStatus(): Promise<OpenVikingStatus> {
  const res = await fetch(`${getBackendBaseURL()}/api/openviking/status`);
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { detail?: string };
    throw new Error(
      toErrorMessage(
        err,
        `Failed to load OpenViking status: ${res.statusText}`,
      ),
    );
  }
  return (await res.json()) as OpenVikingStatus;
}

export async function runOpenVikingGovernance(): Promise<Record<string, unknown>> {
  const res = await fetch(`${getBackendBaseURL()}/api/openviking/governance/run`, {
    method: "POST",
  });
  const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(
      toErrorMessage(payload, `Failed to run OpenViking governance: ${res.statusText}`),
    );
  }
  return payload;
}

export async function compactOpenVikingMemory(params?: {
  ratio?: number;
  scope?: MemoryViewScope;
  agentName?: string | null;
}): Promise<Record<string, unknown>> {
  const res = await fetch(`${getBackendBaseURL()}/api/openviking/compact`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ratio: params?.ratio ?? 0.8,
      scope: params?.scope ?? "auto",
      agent_name: params?.agentName ?? undefined,
    }),
  });
  const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(
      toErrorMessage(payload, `Failed to compact OpenViking memory: ${res.statusText}`),
    );
  }
  return payload;
}

export async function forgetOpenVikingMemory(params: {
  memoryId: string;
  scope?: MemoryViewScope;
  agentName?: string | null;
}): Promise<Record<string, unknown>> {
  const res = await fetch(`${getBackendBaseURL()}/api/openviking/forget`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      memory_id: params.memoryId,
      scope: params.scope ?? "auto",
      agent_name: params.agentName ?? undefined,
    }),
  });
  const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(
      toErrorMessage(payload, `Failed to forget OpenViking memory: ${res.statusText}`),
    );
  }
  return payload;
}

export async function reindexOpenVikingVectors(includeAgents = true): Promise<Record<string, unknown>> {
  const res = await fetch(`${getBackendBaseURL()}/api/openviking/reindex-vectors`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ include_agents: includeAgents }),
  });
  const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(
      toErrorMessage(payload, `Failed to reindex OpenViking vectors: ${res.statusText}`),
    );
  }
  return payload;
}

export async function queryMemoryExplain(params: {
  query: string;
  limit?: number;
  scope?: MemoryViewScope;
  agentName?: string | null;
}): Promise<MemoryQueryExplain> {
  const search = new URLSearchParams();
  search.set("query", params.query);
  search.set("limit", String(params.limit ?? 8));
  search.set("scope", params.scope ?? "auto");
  if ((params.scope === "agent" || params.scope === "auto") && params.agentName) {
    search.set("agent_name", params.agentName);
  }
  const res = await fetch(`${getBackendBaseURL()}/api/memory/query/explain?${search.toString()}`);
  const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(
      toErrorMessage(payload, `Failed to explain memory query: ${res.statusText}`),
    );
  }
  return payload as unknown as MemoryQueryExplain;
}

export async function rebuildMemory(params?: {
  scope?: MemoryViewScope;
  agentName?: string | null;
}): Promise<Record<string, unknown>> {
  const res = await fetch(`${getBackendBaseURL()}/api/memory/rebuild`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      scope: params?.scope ?? "auto",
      agent_name: params?.agentName ?? undefined,
    }),
  });
  const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(
      toErrorMessage(payload, `Failed to rebuild memory indexes: ${res.statusText}`),
    );
  }
  return payload;
}

export async function exportTraceProcesslog(traceId: string): Promise<ProcesslogExport> {
  const res = await fetch(`${getBackendBaseURL()}/api/processlog/trace/${encodeURIComponent(traceId)}/export`);
  const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(
      toErrorMessage(payload, `Failed to export processlog by trace: ${res.statusText}`),
    );
  }
  return payload as unknown as ProcesslogExport;
}

export async function exportChatProcesslog(chatId: string): Promise<ProcesslogExport> {
  const res = await fetch(`${getBackendBaseURL()}/api/processlog/chat/${encodeURIComponent(chatId)}/export`);
  const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(
      toErrorMessage(payload, `Failed to export processlog by chat: ${res.statusText}`),
    );
  }
  return payload as unknown as ProcesslogExport;
}
