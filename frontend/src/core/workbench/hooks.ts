import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  getInstalledPluginFiles,
  getInstalledPluginMetadataById,
  installPlugin,
  listInstalledPlugins,
  loadInstalledPlugin,
  uninstallPlugin,
  updateInstalledPluginMetadata,
} from "./loader";
import {
  autoVerifyPluginStudioSession,
  createPluginStudioSession,
  downloadWorkbenchMarketplacePluginPackage,
  generatePluginStudioSession,
  getWorkbenchMarketplacePluginDetail,
  listWorkbenchMarketplacePlugins,
  manualVerifyPluginStudioSession,
  packagePluginStudioSession,
} from "./marketplace";
import { getWorkbenchRegistry } from "./registry";
import { resolveInstalledPluginVersion } from "./versioning";

/**
 * Query key factory
 */
const workbenchKeys = {
  all: ["workbench"] as const,
  plugins: () => [...workbenchKeys.all, "plugins"] as const,
  plugin: (id: string) => [...workbenchKeys.plugins(), id] as const,
  marketplace: () => [...workbenchKeys.all, "marketplace"] as const,
  marketplaceDetail: (id: string) => [...workbenchKeys.marketplace(), "detail", id] as const,
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
      void queryClient.invalidateQueries({ queryKey: workbenchKeys.plugins() });
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
      void queryClient.invalidateQueries({ queryKey: workbenchKeys.plugins() });
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
      void queryClient.invalidateQueries({ queryKey: workbenchKeys.plugins() });
    },
  });
}

export function useWorkbenchMarketplacePlugins() {
  return useQuery({
    queryKey: workbenchKeys.marketplace(),
    queryFn: listWorkbenchMarketplacePlugins,
  });
}

export function useWorkbenchMarketplacePluginDetail(pluginId: string | null) {
  return useQuery({
    queryKey: workbenchKeys.marketplaceDetail(pluginId ?? ""),
    queryFn: () => getWorkbenchMarketplacePluginDetail(pluginId ?? ""),
    enabled: Boolean(pluginId),
  });
}

export function useInstallMarketplacePlugin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      pluginId,
      version,
    }: {
      pluginId: string;
      version?: string | null;
    }) => {
      const file = await downloadWorkbenchMarketplacePluginPackage(pluginId);
      const installed = await installPlugin(file);

      const nextVersion = resolveInstalledPluginVersion(installed.version, version);
      const finalInstalled = nextVersion !== installed.version
        ? await updateInstalledPluginMetadata(installed.manifest.id, { version: nextVersion })
        : installed;

      const plugin = await loadInstalledPlugin(finalInstalled.manifest.id);
      const registry = getWorkbenchRegistry();
      registry.register(plugin);
      registry.registerInstalled(finalInstalled);
      return finalInstalled;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: workbenchKeys.plugins() });
      void queryClient.invalidateQueries({ queryKey: workbenchKeys.marketplace() });
    },
  });
}

export function useCreatePluginStudioSession() {
  return useMutation({
    mutationFn: createPluginStudioSession,
  });
}

export function useGeneratePluginStudioSession() {
  return useMutation({
    mutationFn: ({
      sessionId,
      description,
    }: {
      sessionId: string;
      description?: string;
    }) => generatePluginStudioSession(sessionId, { description }),
  });
}

export function useAutoVerifyPluginStudioSession() {
  return useMutation({
    mutationFn: (sessionId: string) => autoVerifyPluginStudioSession(sessionId),
  });
}

export function useManualVerifyPluginStudioSession() {
  return useMutation({
    mutationFn: ({
      sessionId,
      passed,
      note,
    }: {
      sessionId: string;
      passed: boolean;
      note?: string;
    }) => manualVerifyPluginStudioSession(sessionId, { passed, note }),
  });
}

export function usePackagePluginStudioSession() {
  return useMutation({
    mutationFn: (sessionId: string) => packagePluginStudioSession(sessionId),
  });
}
