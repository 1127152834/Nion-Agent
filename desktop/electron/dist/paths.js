"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveRuntimePaths = resolveRuntimePaths;
const electron_1 = require("electron");
const node_fs_1 = require("node:fs");
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
function ensureDir(dirPath) {
    if (!(0, node_fs_1.existsSync)(dirPath)) {
        (0, node_fs_1.mkdirSync)(dirPath, { recursive: true });
    }
    return dirPath;
}
// 关键：使用 .nion 而不是 .localnion，与当前项目保持一致
const DEFAULT_DESKTOP_APP_DATA_DIR_NAME = ".nion";
function resolveDesktopAppDataDir() {
    // 优先使用 NION_HOME 环境变量（与后端保持一致）
    if (process.env.NION_HOME) {
        return ensureDir(process.env.NION_HOME);
    }
    const targetDir = node_path_1.default.join(node_os_1.default.homedir(), DEFAULT_DESKTOP_APP_DATA_DIR_NAME);
    return ensureDir(targetDir);
}
function resolveRepoRoot() {
    // 从 desktop/electron/dist 回到项目根目录
    return node_path_1.default.resolve(__dirname, "..", "..", "..");
}
function resolveRuntimePaths() {
    const repoRoot = resolveRepoRoot();
    const appDataDir = resolveDesktopAppDataDir();
    const logsDir = ensureDir(node_path_1.default.join(appDataDir, "logs", "desktop"));
    // 开发模式：使用项目目录
    // 打包模式：使用 resources 目录（后续实现）
    const runtimeDir = electron_1.app.isPackaged
        ? node_path_1.default.join(process.resourcesPath, "runtime")
        : node_path_1.default.join(repoRoot, "desktop", "runtime");
    const pythonExecutable = null; // 开发模式使用系统 uv
    const skillsPath = node_path_1.default.join(repoRoot, "skills");
    const backendCwd = node_path_1.default.join(repoRoot, "backend");
    const frontendCwd = node_path_1.default.join(repoRoot, "frontend");
    return {
        repoRoot,
        appDataDir,
        logsDir,
        runtimeDir,
        pythonExecutable,
        skillsPath,
        backendCwd,
        frontendCwd,
        extensionsConfigPath: node_path_1.default.join(appDataDir, "extensions_config.json")
    };
}
