import { getWorkbenchRegistry, type InstalledPlugin } from "@/core/workbench";
import {
  installPlugin,
  listInstalledPlugins,
  loadInstalledPlugin,
} from "@/core/workbench/loader";

import DocumentPreviewPlugin from "./document-preview";

// import ExampleImageViewerPlugin from "./example-image-viewer";

/**
 * Initialize and register built-in workbench plugins
 * Call this function when the app starts
 */
type BundledWorkbenchPlugin = {
  id: string;
  packageURL: string;
};

const BUNDLED_WORKBENCH_PLUGINS: BundledWorkbenchPlugin[] = [
  {
    id: "frontend-workbench",
    packageURL: "/workbench-plugins/frontend-workbench.nwp",
  },
];

async function installBundledPluginIfMissing(
  existingById: Map<string, InstalledPlugin>,
  bundled: BundledWorkbenchPlugin,
) {
  if (existingById.has(bundled.id)) {
    return;
  }

  const response = await fetch(bundled.packageURL, { cache: "no-cache" });
  if (!response.ok) {
    throw new Error(`Failed to fetch bundled plugin ${bundled.id}: ${response.status}`);
  }
  const blob = await response.blob();
  const filename = bundled.packageURL.split("/").pop() || `${bundled.id}.nwp`;
  const file = new File([blob], filename, { type: blob.type || "application/zip" });
  const installed = await installPlugin(file);
  existingById.set(installed.manifest.id, installed);
}

export async function initializeBuiltInPlugins() {
  const registry = getWorkbenchRegistry();

  // Register built-in plugins
  registry.register(DocumentPreviewPlugin);
  // registry.register(ExampleImageViewerPlugin); // Removed: now available as installable plugin

  // Load and register installed plugins
  try {
    const installed = await listInstalledPlugins();
    const installedById = new Map(installed.map((item) => [item.manifest.id, item]));

    for (const bundled of BUNDLED_WORKBENCH_PLUGINS) {
      try {
        await installBundledPluginIfMissing(installedById, bundled);
      } catch (error) {
        console.warn(`Failed to auto-install bundled plugin ${bundled.id}:`, error);
      }
    }

    const enabled = Array.from(installedById.values()).filter((p) => p.enabled);

    for (const meta of enabled) {
      try {
        const plugin = await loadInstalledPlugin(meta.manifest.id);
        registry.register(plugin);
        registry.registerInstalled(meta);
      } catch (err) {
        console.error(`Failed to load plugin ${meta.manifest.id}:`, err);
        // Continue loading other plugins
      }
    }
  } catch (err) {
    console.error("Failed to restore installed plugins:", err);
  }

  console.log("Built-in workbench plugins initialized");
}
