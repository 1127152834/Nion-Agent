import JSZip from "jszip";
import { getBackendBaseURL } from "@/core/config";

import type {
  Artifact,
  InstalledPlugin,
  PluginTestAssertion,
  PluginTestReport,
  PluginTestStepReport,
  WorkbenchPackageFile,
  WorkbenchPlugin,
  WorkbenchPluginManifestV2,
  WorkbenchTargetRule,
} from "./types";

interface PluginTestBackendStepResult {
  id: string;
  passed: boolean;
  duration_ms: number;
  output_excerpt?: string;
  message?: string | null;
}

interface PluginTestBackendResponse {
  plugin_id: string;
  passed: boolean;
  executed_at: string;
  summary: string;
  steps: PluginTestBackendStepResult[];
}

const TEXT_FILE_EXTENSIONS = new Set([
  "html",
  "htm",
  "js",
  "mjs",
  "cjs",
  "ts",
  "tsx",
  "jsx",
  "css",
  "json",
  "txt",
  "md",
  "yml",
  "yaml",
  "xml",
  "svg",
  "toml",
  "ini",
  "env",
]);

function extName(path: string): string {
  const base = path.split("/").pop() ?? "";
  const idx = base.lastIndexOf(".");
  return idx > -1 ? base.slice(idx + 1).toLowerCase() : "";
}

function shouldReadAsText(path: string): boolean {
  return TEXT_FILE_EXTENSIONS.has(extName(path));
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i] ?? 0);
  }
  return btoa(binary);
}

/**
 * Load and parse a .nwp plugin package
 */
export async function loadPluginPackage(file: File): Promise<{
  manifest: WorkbenchPluginManifestV2;
  files: Map<string, WorkbenchPackageFile>;
}> {
  const zip = new JSZip();
  const contents = await zip.loadAsync(file);

  const manifestFile = contents.file("manifest.json");
  if (!manifestFile) {
    throw new Error("manifest.json not found in plugin package");
  }

  const manifestText = await manifestFile.async("text");
  const manifest = JSON.parse(manifestText) as WorkbenchPluginManifestV2;
  validateManifest(manifest);

  const files = new Map<string, WorkbenchPackageFile>();
  const filePromises: Promise<void>[] = [];

  contents.forEach((relativePath, zipFile) => {
    if (!zipFile.dir) {
      const readPromise = shouldReadAsText(relativePath)
        ? zipFile.async("text").then((content) => {
          files.set(relativePath, { encoding: "text", content });
        })
        : zipFile.async("uint8array").then((bytes) => {
          files.set(relativePath, {
            encoding: "base64",
            content: bytesToBase64(bytes),
          });
        });
      filePromises.push(readPromise);
    }
  });

  await Promise.all(filePromises);

  if (!files.has(manifest.entry)) {
    throw new Error(`Plugin entry file not found: ${manifest.entry}`);
  }

  return { manifest, files };
}

function normalizeRule(rule: WorkbenchTargetRule): WorkbenchTargetRule {
  const extensions = rule.extensions?.map((ext) => ext.toLowerCase());
  return {
    ...rule,
    extensions,
    priority: rule.priority ?? 50,
  };
}

/**
 * Validate plugin manifest
 */
function validateManifest(manifest: WorkbenchPluginManifestV2): void {
  if (!manifest.id || typeof manifest.id !== "string") {
    throw new Error("manifest.id is required and must be a string");
  }
  if (!manifest.name || typeof manifest.name !== "string") {
    throw new Error("manifest.name is required and must be a string");
  }
  if (!manifest.entry || typeof manifest.entry !== "string") {
    throw new Error("manifest.entry is required and must be a string");
  }
  if (!manifest.runtime || manifest.runtime !== "iframe") {
    throw new Error("manifest.runtime must be 'iframe'");
  }
  if (manifest.targets && !Array.isArray(manifest.targets)) {
    throw new Error("manifest.targets must be an array");
  }
  if (manifest.fixtures && !Array.isArray(manifest.fixtures)) {
    throw new Error("manifest.fixtures must be an array");
  }
}

