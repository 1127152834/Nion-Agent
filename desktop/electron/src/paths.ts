import { app } from "electron";
import { existsSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export interface DesktopRuntimePaths {
  repoRoot: string;
  appDataDir: string;
  logsDir: string;
  runtimeDir: string;
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
  // 从 desktop/electron/dist 回到项目根目录
  return path.resolve(__dirname, "..", "..", "..");
}

export function resolveRuntimePaths(): DesktopRuntimePaths {
  const repoRoot = resolveRepoRoot();
  const appDataDir = resolveDesktopAppDataDir();
  const logsDir = ensureDir(path.join(appDataDir, "logs", "desktop"));

  // 开发模式：使用项目目录
  // 打包模式：使用 resources 目录（后续实现）
  const runtimeDir = app.isPackaged
    ? path.join(process.resourcesPath, "runtime")
    : path.join(repoRoot, "desktop", "runtime");

  const pythonExecutable = null; // 开发模式使用系统 uv
  const skillsPath = path.join(repoRoot, "skills");
  const backendCwd = path.join(repoRoot, "backend");
  const frontendCwd = path.join(repoRoot, "frontend");

  return {
    repoRoot,
    appDataDir,
    logsDir,
    runtimeDir,
    pythonExecutable,
    skillsPath,
    backendCwd,
    frontendCwd,
    extensionsConfigPath: path.join(appDataDir, "extensions_config.json")
  };
}
