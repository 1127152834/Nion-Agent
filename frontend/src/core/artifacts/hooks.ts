import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import { useOptionalThread } from "@/components/workspace/messages/context";
import { getAPIClient } from "@/core/api";
import { uuid } from "@/core/utils/uuid";

import type { AgentThreadState, ArtifactGroup, ArtifactGroupMetadata } from "../threads";

import { loadArtifactGroups, loadWorkspaceTree, replaceArtifactGroups } from "./api";
import { loadArtifactContent, loadArtifactContentFromToolCall } from "./loader";

const artifactGroupsQueryKey = (threadId: string) =>
  ["artifact-groups", threadId] as const;
const workspaceTreeQueryKey = (
  threadId: string,
  root: string,
  depth: number,
  includeHidden: boolean,
  maxNodes: number,
) =>
  ["workspace-tree", threadId, root, depth, includeHidden ? 1 : 0, maxNodes] as const;

function normalizeArtifactGroups(
  artifactGroups: AgentThreadState["artifact_groups"],
): ArtifactGroup[] {
  if (!Array.isArray(artifactGroups)) {
    return [];
  }

  return artifactGroups
    .map((group) => {
      if (!group || typeof group !== "object") {
        return null;
      }
      if (typeof group.id !== "string" || typeof group.name !== "string") {
        return null;
      }
      if (!Array.isArray(group.artifacts)) {
        return null;
      }
      if (typeof group.created_at !== "number") {
        return null;
      }

      return {
        ...group,
        artifacts: group.artifacts.filter(
          (artifact): artifact is string => typeof artifact === "string",
        ),
      } satisfies ArtifactGroup;
    })
    .filter((group): group is ArtifactGroup => group !== null);
}

export interface CreateArtifactGroupInput {
  name: string;
  artifacts: string[];
  description?: string | null;
  metadata?: ArtifactGroupMetadata | null;
}

export interface UpdateArtifactGroupInput {
  name?: string;
  description?: string | null;
  artifacts?: string[];
  metadata?: ArtifactGroupMetadata | null;
}

export function useArtifactContent({
  filepath,
  threadId,
  enabled,
}: {
  filepath: string;
  threadId: string;
  enabled?: boolean;
}) {
  const isWriteFile = useMemo(() => {
    return filepath.startsWith("write-file:");
  }, [filepath]);
  const threadContext = useOptionalThread();
  const thread = threadContext?.thread;
  const isMock = threadContext?.isMock ?? false;
  const content = useMemo(() => {
    if (isWriteFile && thread) {
      return loadArtifactContentFromToolCall({ url: filepath, thread });
    }
    return null;
  }, [filepath, isWriteFile, thread]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["artifact", filepath, threadId, isMock],
    queryFn: () => {
      return loadArtifactContent({ filepath, threadId, isMock });
    },
    enabled,
    // Cache artifact content for 5 minutes to avoid repeated fetches (especially for .skill ZIP extraction)
    staleTime: 5 * 60 * 1000,
  });
  return { content: isWriteFile ? content : data, isLoading, error };
}

