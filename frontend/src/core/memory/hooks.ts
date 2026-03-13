import { useQuery } from "@tanstack/react-query";

import {
  compactOpenVikingMemory,
  exportChatProcesslog,
  exportTraceProcesslog,
  forgetOpenVikingMemory,
  loadGovernanceStatus,
  loadMemoryCatalog,
  loadMemoryItems,
  loadOpenVikingStatus,
  queryMemoryExplain,
  rebuildMemory,
  reindexOpenVikingVectors,
  runOpenVikingGovernance,
  type MemoryViewScope,
} from "./api";

export function useMemoryView(scope: MemoryViewScope, agentName?: string | null) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["openviking", "memory-view", scope, agentName ?? ""],
    queryFn: async () => {
      const items = await loadMemoryItems({ scope, agentName });
      const lastUpdated = items[0]?.updated_at ?? "";
      return {
        version: "4.0",
        lastUpdated,
        facts: items.map((item) => ({
          id: item.memory_id,
          content: item.summary,
          confidence: item.score,
          source: item.source_thread_id,
          status: item.status,
          createdAt: item.created_at,
          uri: item.uri,
        })),
      };
    },
    enabled: scope !== "agent" || Boolean(agentName),
  });
  return { memory: data ?? null, isLoading, error };
}

export function useMemoryItems(scope: MemoryViewScope, agentName?: string | null) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["openviking", "items", scope, agentName ?? ""],
    queryFn: () => loadMemoryItems({ scope, agentName }),
    enabled: scope !== "agent" || Boolean(agentName),
  });
  return { items: data ?? [], isLoading, error };
}

export function useMemoryCatalog() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["openviking", "catalog"],
    queryFn: () => loadMemoryCatalog(),
  });
  return { catalog: data ?? [], isLoading, error };
}

export function useMemoryGovernanceStatus() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["openviking", "governance", "status"],
    queryFn: () => loadGovernanceStatus(),
  });
  return { governance: data ?? null, isLoading, error };
}

export function useOpenVikingStatus() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["openviking", "status"],
    queryFn: () => loadOpenVikingStatus(),
  });
  return { status: data ?? null, isLoading, error };
}

export const openVikingActions = {
  compact: compactOpenVikingMemory,
  exportChatProcesslog,
  exportTraceProcesslog,
  forget: forgetOpenVikingMemory,
  queryMemoryExplain,
  rebuildMemory,
  runGovernance: runOpenVikingGovernance,
  reindexVectors: reindexOpenVikingVectors,
};
