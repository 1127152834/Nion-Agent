import JSZip from "jszip";

import type { InstalledPlugin, PluginManifest, WorkbenchPlugin } from "./types";

/**
 * Load and parse a .nwp plugin package
 */
export async function loadPluginPackage(file: File): Promise<{
  manifest: PluginManifest;
  files: Map<string, string>;
}> {
  const zip = new JSZip();
  const contents = await zip.loadAsync(file);

  // Read manifest.json
  const manifestFile = contents.file("manifest.json");
  if (!manifestFile) {
    throw new Error("manifest.json not found in plugin package");
  }

  const manifestText = await manifestFile.async("text");
  const manifest = JSON.parse(manifestText) as PluginManifest;

  // Validate manifest
  validateManifest(manifest);

  // Read all files
  const files = new Map<string, string>();
  const filePromises: Promise<void>[] = [];

  contents.forEach((relativePath, file) => {
    if (!file.dir) {
      filePromises.push(
        file.async("text").then((content) => {
          files.set(relativePath, content);
        }),
      );
    }
  });

  await Promise.all(filePromises);

  return { manifest, files };
}

/**
 * Validate plugin manifest
 */
function validateManifest(manifest: PluginManifest): void {
  if (!manifest.id || typeof manifest.id !== "string") {
    throw new Error("manifest.id is required and must be a string");
  }

  if (!manifest.name || typeof manifest.name !== "string") {
    throw new Error("manifest.name is required and must be a string");
  }

  if (!manifest.version || typeof manifest.version !== "string") {
    throw new Error("manifest.version is required and must be a string");
  }

  if (!manifest.main || typeof manifest.main !== "string") {
    throw new Error("manifest.main is required and must be a string");
  }

  if (!manifest.workbench || typeof manifest.workbench !== "object") {
    throw new Error("manifest.workbench is required and must be an object");
  }
}

/**
 * Install a plugin package
 */
export async function installPlugin(
  file: File,
  onProgress?: (progress: number) => void,
): Promise<InstalledPlugin> {
  onProgress?.(0);

  // Load and parse package
  const { manifest, files } = await loadPluginPackage(file);
  onProgress?.(30);

  // Save to local storage or IndexedDB
  const pluginPath = `~/.nion/workbench-plugins/${manifest.id}`;
  await savePluginFiles(manifest.id, files);
  onProgress?.(70);

  // Create installed plugin metadata
  const installed: InstalledPlugin = {
    manifest,
    path: pluginPath,
    enabled: true,
    installedAt: new Date().toISOString(),
  };

  // Save metadata
  await saveInstalledPluginMetadata(installed);
  onProgress?.(100);

  return installed;
}

/**
 * Uninstall a plugin
 */
export async function uninstallPlugin(pluginId: string): Promise<void> {
  // Remove files
  await deletePluginFiles(pluginId);

  // Remove metadata
  await deleteInstalledPluginMetadata(pluginId);
}

/**
 * Load an installed plugin
 */
export async function loadInstalledPlugin(
  pluginId: string,
): Promise<WorkbenchPlugin> {
  // Get plugin files from storage
  const files = await getPluginFiles(pluginId);
  const metadata = await getInstalledPluginMetadata(pluginId);

  if (!metadata) {
    throw new Error(`Plugin ${pluginId} not found`);
  }

  // Load the main entry file
  const mainFile = files.get(metadata.manifest.main);
  if (!mainFile) {
    throw new Error(`Main file ${metadata.manifest.main} not found`);
  }

  // Create a module from the code
  // Note: In production, this should be done in a Web Worker for isolation
  const module = await loadPluginModule(mainFile, files);

  return module.default;
}

/**
 * Load plugin module from code
 */
async function loadPluginModule(
  code: string,
  files: Map<string, string>,
): Promise<{ default: WorkbenchPlugin }> {
  // Create a blob URL for the module
  const blob = new Blob([code], { type: "application/javascript" });
  const url = URL.createObjectURL(blob);

  try {
    // Dynamic import
    const module = await import(/* @vite-ignore */ url);
    return module;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Storage helpers (using IndexedDB)

const DB_NAME = "nion-workbench-plugins";
const DB_VERSION = 1;
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
  files: Map<string, string>,
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

async function getPluginFiles(pluginId: string): Promise<Map<string, string>> {
  const db = await openDB();
  const tx = db.transaction(STORE_FILES, "readonly");
  const store = tx.objectStore(STORE_FILES);

  const filesObj = await new Promise<Record<string, string>>((resolve, reject) => {
    const request = store.get(pluginId);
    request.onsuccess = () => resolve(request.result || {});
    request.onerror = () => reject(request.error);
  });

  db.close();

  return new Map(Object.entries(filesObj));
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