export function useArtifactGroups(
  threadId: string | undefined,
  {
    enabled = true,
    isMock = false,
  }: {
    enabled?: boolean;
    isMock?: boolean;
  } = {},
) {
  const apiClient = getAPIClient(isMock);
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: threadId ? artifactGroupsQueryKey(threadId) : ["artifact-groups"],
    enabled: enabled && Boolean(threadId),
    queryFn: async () => {
      if (!threadId) {
        return [] as ArtifactGroup[];
      }
      if (!isMock) {
        return loadArtifactGroups(threadId);
      }
      const state = await apiClient.threads.getState<AgentThreadState>(threadId);
      return normalizeArtifactGroups(state.values?.artifact_groups);
    },
    refetchOnWindowFocus: false,
  });

  const persistMutation = useMutation({
    mutationFn: async (nextGroups: ArtifactGroup[]) => {
      if (!threadId) {
        throw new Error("threadId is required");
      }
      if (!isMock) {
        return replaceArtifactGroups(threadId, nextGroups);
      }
      await apiClient.threads.updateState<Partial<AgentThreadState>>(threadId, {
        values: {
          artifact_groups: nextGroups,
        },
      });
      return nextGroups;
    },
    onSuccess: (nextGroups) => {
      if (!threadId) {
        return;
      }
      queryClient.setQueryData(artifactGroupsQueryKey(threadId), nextGroups);
      void queryClient.invalidateQueries({
        queryKey: ["threads", "search"],
        exact: false,
      });
    },
  });

  const groups = useMemo(() => query.data ?? [], [query.data]);

  const getLatestGroups = useCallback(() => {
    if (!threadId) {
      return groups;
    }
    const cachedGroups = queryClient.getQueryData<ArtifactGroup[]>(
      artifactGroupsQueryKey(threadId),
    );
    return cachedGroups ?? groups;
  }, [groups, queryClient, threadId]);

  const createGroup = useCallback(
    async (input: CreateArtifactGroupInput) => {
      const name = input.name.trim();
      if (!name) {
        throw new Error("Group name is required");
      }

      const newGroup: ArtifactGroup = {
        id: uuid(),
        name,
        description: input.description ?? null,
        artifacts: Array.from(new Set(input.artifacts)),
        created_at: Date.now(),
        metadata: input.metadata ?? null,
      };

      const nextGroups = [...getLatestGroups(), newGroup];
      await persistMutation.mutateAsync(nextGroups);
      return newGroup;
    },
    [getLatestGroups, persistMutation],
  );

  const updateGroup = useCallback(
    async (groupId: string, updates: UpdateArtifactGroupInput) => {
      const nextGroups = getLatestGroups().map((group) => {
        if (group.id !== groupId) {
          return group;
        }
        return {
          ...group,
          ...updates,
          artifacts: updates.artifacts
            ? Array.from(new Set(updates.artifacts))
            : group.artifacts,
          name:
            updates.name === undefined
              ? group.name
              : updates.name.trim().length > 0
                ? updates.name.trim()
                : group.name,
        };
      });
      await persistMutation.mutateAsync(nextGroups);
    },
    [getLatestGroups, persistMutation],
  );

  const deleteGroup = useCallback(
    async (groupId: string) => {
      const nextGroups = getLatestGroups().filter((group) => group.id !== groupId);
      await persistMutation.mutateAsync(nextGroups);
    },
    [getLatestGroups, persistMutation],
  );

  const addToGroup = useCallback(
    async (groupId: string, artifactPath: string) => {
      const nextGroups = getLatestGroups().map((group) => {
        if (group.id !== groupId) {
          return group;
        }
        if (group.artifacts.includes(artifactPath)) {
          return group;
        }
        return {
          ...group,
          artifacts: [...group.artifacts, artifactPath],
        };
      });
      await persistMutation.mutateAsync(nextGroups);
    },
    [getLatestGroups, persistMutation],
  );

  const removeFromGroup = useCallback(
    async (groupId: string, artifactPath: string) => {
      const nextGroups = getLatestGroups().map((group) => {
        if (group.id !== groupId) {
          return group;
        }
        return {
          ...group,
          artifacts: group.artifacts.filter((artifact) => artifact !== artifactPath),
        };
      });
      await persistMutation.mutateAsync(nextGroups);
    },
    [getLatestGroups, persistMutation],
  );

  const replaceGroups = useCallback(
    async (nextGroups: ArtifactGroup[]) => {
      await persistMutation.mutateAsync(nextGroups);
    },
    [persistMutation],
  );

  return {
    groups,
    isLoading: query.isLoading,
    error: query.error,
    replaceGroups,
    createGroup,
    updateGroup,
    deleteGroup,
    addToGroup,
    removeFromGroup,
    isSaving: persistMutation.isPending,
    refetch: query.refetch,
  };
}

export function useWorkspaceTree(
  threadId: string,
  opts?: {
    enabled?: boolean;
    root?: string;
    depth?: number;
    includeHidden?: boolean;
    maxNodes?: number;
    live?: boolean;
    refetchIntervalMs?: number;
  },
) {
  const enabled = opts?.enabled ?? true;
  const root = opts?.root ?? "/mnt/user-data";
  const depth = opts?.depth ?? 6;
  const includeHidden = opts?.includeHidden ?? false;
  const maxNodes = opts?.maxNodes ?? 5000;
  const live = opts?.live ?? false;
  const refetchIntervalMs = opts?.refetchIntervalMs ?? 1000;

  return useQuery({
    queryKey: workspaceTreeQueryKey(
      threadId,
      root,
      depth,
      includeHidden,
      maxNodes,
    ),
    queryFn: () =>
      loadWorkspaceTree(threadId, {
        root,
        depth,
        includeHidden,
        maxNodes,
      }),
    enabled: enabled && Boolean(threadId),
    refetchInterval: enabled && live ? refetchIntervalMs : false,
    refetchOnWindowFocus: false,
    staleTime: 0,
  });
}
