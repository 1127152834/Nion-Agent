import type { Artifact, InstalledPlugin, WorkbenchPlugin } from "./types";

/**
 * Workbench plugin registry
 * Manages plugin registration and matching
 */
export class WorkbenchRegistry {
  private plugins = new Map<string, WorkbenchPlugin>();
  private installedPlugins = new Map<string, InstalledPlugin>();

  /**
   * Register a plugin
   */
  register(plugin: WorkbenchPlugin): void {
    if (this.plugins.has(plugin.id)) {
      console.warn(`Plugin ${plugin.id} is already registered, replacing...`);
    }
    this.plugins.set(plugin.id, plugin);
  }

  /**
   * Unregister a plugin
   */
  unregister(id: string): void {
    this.plugins.delete(id);
  }

  /**
   * Get a plugin by ID
   */
  get(id: string): WorkbenchPlugin | undefined {
    return this.plugins.get(id);
  }

  /**
   * Get all registered plugins
   */
  list(): WorkbenchPlugin[] {
    return Array.from(this.plugins.values());
  }

  /**
   * Find the best matching plugin for an artifact
   * @returns The plugin with the highest priority, or null if none match
   */
  findBestMatch(artifact: Artifact): WorkbenchPlugin | null {
    const candidates = this.findAllMatches(artifact);
    return candidates[0] ?? null;
  }

  /**
   * Find all plugins that can handle an artifact
   * @returns Plugins sorted by priority (highest first)
   */
  findAllMatches(artifact: Artifact): WorkbenchPlugin[] {
    const candidates = Array.from(this.plugins.values())
      .map((plugin) => ({
        plugin,
        priority: plugin.canHandle(artifact),
      }))
      .filter(({ priority }) => typeof priority === "number" && priority > 0)
      .sort((a, b) => {
        const priorityDiff = (b.priority as number) - (a.priority as number);
        if (priorityDiff !== 0) {
          return priorityDiff;
        }
        return a.plugin.id.localeCompare(b.plugin.id, undefined, {
          sensitivity: "base",
        });
      });

    return candidates.map(({ plugin }) => plugin);
  }

  /**
   * Register installed plugin metadata
   */
  registerInstalled(installed: InstalledPlugin): void {
    this.installedPlugins.set(installed.manifest.id, installed);
  }

  /**
   * Unregister installed plugin metadata
   */
  unregisterInstalled(id: string): void {
    this.installedPlugins.delete(id);
  }

  /**
   * Get installed plugin metadata
   */
  getInstalled(id: string): InstalledPlugin | undefined {
    return this.installedPlugins.get(id);
  }

  /**
   * Get all installed plugins
   */
  listInstalled(): InstalledPlugin[] {
    return Array.from(this.installedPlugins.values());
  }
}

// Global registry instance
let globalRegistry: WorkbenchRegistry | null = null;

/**
 * Get the global workbench registry
 */
export function getWorkbenchRegistry(): WorkbenchRegistry {
  if (!globalRegistry) {
    globalRegistry = new WorkbenchRegistry();
  }
  return globalRegistry;
}
