import { getWorkbenchRegistry } from "@/core/workbench";

import ExampleImageViewerPlugin from "./example-image-viewer";

/**
 * Initialize and register built-in workbench plugins
 * Call this function when the app starts
 */
export function initializeBuiltInPlugins() {
  const registry = getWorkbenchRegistry();

  // Register built-in plugins
  registry.register(ExampleImageViewerPlugin);

  console.log("Built-in workbench plugins initialized");
}
