import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  getInstalledPluginFiles,
  getInstalledPluginMetadataById,
  installPlugin,
  listInstalledPlugins,
  loadInstalledPlugin,
  runInstalledPluginTest,
  uninstallPlugin,
  updateInstalledPluginMetadata,
} from "./loader";
import { getWorkbenchRegistry } from "./registry";
import type { PluginTestReport } from "./types";

/**
 * Query key factory
 */
const workbenchKeys = {
  all: ["workbench"] as const,
  plugins: () => [...workbenchKeys.all, "plugins"] as const,
  plugin: (id: string) => [...workbenchKeys.plugins(), id] as const,
};

/**
 * Hook to list all installed plugins
 */
export function useInstalledPlugins() {
  return useQuery({
    queryKey: workbenchKeys.plugins(),
    queryFn: listInstalledPlugins,
  });
}

/**
 * Hook to get a specific plugin
 */
export function usePlugin(pluginId: string) {
  return useQuery({
    queryKey: workbenchKeys.plugin(pluginId),
    queryFn: () => loadInstalledPlugin(pluginId),
    enabled: !!pluginId,
  });
}

/**
 * Hook to load raw installed plugin package (manifest + files)
 */
export function useInstalledPluginPackage(pluginId: string) {
  return useQuery({
    queryKey: [...workbenchKeys.plugin(pluginId), "package"],
    queryFn: async () => {
      const [metadata, files] = await Promise.all([
        getInstalledPluginMetadataById(pluginId),
        getInstalledPluginFiles(pluginId),
      ]);
      if (!metadata) {
        return null;
      }
      return { metadata, files };
    },
    enabled: !!pluginId,
  });
}

/**
 * Hook to install a plugin from .nwp file
 */
export function useInstallPlugin() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      file,
      onProgress,
    }: {
      file: File;
      onProgress?: (progress: number) => void;
    }) => {
      const installed = await installPlugin(file, onProgress);

      // Load and register the plugin
      const plugin = await loadInstalledPlugin(installed.manifest.id);
      getWorkbenchRegistry().register(plugin);
      getWorkbenchRegistry().registerInstalled(installed);

      return installed;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workbenchKeys.plugins() });
    },
  });
}

/**
 * Hook to uninstall a plugin
 */
export function useUninstallPlugin() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (pluginId: string) => {
      await uninstallPlugin(pluginId);

      // Unregister from registry
      getWorkbenchRegistry().unregister(pluginId);
      getWorkbenchRegistry().unregisterInstalled(pluginId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workbenchKeys.plugins() });
    },
  });
}

/**
 * Hook to enable/disable a plugin
 */
export function useTogglePlugin() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      pluginId,
      enabled,
    }: {
      pluginId: string;
      enabled: boolean;
    }) => {
      const registry = getWorkbenchRegistry();

      // Update IndexedDB metadata
      const updated = await updateInstalledPluginMetadata(pluginId, { enabled });

      if (enabled) {
        const plugin = await loadInstalledPlugin(pluginId);
        registry.register(plugin);
        registry.registerInstalled(updated);
      } else {
        registry.unregister(pluginId);
        registry.unregisterInstalled(pluginId);
      }

      return updated;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workbenchKeys.plugins() });
    },
  });
}

/**
 * Hook to run plugin compatibility test
 */
export function useTestInstalledPlugin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      pluginId,
      threadId,
    }: {
      pluginId: string;
      threadId?: string;
    }): Promise<PluginTestReport> => {
      return runInstalledPluginTest(pluginId, { threadId });
    },
    onSuccess: (_report, variables) => {
      queryClient.invalidateQueries({ queryKey: workbenchKeys.plugins() });
      queryClient.invalidateQueries({ queryKey: workbenchKeys.plugin(variables.pluginId) });
    },
  });
}
