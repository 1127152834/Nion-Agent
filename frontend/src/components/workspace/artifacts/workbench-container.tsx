"use client";

import { useEffect, useMemo } from "react";

import type { Artifact } from "@/core/workbench";
import {
  createWorkbenchContext,
  getWorkbenchRegistry,
  useInstalledPluginPackage,
} from "@/core/workbench";

import { WorkbenchPluginIframe } from "./workbench-plugin-iframe";

/**
 * Container component that delegates to workbench plugins
 * Falls back to children if no plugin can handle the artifact
 */
export function WorkbenchContainer({
  filepath,
  threadId,
  children,
  targetKind = "file",
}: {
  filepath: string;
  threadId: string;
  children: React.ReactNode;
  targetKind?: "file" | "directory" | "project";
}) {
  const registry = getWorkbenchRegistry();

  // Create artifact object from filepath
  const artifact: Artifact = useMemo(
    () => ({
      path: filepath,
      kind: targetKind,
      metadata: {},
    }),
    [filepath, targetKind],
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

  const { data: pluginPackage } = useInstalledPluginPackage(plugin?.id ?? "");
  const installedMetadata = pluginPackage?.metadata;
  const installedFiles = pluginPackage?.files;
  const shouldRenderIframePlugin =
    Boolean(
      plugin &&
      installedMetadata &&
      installedMetadata.enabled &&
      installedMetadata.manifest.runtime === "iframe" &&
      installedFiles,
    );

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
  if (plugin && context && shouldRenderIframePlugin && installedMetadata && installedFiles) {
    return (
      <WorkbenchPluginIframe
        plugin={installedMetadata}
        files={installedFiles}
        context={context}
      />
    );
  }

  if (plugin && context) {
    const rendered = plugin.render(context);
    if (rendered) {
      return <>{rendered}</>;
    }
  }

  // Otherwise, fall back to default children
  return <>{children}</>;
}
