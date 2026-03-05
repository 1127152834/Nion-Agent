import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { InstalledPlugin, WorkbenchPlugin } from "./types";
import {
  installPlugin,
  listInstalledPlugins,
  loadInstalledPlugin,
  uninstallPlugin,
} from "./loader";
import { getWorkbenchRegistry } from "./registry";

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
      const installed = registry.getInstalled(pluginId);

      if (!installed) {
        throw new Error(`Plugin ${pluginId} not found`);
      }

      // Update metadata
      installed.enabled = enabled;
      registry.registerInstalled(installed);

      // If enabling, load and register the plugin
      if (enabled) {
        const plugin = await loadInstalledPlugin(pluginId);
        registry.register(plugin);
      } else {
        // If disabling, unregister from active plugins
        registry.unregister(pluginId);
      }

      return installed;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workbenchKeys.plugins() });
    },
  });
}