function scoreRule(rule: WorkbenchTargetRule, artifact: Artifact): number {
  const priority = rule.priority ?? 50;
  const path = artifact.path;

  if (rule.kind === "directory" && artifact.kind !== "directory") {
    return 0;
  }
  if (rule.kind === "project" && artifact.kind !== "project") {
    return 0;
  }
  if (rule.kind === "file" && artifact.kind && artifact.kind !== "file") {
    return 0;
  }

  if (rule.extensions && rule.extensions.length > 0) {
    const extension = path.split(".").pop()?.toLowerCase() ?? "";
    if (!rule.extensions.some((ext) => ext.replace(/^\./, "") === extension.replace(/^\./, ""))) {
      return 0;
    }
  }

  if (rule.pathPattern) {
    try {
      const regex = new RegExp(rule.pathPattern, "i");
      if (!regex.test(path)) {
        return 0;
      }
    } catch {
      return 0;
    }
  }

  return priority;
}

function buildLegacyRuleFromEntry(entry: string): WorkbenchTargetRule {
  const normalized = entry.toLowerCase();
  if (normalized.endsWith(".html")) {
    return { kind: "file", extensions: ["html"], priority: 60 };
  }
  return { kind: "file", priority: 40 };
}

function createManifestRuntimePlugin(manifest: WorkbenchPluginManifestV2): WorkbenchPlugin {
  const normalizedRules = (manifest.targets?.map(normalizeRule) ?? [buildLegacyRuleFromEntry(manifest.entry)]);

  return {
    id: manifest.id,
    name: manifest.name,
    description: manifest.description,
    canHandle(artifact) {
      let best = 0;
      for (const rule of normalizedRules) {
        best = Math.max(best, scoreRule(rule, artifact));
      }
      return best > 0 ? best : false;
    },
    render() {
      return null;
    },
  };
}

/**
 * Install a plugin package
 */
export async function installPlugin(
  file: File,
  onProgress?: (progress: number) => void,
): Promise<InstalledPlugin> {
  onProgress?.(0);

  const { manifest, files } = await loadPluginPackage(file);
  onProgress?.(30);

  const pluginPath = `~/.nion/workbench-plugins/${manifest.id}`;
  await savePluginFiles(manifest.id, files);
  onProgress?.(70);

  const installed: InstalledPlugin = {
    manifest,
    path: pluginPath,
    enabled: true,
    installedAt: new Date().toISOString(),
    verified: false,
    lastTestReport: null,
  };

  await saveInstalledPluginMetadata(installed);
  onProgress?.(100);

  return installed;
}

/**
 * Uninstall a plugin
 */
export async function uninstallPlugin(pluginId: string): Promise<void> {
  await deletePluginFiles(pluginId);
  await deleteInstalledPluginMetadata(pluginId);
}

/**
 * Load an installed plugin
 */
export async function loadInstalledPlugin(
  pluginId: string,
): Promise<WorkbenchPlugin> {
  const metadata = await getInstalledPluginMetadata(pluginId);
  if (!metadata) {
    throw new Error(`Plugin ${pluginId} not found`);
  }
  return createManifestRuntimePlugin(metadata.manifest);
}

export async function getInstalledPluginFiles(pluginId: string): Promise<Map<string, WorkbenchPackageFile>> {
  return getPluginFiles(pluginId);
}

export async function getInstalledPluginMetadataById(pluginId: string): Promise<InstalledPlugin | null> {
  return getInstalledPluginMetadata(pluginId);
}

function runAssertion(
  assertion: PluginTestAssertion,
  files: Map<string, WorkbenchPackageFile>,
  manifest: WorkbenchPluginManifestV2,
): { passed: boolean; message: string } {
  if (assertion.type === "entry_exists") {
    const target = assertion.target || manifest.entry;
    const passed = files.has(target);
    return {
      passed,
      message: passed ? `Entry exists: ${target}` : `Entry not found: ${target}`,
    };
  }
  if (assertion.type === "fixture_exists") {
    const target = assertion.target;
    const passed = files.has(target);
    return {
      passed,
      message: passed ? `Fixture exists: ${target}` : `Fixture not found: ${target}`,
    };
  }
  return {
    passed: false,
    message: `Unsupported assertion type: ${String((assertion as { type?: string }).type)}`,
  };
}

