import { app } from "electron";
import { existsSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export interface DesktopRuntimePaths {
  repoRoot: string;
  appDataDir: string;
  logsDir: string;
  runtimeStateDir: string;
  runtimeDir: string;
  runtimeManifestPath: string;
  runtimeStatePath: string;
  runtimeOptionalDir: string;
  frontendServerEntry: string | null;
  pythonExecutable: string | null;
  skillsPath: string;
  backendCwd: string;
  frontendCwd: string;
  extensionsConfigPath: string;
}

function ensureDir(dirPath: string): string {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
  return dirPath;
}

// 关键：使用 .nion 而不是 .localnion，与当前项目保持一致
const DEFAULT_DESKTOP_APP_DATA_DIR_NAME = ".nion";

function resolveDesktopAppDataDir(): string {
  // 优先使用 NION_HOME 环境变量（与后端保持一致）
  if (process.env.NION_HOME) {
    return ensureDir(process.env.NION_HOME);
  }

  const targetDir = path.join(os.homedir(), DEFAULT_DESKTOP_APP_DATA_DIR_NAME);
  return ensureDir(targetDir);
}

function resolveRepoRoot(): string {
  if (app.isPackaged) {
    return process.resourcesPath;
  }
  // 从 desktop/electron/dist 回到项目根目录
  return path.resolve(__dirname, "..", "..", "..");
}

function resolvePackagedPythonExecutable(runtimeCoreDir: string): string {
  if (process.platform === "win32") {
    return path.join(runtimeCoreDir, "python", "Scripts", "python.exe");
  }
  return path.join(runtimeCoreDir, "python", "bin", "python3");
}

export function resolveRuntimePaths(): DesktopRuntimePaths {
  const repoRoot = resolveRepoRoot();
  const appDataDir = resolveDesktopAppDataDir();
  const logsDir = ensureDir(path.join(appDataDir, "logs", "desktop"));
  const runtimeStateDir = ensureDir(path.join(appDataDir, "runtime"));
  const runtimeOptionalDir = ensureDir(path.join(runtimeStateDir, "optional"));

  const packagedRuntimeDir = app.isPackaged ? path.join(process.resourcesPath, "runtime") : null;
  const downloadedRuntimeDir = runtimeStateDir;
  const downloadedRuntimeManifestPath = path.join(downloadedRuntimeDir, "manifest.json");

  const runtimeDir = app.isPackaged
    ? (() => {
        const packagedCoreDir = path.join(packagedRuntimeDir!, "core");
        if (existsSync(packagedCoreDir)) {
          return packagedRuntimeDir!;
        }

        const downloadedCoreDir = path.join(downloadedRuntimeDir, "core");
        if (existsSync(downloadedCoreDir) && existsSync(downloadedRuntimeManifestPath)) {
          return downloadedRuntimeDir;
        }

        // Slim installer: only manifest is bundled, core will be installed to runtimeStateDir later.
        return packagedRuntimeDir!;
      })()
    : path.join(repoRoot, "desktop", "runtime");
  const runtimeManifestPath = path.join(runtimeDir, "manifest.json");

  const runtimeCoreDir = path.join(runtimeDir, "core");
  let pythonExecutable: string | null = null;
  if (app.isPackaged) {
    const candidate = resolvePackagedPythonExecutable(runtimeCoreDir);
    pythonExecutable = existsSync(candidate) ? candidate : null;
  }
  const frontendCwd = app.isPackaged
    ? path.join(runtimeCoreDir, "frontend")
    : path.join(repoRoot, "frontend");
  const backendCwd = app.isPackaged
    ? path.join(runtimeCoreDir, "backend")
    : path.join(repoRoot, "backend");
  const frontendServerEntryCandidate = app.isPackaged ? path.join(frontendCwd, "server.js") : null;
  const frontendServerEntry = frontendServerEntryCandidate && existsSync(frontendServerEntryCandidate)
    ? frontendServerEntryCandidate
    : null;
  const skillsPath = path.join(repoRoot, "skills");

  return {
    repoRoot,
    appDataDir,
    logsDir,
    runtimeStateDir,
    runtimeDir,
    runtimeManifestPath,
    runtimeStatePath: path.join(runtimeStateDir, "state.json"),
    runtimeOptionalDir,
    frontendServerEntry,
    pythonExecutable,
    skillsPath,
    backendCwd,
    frontendCwd,
    extensionsConfigPath: path.join(appDataDir, "extensions_config.json")
  };
}
