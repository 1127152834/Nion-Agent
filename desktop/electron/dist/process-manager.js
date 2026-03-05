"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DesktopProcessManager = void 0;
const node_child_process_1 = require("node:child_process");
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const health_1 = require("./health");
class DesktopProcessManager {
    paths;
    observer;
    services = new Map();
    ports = null;
    constructor(paths, observer) {
        this.paths = paths;
        this.observer = observer;
    }
    async startup() {
        try {
            // 阶段 1：分配端口
            this.notifyStage("runtime.assign-ports");
            this.ports = await this.assignPorts();
            this.notifySuccess("runtime.assign-ports");
            // 阶段 2：检查依赖
            this.notifyStage("runtime.check-dependencies");
            await this.checkDependencies();
            this.notifySuccess("runtime.check-dependencies");
            // 阶段 3：启动 LangGraph
            this.notifyStage("runtime.start.langgraph");
            await this.startLangGraph();
            this.notifySuccess("runtime.start.langgraph");
            // 阶段 4：启动 Gateway
            this.notifyStage("runtime.start.gateway");
            await this.startGateway();
            this.notifySuccess("runtime.start.gateway");
            // 阶段 5：启动 Frontend
            this.notifyStage("runtime.start.frontend");
            await this.startFrontend();
            this.notifySuccess("runtime.start.frontend");
            return this.ports;
        }
        catch (error) {
            await this.shutdown();
            throw error;
        }
    }
    async assignPorts() {
        // 使用固定端口（与 Makefile 保持一致）
        return {
            langgraphPort: 2024,
            gatewayPort: 8001,
            frontendPort: 3000
        };
    }
    async checkDependencies() {
        // 检查 uv 和 pnpm
        const { spawnSync } = await Promise.resolve().then(() => __importStar(require("node:child_process")));
        const uvCheck = spawnSync("uv", ["--version"], { stdio: "ignore" });
        if (uvCheck.error || uvCheck.status !== 0) {
            throw new Error("uv not found. Please install: curl -LsSf https://astral.sh/uv/install.sh | sh");
        }
        const pnpmCheck = spawnSync("pnpm", ["--version"], { stdio: "ignore" });
        if (pnpmCheck.error || pnpmCheck.status !== 0) {
            throw new Error("pnpm not found. Please install: npm install -g pnpm");
        }
    }
    async startLangGraph() {
        const logPath = node_path_1.default.join(this.paths.logsDir, "langgraph.log");
        const logStream = (0, node_fs_1.createWriteStream)(logPath, { flags: "a" });
        const env = {
            ...process.env,
            NION_HOME: this.paths.appDataDir, // 关键：设置 NION_HOME
            NO_COLOR: "1"
        };
        const child = (0, node_child_process_1.spawn)("uv", ["run", "langgraph", "dev", "--no-browser", "--allow-blocking", "--no-reload"], {
            cwd: this.paths.backendCwd,
            env,
            stdio: ["ignore", "pipe", "pipe"]
        });
        child.stdout?.pipe(logStream);
        child.stderr?.pipe(logStream);
        this.services.set("langgraph", { name: "langgraph", child, logStream, logPath });
        // 等待服务启动
        await (0, health_1.waitForPort)(this.ports.langgraphPort, 30000);
    }
    async startGateway() {
        const logPath = node_path_1.default.join(this.paths.logsDir, "gateway.log");
        const logStream = (0, node_fs_1.createWriteStream)(logPath, { flags: "a" });
        const env = {
            ...process.env,
            NION_HOME: this.paths.appDataDir // 关键：设置 NION_HOME
        };
        const child = (0, node_child_process_1.spawn)("uv", ["run", "uvicorn", "src.gateway.app:app", "--host", "0.0.0.0", "--port", String(this.ports.gatewayPort)], {
            cwd: this.paths.backendCwd,
            env,
            stdio: ["ignore", "pipe", "pipe"]
        });
        child.stdout?.pipe(logStream);
        child.stderr?.pipe(logStream);
        this.services.set("gateway", { name: "gateway", child, logStream, logPath });
        // 等待服务启动
        await (0, health_1.waitForHttp)(`http://localhost:${this.ports.gatewayPort}/health`, 30000);
    }
    async startFrontend() {
        const logPath = node_path_1.default.join(this.paths.logsDir, "frontend.log");
        const logStream = (0, node_fs_1.createWriteStream)(logPath, { flags: "a" });
        const env = {
            ...process.env,
            // 关键：设置前端环境变量，指向本地服务
            NEXT_PUBLIC_LANGGRAPH_BASE_URL: `http://localhost:${this.ports.langgraphPort}`,
            NEXT_PUBLIC_BACKEND_BASE_URL: `http://localhost:${this.ports.gatewayPort}`,
            SKIP_ENV_VALIDATION: "1" // 跳过环境变量验证
        };
        const child = (0, node_child_process_1.spawn)("pnpm", ["run", "dev"], {
            cwd: this.paths.frontendCwd,
            env,
            stdio: ["ignore", "pipe", "pipe"]
        });
        child.stdout?.pipe(logStream);
        child.stderr?.pipe(logStream);
        this.services.set("frontend", { name: "frontend", child, logStream, logPath });
        // 等待服务启动
        await (0, health_1.waitForPort)(this.ports.frontendPort, 60000);
    }
    async shutdown() {
        for (const [name, service] of this.services) {
            try {
                service.child.kill("SIGTERM");
                service.logStream.end();
            }
            catch (error) {
                console.error(`Failed to stop ${name}:`, error);
            }
        }
        this.services.clear();
    }
    notifyStage(stage) {
        this.observer?.onStageStart?.(stage);
    }
    notifySuccess(stage) {
        this.observer?.onStageSuccess?.(stage);
    }
}
exports.DesktopProcessManager = DesktopProcessManager;