async function runBackendCommandTest(
  pluginId: string,
  threadId: string,
  manifest: WorkbenchPluginManifestV2,
): Promise<PluginTestStepReport[]> {
  if (!manifest.testSpec?.commandSteps || manifest.testSpec.commandSteps.length === 0) {
    return [];
  }

  const response = await fetch(`${getBackendBaseURL()}/api/workbench/plugins/${pluginId}/test`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      thread_id: threadId,
      command_steps: manifest.testSpec.commandSteps,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Failed to run backend plugin test (${response.status})`);
  }

  const payload = (await response.json()) as PluginTestBackendResponse;
  return payload.steps.map((step) => ({
    id: step.id,
    passed: step.passed,
    message: step.message ?? (step.passed ? "Command step passed" : "Command step failed"),
    durationMs: step.duration_ms,
    outputExcerpt: step.output_excerpt,
  }));
}

export async function runInstalledPluginTest(
  pluginId: string,
  opts?: {
    threadId?: string;
  },
): Promise<PluginTestReport> {
  const metadata = await getInstalledPluginMetadata(pluginId);
  if (!metadata) {
    throw new Error(`Plugin ${pluginId} not found`);
  }

  const files = await getPluginFiles(pluginId);
  const manifest = metadata.manifest;
  const steps: PluginTestStepReport[] = [];

  const staticAssertions: PluginTestAssertion[] = [
    { type: "entry_exists", target: manifest.entry },
    ...(manifest.fixtures ?? []).map((fixture) => ({
      type: "fixture_exists" as const,
      target: fixture,
    })),
    ...(manifest.testSpec?.assertions ?? []),
  ];

  for (const assertion of staticAssertions) {
    const started = Date.now();
    const result = runAssertion(assertion, files, manifest);
    steps.push({
      id: `${assertion.type}:${assertion.target}`,
      passed: result.passed,
      message: result.message,
      durationMs: Date.now() - started,
    });
  }

  if (manifest.testSpec?.commandSteps?.length) {
    if (!opts?.threadId) {
      steps.push({
        id: "command:thread-required",
        passed: false,
        message: "Command steps require a thread context to run.",
        durationMs: 0,
      });
    } else {
      const commandReports = await runBackendCommandTest(pluginId, opts.threadId, manifest);
      steps.push(...commandReports);
    }
  }

  const passed = steps.every((step) => step.passed);
  const report: PluginTestReport = {
    pluginId,
    passed,
    executedAt: new Date().toISOString(),
    summary: passed
      ? `Plugin ${manifest.name} passed ${steps.length} test step(s).`
      : `Plugin ${manifest.name} failed ${steps.filter((step) => !step.passed).length} of ${steps.length} test step(s).`,
    steps,
  };

  await updateInstalledPluginMetadata(pluginId, {
    verified: passed,
    lastTestReport: report,
  });

  return report;
}

// Storage helpers (using IndexedDB)

const DB_NAME = "nion-workbench-plugins";
const DB_VERSION = 3;
const STORE_FILES = "plugin-files";
const STORE_METADATA = "plugin-metadata";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      if (!db.objectStoreNames.contains(STORE_FILES)) {
        db.createObjectStore(STORE_FILES);
      }

      if (!db.objectStoreNames.contains(STORE_METADATA)) {
        db.createObjectStore(STORE_METADATA);
      }
    };
  });
}

async function savePluginFiles(
  pluginId: string,
  files: Map<string, WorkbenchPackageFile>,
): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(STORE_FILES, "readwrite");
  const store = tx.objectStore(STORE_FILES);

  const filesObj = Object.fromEntries(files);
  await new Promise<void>((resolve, reject) => {
    const request = store.put(filesObj, pluginId);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });

  db.close();
}

function normalizeStoredPackageFile(value: unknown): WorkbenchPackageFile {
  if (typeof value === "string") {
    return {
      content: value,
      encoding: "text",
    };
  }
  if (
    value &&
    typeof value === "object" &&
    "content" in value &&
    "encoding" in value
  ) {
    const candidate = value as { content?: unknown; encoding?: unknown };
    if (
      typeof candidate.content === "string" &&
      (candidate.encoding === "text" || candidate.encoding === "base64")
    ) {
      return {
        content: candidate.content,
        encoding: candidate.encoding,
      };
    }
  }
  return {
    content: "",
    encoding: "text",
  };
}

async function getPluginFiles(pluginId: string): Promise<Map<string, WorkbenchPackageFile>> {
  const db = await openDB();
  const tx = db.transaction(STORE_FILES, "readonly");
  const store = tx.objectStore(STORE_FILES);

  const filesObj = await new Promise<Record<string, unknown>>((resolve, reject) => {
    const request = store.get(pluginId);
    request.onsuccess = () => resolve(request.result || {});
    request.onerror = () => reject(request.error);
  });

  db.close();

  const normalizedEntries = Object.entries(filesObj).map(([path, value]) => [
    path,
    normalizeStoredPackageFile(value),
  ] as const);
  return new Map(normalizedEntries);
}

async function deletePluginFiles(pluginId: string): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(STORE_FILES, "readwrite");
  const store = tx.objectStore(STORE_FILES);

  await new Promise<void>((resolve, reject) => {
    const request = store.delete(pluginId);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });

  db.close();
}

async function saveInstalledPluginMetadata(
  installed: InstalledPlugin,
): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(STORE_METADATA, "readwrite");
  const store = tx.objectStore(STORE_METADATA);

  await new Promise<void>((resolve, reject) => {
    const request = store.put(installed, installed.manifest.id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });

  db.close();
}

async function getInstalledPluginMetadata(
  pluginId: string,
): Promise<InstalledPlugin | null> {
  const db = await openDB();
  const tx = db.transaction(STORE_METADATA, "readonly");
  const store = tx.objectStore(STORE_METADATA);

  const metadata = await new Promise<InstalledPlugin | null>((resolve, reject) => {
    const request = store.get(pluginId);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });

  db.close();

  return metadata;
}

async function deleteInstalledPluginMetadata(pluginId: string): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(STORE_METADATA, "readwrite");
  const store = tx.objectStore(STORE_METADATA);

  await new Promise<void>((resolve, reject) => {
    const request = store.delete(pluginId);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });

  db.close();
}

/**
 * Update installed plugin metadata
 */
export async function updateInstalledPluginMetadata(
  pluginId: string,
  updates: Partial<InstalledPlugin>,
): Promise<InstalledPlugin> {
  const db = await openDB();
  const tx = db.transaction([STORE_METADATA], "readwrite");
  const store = tx.objectStore(STORE_METADATA);

  return new Promise((resolve, reject) => {
    const getRequest = store.get(pluginId);

    getRequest.onsuccess = () => {
      const existing = getRequest.result;
      if (!existing) {
        reject(new Error(`Plugin ${pluginId} not found`));
        db.close();
        return;
      }

      const updated = { ...existing, ...updates };
      const putRequest = store.put(updated, pluginId);

      putRequest.onsuccess = () => {
        resolve(updated);
        db.close();
      };
      putRequest.onerror = () => {
        reject(putRequest.error);
        db.close();
      };
    };

    getRequest.onerror = () => {
      reject(getRequest.error);
      db.close();
    };
  });
}

/**
 * List all installed plugins
 */
export async function listInstalledPlugins(): Promise<InstalledPlugin[]> {
  const db = await openDB();
  const tx = db.transaction(STORE_METADATA, "readonly");
  const store = tx.objectStore(STORE_METADATA);

  const plugins = await new Promise<InstalledPlugin[]>((resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });

  db.close();

  return plugins;
}
