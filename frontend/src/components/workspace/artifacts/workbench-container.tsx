"use client";

import { useEffect, useMemo } from "react";

import type { Artifact } from "@/core/workbench";
import { createWorkbenchContext, getWorkbenchRegistry } from "@/core/workbench";

/**
 * Container component that delegates to workbench plugins
 * Falls back to children if no plugin can handle the artifact
 */
export function WorkbenchContainer({
  filepath,
  threadId,
  children,
}: {
  filepath: string;
  threadId: string;
  children: React.ReactNode;
}) {
  const registry = getWorkbenchRegistry();

  // Create artifact object from filepath
  const artifact: Artifact = useMemo(
    () => ({
      path: filepath,
      metadata: {},
    }),
    [filepath],
  );

  // Find best matching plugin
  const plugin = useMemo(() => {
    return registry.findBestMatch(artifact);
  }, [registry, artifact]);

  // Create workbench context
  const context = useMemo(() => {
    if (!plugin) return null;
    return createWorkbenchContext(artifact, threadId);
  }, [plugin, artifact, threadId]);

  // Call plugin lifecycle hooks
  useEffect(() => {
    if (plugin && context) {
      plugin.onMount?.(context);
      return () => {
        plugin.onClose?.();
      };
    }
  }, [plugin, context]);

  // If plugin found, render it
  if (plugin && context) {
    return <>{plugin.render(context)}</>;
  }

  // Otherwise, fall back to default children
  return <>{children}</>;
}
