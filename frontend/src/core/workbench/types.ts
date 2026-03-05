import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Artifact metadata
 */
export interface Artifact {
  path: string;
  content?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Workbench action (toolbar button)
 */
export interface WorkbenchAction {
  id: string;
  label: string;
  icon?: LucideIcon;
  onClick: () => void;
  disabled?: boolean;
}

/**
 * Dialog options
 */
export interface DialogOptions {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
}

/**
 * Workbench context provided to plugins
 */
export interface WorkbenchContext {
  artifact: Artifact;
  threadId: string;

  // File operations (full permissions)
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  deleteFile(path: string): Promise<void>;
  listFiles(dir: string): Promise<string[]>;

  // Network (full permissions)
  fetch(url: string, options?: RequestInit): Promise<Response>;

  // UI operations
  toast(message: string, type?: "success" | "error" | "info"): void;
  dialog(options: DialogOptions): Promise<boolean>;
  addAction(action: WorkbenchAction): void;

  // Storage
  storage: {
    get(key: string): Promise<unknown>;
    set(key: string, value: unknown): Promise<void>;
    remove(key: string): Promise<void>;
  };
}

/**
 * Workbench plugin interface
 */
export interface WorkbenchPlugin {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  icon?: LucideIcon;

  /**
   * Check if this plugin can handle the given artifact
   * @returns Priority (0-100) or false if cannot handle
   */
  canHandle(artifact: Artifact): boolean | number;

  /**
   * Render the workbench UI
   */
  render(context: WorkbenchContext): ReactNode;

  /**
   * Lifecycle hooks
   */
  onMount?(context: WorkbenchContext): void;
  onSave?(content: string): Promise<void>;
  onClose?(): void;
}

/**
 * Plugin manifest (from manifest.json)
 */
export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  icon?: string;
  main: string;

  workbench: {
    fileTypes?: string[];
    mimeTypes?: string[];
    priority?: number;
  };

  dependencies?: Record<string, string>;
}

/**
 * Installed plugin metadata
 */
export interface InstalledPlugin {
  manifest: PluginManifest;
  path: string;
  enabled: boolean;
  installedAt: string;
}
