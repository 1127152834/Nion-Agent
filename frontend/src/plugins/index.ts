import { getWorkbenchRegistry } from "@/core/workbench";
import {
  listInstalledPlugins,
  loadInstalledPlugin,
} from "@/core/workbench/loader";

import DocumentPreviewPlugin from "./document-preview";

// import ExampleImageViewerPlugin from "./example-image-viewer";

/**
 * Initialize and register built-in workbench plugins
 * Call this function when the app starts
 */
export async function initializeBuiltInPlugins() {
  const registry = getWorkbenchRegistry();

  // Register built-in plugins
  registry.register(DocumentPreviewPlugin);
  // registry.register(ExampleImageViewerPlugin); // Removed: now available as installable plugin

  // Load and register installed plugins
  try {
    const installed = await listInstalledPlugins();
    const enabled = installed.filter((p) => p.enabled);

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
