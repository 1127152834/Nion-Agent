import { useQuery } from "@tanstack/react-query";

import {
  type MemoryViewScope,
  loadGovernanceStatus,
  loadMemoryCatalog,
  loadMemoryItems,
  loadMemoryView,
} from "./api";

export function useMemoryView(scope: MemoryViewScope, agentName?: string | null) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["memory", "view", scope, agentName ?? ""],
    queryFn: () => loadMemoryView({ scope, agentName }),
    enabled: scope === "global" || Boolean(agentName),
  });
  return { memory: data ?? null, isLoading, error };
}

export function useMemoryItems(scope: MemoryViewScope, agentName?: string | null) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["memory", "items", scope, agentName ?? ""],
    queryFn: () => loadMemoryItems({ scope, agentName }),
    enabled: scope === "global" || Boolean(agentName),
  });
  return { items: data ?? [], isLoading, error };
}

export function useMemoryCatalog() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["memory", "catalog"],
    queryFn: () => loadMemoryCatalog(),
  });
  return { catalog: data ?? [], isLoading, error };
}

export function useMemoryGovernanceStatus() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["memory", "governance", "status"],
    queryFn: () => loadGovernanceStatus(),
  });
  return { governance: data ?? null, isLoading, error };
}
