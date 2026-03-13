import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { platform } from "@/core/platform";
import { useDesktopRuntime } from "@/core/platform/hooks";

import { loadWorkspaceMeta } from "./api";

const workspaceMetaQueryKey = (threadId: string, root: string) =>
  ["workspace-meta", threadId, root] as const;

export type WorkspaceWatchEvent = {
  watchId: string;
  type: "rename" | "change";
  path: string;
  rootPath: string;
  watchedPath: string;
  filename: string | null;
  timestamp: number;
};

export function useWorkspaceMeta(
  threadId: string,
  opts?: {
    enabled?: boolean;
    root?: string;
  },
) {
  const enabled = opts?.enabled ?? true;
  const root = opts?.root ?? "/mnt/user-data";

  return useQuery({
    queryKey: workspaceMetaQueryKey(threadId, root),
    queryFn: () => loadWorkspaceMeta(threadId, { root }),
    enabled: enabled && Boolean(threadId),
    refetchOnWindowFocus: false,
  });
}

export function useWorkspaceLiveSync(
  threadId: string,
  opts?: {
    enabled?: boolean;
    root?: string;
  },
) {
  const enabled = opts?.enabled ?? true;
  const root = opts?.root ?? "/mnt/user-data";
  const { isDesktopRuntime } = useDesktopRuntime();
  const queryClient = useQueryClient();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const workspaceMeta = useWorkspaceMeta(threadId, {
    enabled: enabled && isDesktopRuntime,
    root,
  });

  useEffect(() => {
    if (
      !enabled
      || !isDesktopRuntime
      || !threadId
      || !workspaceMeta.data?.actual_root
      || workspaceMeta.data?.watch_supported === false
    ) {
      return;
    }

    let disposed = false;
    let watchId: string | null = null;
    let removeListener: (() => void) | null = null;

    const queueRefresh = () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        void queryClient.invalidateQueries({ queryKey: ["workspace-tree", threadId] });
        void queryClient.invalidateQueries({
          predicate: (query) =>
            Array.isArray(query.queryKey) &&
            query.queryKey[0] === "artifact" &&
            query.queryKey[2] === threadId,
        });
      }, 120);
    };

    const startWatch = async () => {
      try {
        const { watchId: nextWatchId } = await platform.startWatchingHostDirectory({
          path: workspaceMeta.data.actual_root,
        });
        if (disposed) {
          await platform.stopWatchingHostDirectory({ watchId: nextWatchId });
          return;
        }
        watchId = nextWatchId;
        removeListener = platform.onHostDirectoryChanged((event: WorkspaceWatchEvent) => {
          if (event.watchId !== watchId) {
            return;
          }
          queueRefresh();
        });
      } catch (error) {
        console.error("Failed to start native workspace watcher:", error);
      }
    };

    void startWatch();

    return () => {
      disposed = true;
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      removeListener?.();
      if (watchId) {
        void platform.stopWatchingHostDirectory({ watchId }).catch((error) => {
          console.error("Failed to stop native workspace watcher:", error);
        });
      }
    };
  }, [
    enabled,
    isDesktopRuntime,
    queryClient,
    root,
    threadId,
    workspaceMeta.data?.actual_root,
    workspaceMeta.data?.watch_supported,
  ]);

  return workspaceMeta;
}
