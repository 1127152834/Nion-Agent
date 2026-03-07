import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";

import {
  deleteMemoryFact,
  loadMemory,
  pinMemoryFact,
  updateMemoryFact,
} from "./api";
import type { UpdateMemoryFactRequest, UserMemory } from "./types";

const MEMORY_QUERY_KEY = ["memory"] as const;

function applyMemoryUpdate(
  queryClient: QueryClient,
  updater: (memory: UserMemory) => UserMemory,
) {
  queryClient.setQueryData<UserMemory>(MEMORY_QUERY_KEY, (previous) => {
    if (!previous) {
      return previous;
    }
    return updater(previous);
  });
}

export function useMemory() {
  const { data, isLoading, error } = useQuery({
    queryKey: MEMORY_QUERY_KEY,
    queryFn: () => loadMemory(),
  });
  return { memory: data ?? null, isLoading, error };
}

export function useUpdateMemoryFact() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      factId,
      updates,
    }: {
      factId: string;
      updates: UpdateMemoryFactRequest;
    }) => updateMemoryFact(factId, updates),
    onMutate: async ({ factId, updates }) => {
      await queryClient.cancelQueries({ queryKey: MEMORY_QUERY_KEY });
      const previous = queryClient.getQueryData<UserMemory>(MEMORY_QUERY_KEY);
      applyMemoryUpdate(queryClient, (memory) => ({
        ...memory,
        facts: memory.facts.map((fact) =>
          fact.id === factId ? { ...fact, ...updates } : fact,
        ),
      }));
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(MEMORY_QUERY_KEY, context.previous);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: MEMORY_QUERY_KEY });
    },
  });
}

export function usePinMemoryFact() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ factId, pinned }: { factId: string; pinned?: boolean }) =>
      pinMemoryFact(factId, pinned),
    onMutate: async ({ factId, pinned }) => {
      await queryClient.cancelQueries({ queryKey: MEMORY_QUERY_KEY });
      const previous = queryClient.getQueryData<UserMemory>(MEMORY_QUERY_KEY);
      applyMemoryUpdate(queryClient, (memory) => ({
        ...memory,
        facts: memory.facts.map((fact) => {
          if (fact.id !== factId) {
            return fact;
          }
          return {
            ...fact,
            pinned: typeof pinned === "boolean" ? pinned : !Boolean(fact.pinned),
          };
        }),
      }));
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(MEMORY_QUERY_KEY, context.previous);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: MEMORY_QUERY_KEY });
    },
  });
}

export function useDeleteMemoryFact() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ factId }: { factId: string }) => deleteMemoryFact(factId),
    onMutate: async ({ factId }) => {
      await queryClient.cancelQueries({ queryKey: MEMORY_QUERY_KEY });
      const previous = queryClient.getQueryData<UserMemory>(MEMORY_QUERY_KEY);
      applyMemoryUpdate(queryClient, (memory) => ({
        ...memory,
        facts: memory.facts.filter((fact) => fact.id !== factId),
      }));
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(MEMORY_QUERY_KEY, context.previous);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: MEMORY_QUERY_KEY });
    },
  });
}

export { MEMORY_QUERY_KEY };
