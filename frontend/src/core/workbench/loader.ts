import JSZip from "jszip";

import { getBackendBaseURL } from "@/core/config";
import { isUUID } from "@/core/utils/uuid";

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
import { isSemver, normalizeSemver } from "./versioning";

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

interface PluginTestThreadResponse {
  thread_id: string;
  created_at?: string;
  workspace_root?: string;
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
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function normalizeManifest(raw: Partial<WorkbenchPluginManifestV2>): WorkbenchPluginManifestV2 {
  return {
    ...raw,
    id: String(raw.id ?? "").trim(),
    name: String(raw.name ?? "").trim(),
    version: normalizeSemver(raw.version, "0.1.0"),
    entry: String(raw.entry ?? "").trim(),
    runtime: "iframe",
    description: typeof raw.description === "string" ? raw.description : undefined,
    targets: Array.isArray(raw.targets) ? raw.targets : undefined,
    capabilities: Array.isArray(raw.capabilities) ? raw.capabilities : undefined,
    fixtures: Array.isArray(raw.fixtures) ? raw.fixtures : undefined,
    contributions: raw.contributions,
    testSpec: raw.testSpec,
    docs: raw.docs,
    verification: raw.verification,
    provenance: raw.provenance,
    ui: raw.ui,
  };
}

function normalizeInstalledPlugin(
  pluginId: string,
  raw: Partial<InstalledPlugin>,
): InstalledPlugin {
  const manifest = normalizeManifest(raw.manifest ?? {});
  const resolvedVersion = normalizeSemver(raw.version ?? manifest.version, manifest.version);
  manifest.version = resolvedVersion;
  return {
    manifest,
    version: resolvedVersion,
    path: typeof raw.path === "string" && raw.path.trim()
      ? raw.path
      : `~/.nion/workbench-plugins/${pluginId || manifest.id}`,
    enabled: raw.enabled ?? true,
    installedAt: typeof raw.installedAt === "string" && raw.installedAt.trim()
      ? raw.installedAt
      : new Date().toISOString(),
    verified: raw.verified,
    lastTestReport: raw.lastTestReport ?? null,
    pluginStudioSessionId: raw.pluginStudioSessionId,
    releaseNotes: raw.releaseNotes,
    publishedAt: raw.publishedAt,
  };
}

let cachedPluginTestThreadId: string | null = null;

/**
 * Ensure a hidden sandbox thread exists for workbench plugin tests.
 * This thread is NOT tied to any chat and only backs commandSteps/manual tests.
 */
export async function ensurePluginTestThreadId(): Promise<string> {
  if (cachedPluginTestThreadId) {
    return cachedPluginTestThreadId;
  }

  // Create a hidden sandbox thread so commandSteps can run without a chat thread.
  const response = await fetch(`${getBackendBaseURL()}/api/workbench/plugins/test-thread`, {
    method: "POST",
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Failed to create plugin test thread (${response.status})`);
  }
  const payload = (await response.json()) as PluginTestThreadResponse;
  if (!isUUID(payload.thread_id)) {
    throw new Error("Backend returned invalid plugin test thread id (expected UUID).");
  }
  cachedPluginTestThreadId = payload.thread_id;
  return payload.thread_id;
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
  const manifest = normalizeManifest(JSON.parse(manifestText) as Partial<WorkbenchPluginManifestV2>);
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
  const projectMarkers = rule.projectMarkers?.map((marker) =>
    marker.trim().toLowerCase(),
  );
  return {
    ...rule,
    extensions,
    projectMarkers,
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
  if (!manifest.version || !isSemver(manifest.version)) {
    throw new Error("manifest.version must be a semver string like 0.1.0");
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
  if (manifest.ui !== undefined && (manifest.ui === null || typeof manifest.ui !== "object")) {
    throw new Error("manifest.ui must be an object");
  }
  if (typeof manifest.ui?.initialWidthPercent === "number") {
    const width = manifest.ui.initialWidthPercent;
    if (!Number.isFinite(width) || width < 10 || width > 90) {
      throw new Error("manifest.ui.initialWidthPercent must be a number between 10 and 90");
    }
  }
}

function scoreRule(rule: WorkbenchTargetRule, artifact: Artifact): number {
  const priority = rule.priority ?? 50;
  const path = artifact.path;

  if (rule.kind === "directory" && artifact.kind !== "directory") {
    return 0;
  }
  if (
    rule.kind === "project"
    && artifact.kind !== "project"
    && artifact.kind !== "directory"
  ) {
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

  if (rule.projectMarkers && rule.projectMarkers.length > 0) {
    const rootFilesRaw = artifact.metadata?.directoryRootFiles;
    if (!Array.isArray(rootFilesRaw)) {
      return 0;
    }

    const rootFiles = new Set(
      rootFilesRaw
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim().toLowerCase()),
    );
    for (const marker of rule.projectMarkers) {
      const normalizedMarker = marker.trim().toLowerCase();
      if (!normalizedMarker || !rootFiles.has(normalizedMarker)) {
        return 0;
      }
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
    version: manifest.version,
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

export async function buildPluginPackageFile(params: {
  manifest: WorkbenchPluginManifestV2;
  files: Map<string, WorkbenchPackageFile>;
  filename?: string;
}): Promise<File> {
  const zip = new JSZip();
  zip.file("manifest.json", `${JSON.stringify(params.manifest, null, 2)}\n`);
  for (const [path, file] of params.files.entries()) {
    if (!path || path === "manifest.json") {
      continue;
    }
    if (file.encoding === "text") {
      zip.file(path, file.content);
      continue;
    }
    zip.file(path, base64ToBytes(file.content));
  }
  const blob = await zip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
    compressionOptions: { level: 9 },
  });
  return new File([blob], params.filename ?? `${params.manifest.id}.nwp`, {
    type: "application/zip",
  });
}

export async function exportInstalledPluginPackage(pluginId: string): Promise<File> {
  const [metadata, files] = await Promise.all([
    getInstalledPluginMetadata(pluginId),
    getPluginFiles(pluginId),
  ]);
  if (!metadata) {
    throw new Error(`Plugin ${pluginId} not found`);
  }
  const filename = `${metadata.manifest.id}-v${metadata.version}.nwp`;
  return buildPluginPackageFile({
    manifest: metadata.manifest,
    files,
    filename,
  });
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
    const candidateThreadId = opts?.threadId?.trim();
    let effectiveThreadId = candidateThreadId && isUUID(candidateThreadId)
      ? candidateThreadId
      : undefined;
    if (!effectiveThreadId) {
      try {
        effectiveThreadId = await ensurePluginTestThreadId();
      } catch (error) {
        steps.push({
          id: "command:thread-create-failed",
          passed: false,
          message: error instanceof Error ? error.message : "Failed to create plugin test thread.",
          durationMs: 0,
        });
      }
    }

    if (effectiveThreadId) {
      const commandReports = await runBackendCommandTest(pluginId, effectiveThreadId, manifest);
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

function toError(value: unknown, fallback: string): Error {
  if (value instanceof Error) {
    return value;
  }
  if (value && typeof value === "object" && "message" in value) {
    const message = (value as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) {
      return new Error(message);
    }
  }
  if (typeof value === "string" && value.trim()) {
    return new Error(value);
  }
  return new Error(fallback);
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(toError(request.error, "Failed to open workbench plugin database"));
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
    request.onerror = () => reject(toError(request.error, "Failed to save workbench plugin files"));
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
    request.onsuccess = () => resolve((request.result ?? {}) as Record<string, unknown>);
    request.onerror = () => reject(toError(request.error, "Failed to load workbench plugin files"));
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
    request.onerror = () => reject(toError(request.error, "Failed to delete workbench plugin files"));
  });

  db.close();
}

async function saveInstalledPluginMetadata(
  installed: InstalledPlugin,
): Promise<void> {
  const normalized = normalizeInstalledPlugin(installed.manifest.id, installed);
  const db = await openDB();
  const tx = db.transaction(STORE_METADATA, "readwrite");
  const store = tx.objectStore(STORE_METADATA);

  await new Promise<void>((resolve, reject) => {
    const request = store.put(normalized, normalized.manifest.id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(toError(request.error, "Failed to save workbench plugin metadata"));
  });

  db.close();
}

async function getInstalledPluginMetadata(
  pluginId: string,
): Promise<InstalledPlugin | null> {
  const db = await openDB();
  const tx = db.transaction(STORE_METADATA, "readonly");
  const store = tx.objectStore(STORE_METADATA);

  const metadata = await new Promise<Partial<InstalledPlugin> | null>((resolve, reject) => {
    const request = store.get(pluginId);
    request.onsuccess = () => resolve((request.result ?? null) as Partial<InstalledPlugin> | null);
    request.onerror = () => reject(toError(request.error, "Failed to load workbench plugin metadata"));
  });

  db.close();

  if (!metadata) {
    return null;
  }
  return normalizeInstalledPlugin(pluginId, metadata);
}

async function deleteInstalledPluginMetadata(pluginId: string): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(STORE_METADATA, "readwrite");
  const store = tx.objectStore(STORE_METADATA);

  await new Promise<void>((resolve, reject) => {
    const request = store.delete(pluginId);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(toError(request.error, "Failed to delete workbench plugin metadata"));
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

      const updated = normalizeInstalledPlugin(pluginId, {
        ...(existing as Partial<InstalledPlugin>),
        ...updates,
      });
      const putRequest = store.put(updated, pluginId);

      putRequest.onsuccess = () => {
        resolve(updated);
        db.close();
      };
      putRequest.onerror = () => {
        reject(toError(putRequest.error, "Failed to update workbench plugin metadata"));
        db.close();
      };
    };

    getRequest.onerror = () => {
      reject(toError(getRequest.error, "Failed to load workbench plugin metadata for update"));
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

  const plugins = await new Promise<Array<Partial<InstalledPlugin>>>((resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => resolve((request.result ?? []) as Array<Partial<InstalledPlugin>>);
    request.onerror = () => reject(toError(request.error, "Failed to list workbench plugins"));
  });

  db.close();

  return plugins
    .map((plugin) => normalizeInstalledPlugin(String(plugin.manifest?.id ?? ""), plugin))
    .filter((plugin) => Boolean(plugin.manifest.id));
}
