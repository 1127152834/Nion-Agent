import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Artifact metadata
 */
export interface Artifact {
  path: string;
  kind?: "file" | "directory" | "project";
  content?: string;
  metadata?: Record<string, unknown>;
}

export interface WorkbenchPackageFile {
  content: string;
  encoding: "text" | "base64";
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
  readBinaryFile(path: string): Promise<{ dataUrl: string; mimeType: string }>;
  writeBinaryFile(path: string, dataUrl: string, mimeType?: string): Promise<void>;
  deleteFile(path: string): Promise<void>;
  listFiles(dir: string): Promise<string[]>;
  readDir(path: string): Promise<string[]>;

  // Command operations (thread boundary restricted on backend)
  runCommand(args: {
    command: string;
    cwd?: string;
    timeoutSeconds?: number;
  }): Promise<{ sessionId: string }>;
  stopCommand(sessionId: string): Promise<void>;
  streamLogs(
    sessionId: string,
    onEvent: (event: { event: string; payload: Record<string, unknown> }) => void,
  ): () => void;

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
  description?: string;
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

export interface WorkbenchTargetRule {
  kind: "file" | "directory" | "project";
  extensions?: string[];
  pathPattern?: string;
  projectMarkers?: string[];
  priority?: number;
}

export interface WorkbenchContribution {
  commands?: Array<{
    id: string;
    title: string;
    description?: string;
  }>;
  toolbarActions?: Array<{
    id: string;
    title: string;
    icon?: string;
  }>;
  settingsSchema?: Record<string, unknown>;
  openWithRules?: WorkbenchTargetRule[];
}

export interface PluginTestAssertion {
  type: "entry_exists" | "fixture_exists";
  target: string;
}

export interface PluginTestSpec {
  assertions?: PluginTestAssertion[];
  commandSteps?: Array<{
    id?: string;
    command: string;
    cwd?: string;
    timeout_seconds?: number;
    expect_contains?: string[];
  }>;
}

/**
 * Plugin manifest v2 (from manifest.json)
 */
export interface WorkbenchPluginManifestV2 {
  id: string;
  name: string;
  entry: string;
  description?: string;
  runtime: "iframe";
  targets?: WorkbenchTargetRule[];
  capabilities?: Array<
    | "file.read"
    | "file.write"
    | "file.delete"
    | "dir.list"
    | "command.run"
    | "command.stop"
    | "log.stream"
    | "toast"
    | "preview.open"
    | "state.persist"
  >;
  minHostVersion?: string;
  fixtures?: string[];
  contributions?: WorkbenchContribution;
  testSpec?: PluginTestSpec;
}

/**
 * Installed plugin metadata
 */
export interface InstalledPlugin {
  manifest: WorkbenchPluginManifestV2;
  path: string;
  enabled: boolean;
  installedAt: string;
  verified?: boolean;
  lastTestReport?: PluginTestReport | null;
}

export interface PluginTestStepReport {
  id: string;
  passed: boolean;
  message: string;
  durationMs: number;
  outputExcerpt?: string;
}

export interface PluginTestReport {
  pluginId: string;
  passed: boolean;
  executedAt: string;
  summary: string;
  steps: PluginTestStepReport[];
}
