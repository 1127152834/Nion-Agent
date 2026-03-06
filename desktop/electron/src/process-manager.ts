import { ChildProcess, spawn } from "node:child_process";
import { createWriteStream, WriteStream } from "node:fs";
import path from "node:path";
import { isPortInUse, waitForHttp, waitForPort } from "./health";
import type { DesktopRuntimePaths } from "./paths";

// 关键：只管理 3 个服务（没有 contextdb）
type ServiceName = "langgraph" | "gateway" | "frontend";

interface ManagedService {
  name: ServiceName;
  child: ChildProcess;
  logStream: WriteStream;
  logPath: string;
}

export interface DesktopRuntimePorts {
  frontendPort: number;
  gatewayPort: number;
  langgraphPort: number;
}

export interface DesktopStartupObserver {
  onStageStart?: (stage: string) => void;
  onStageSuccess?: (stage: string) => void;
  onStageFailure?: (stage: string, error: unknown) => void;
}

export class DesktopProcessManager {
  private services: Map<ServiceName, ManagedService> = new Map();
  private ports: DesktopRuntimePorts | null = null;

  constructor(
    private paths: DesktopRuntimePaths,
    private observer?: DesktopStartupObserver
  ) {}

  async startup(): Promise<DesktopRuntimePorts> {
    try {
      // 阶段 1：分配端口
      this.notifyStage("runtime.assign-ports");
      this.ports = await this.assignPorts();
      this.notifySuccess("runtime.assign-ports");

      // 阶段 1.5：校验端口可用（避免误连旧进程导致前端配置错乱）
      this.notifyStage("runtime.check-ports");
      await this.checkPortsAvailable();
      this.notifySuccess("runtime.check-ports");

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
    } catch (error) {
      await this.shutdown();
      throw error;
    }
  }

  private async assignPorts(): Promise<DesktopRuntimePorts> {
    // 使用固定端口（与 Makefile 保持一致）
    return {
      langgraphPort: 2024,
      gatewayPort: 8001,
      frontendPort: 3000
    };
  }

  private async checkDependencies(): Promise<void> {
    // 检查 uv 和 pnpm
    const { spawnSync } = await import("node:child_process");

    const uvCheck = spawnSync("uv", ["--version"], { stdio: "ignore" });
    if (uvCheck.error || uvCheck.status !== 0) {
      throw new Error("uv not found. Please install: curl -LsSf https://astral.sh/uv/install.sh | sh");
    }

    const pnpmCheck = spawnSync("pnpm", ["--version"], { stdio: "ignore" });
    if (pnpmCheck.error || pnpmCheck.status !== 0) {
      throw new Error("pnpm not found. Please install: npm install -g pnpm");
    }
  }

  private async checkPortsAvailable(): Promise<void> {
    if (!this.ports) {
      throw new Error("Ports not assigned");
    }

    const checks = await Promise.all([
      isPortInUse(this.ports.langgraphPort),
      isPortInUse(this.ports.gatewayPort),
      isPortInUse(this.ports.frontendPort)
    ]);
    const inUsePorts = [
      checks[0] ? this.ports.langgraphPort : null,
      checks[1] ? this.ports.gatewayPort : null,
      checks[2] ? this.ports.frontendPort : null
    ].filter((port): port is number => port !== null);

    if (inUsePorts.length > 0) {
      throw new Error(`Port conflict detected: ${inUsePorts.join(", ")}`);
    }
  }

  private async startLangGraph(): Promise<void> {
    const logPath = path.join(this.paths.logsDir, "langgraph.log");
    const logStream = createWriteStream(logPath, { flags: "a" });

    const env = {
      ...process.env,
      NION_HOME: this.paths.appDataDir, // 关键：设置 NION_HOME
      NO_COLOR: "1"
    };

    const child = spawn(
      "uv",
      ["run", "langgraph", "dev", "--no-browser", "--allow-blocking", "--no-reload"],
      {
        cwd: this.paths.backendCwd,
        env,
        stdio: ["ignore", "pipe", "pipe"]
      }
    );

    child.stdout?.pipe(logStream);
    child.stderr?.pipe(logStream);

    this.services.set("langgraph", { name: "langgraph", child, logStream, logPath });

    // 等待服务启动
    await waitForPort(this.ports!.langgraphPort, 30000);
  }

  private async startGateway(): Promise<void> {
    const logPath = path.join(this.paths.logsDir, "gateway.log");
    const logStream = createWriteStream(logPath, { flags: "a" });

    const env = {
      ...process.env,
      NION_HOME: this.paths.appDataDir, // 关键：设置 NION_HOME
      CORS_ORIGINS: `http://localhost:${this.ports!.frontendPort},http://127.0.0.1:${this.ports!.frontendPort}`,
    };

    const child = spawn(
      "uv",
      ["run", "uvicorn", "src.gateway.app:app", "--host", "0.0.0.0", "--port", String(this.ports!.gatewayPort)],
      {
        cwd: this.paths.backendCwd,
        env,
        stdio: ["ignore", "pipe", "pipe"]
      }
    );

    child.stdout?.pipe(logStream);
    child.stderr?.pipe(logStream);

    this.services.set("gateway", { name: "gateway", child, logStream, logPath });

    // 等待服务启动
    await waitForHttp(`http://localhost:${this.ports!.gatewayPort}/health`, 30000);
  }

  private async startFrontend(): Promise<void> {
    const logPath = path.join(this.paths.logsDir, "frontend.log");
    const logStream = createWriteStream(logPath, { flags: "a" });

    const env = {
      ...process.env,
      // 关键：设置前端环境变量，指向本地服务
      NEXT_PUBLIC_LANGGRAPH_BASE_URL: `http://localhost:${this.ports!.langgraphPort}`,
      NEXT_PUBLIC_BACKEND_BASE_URL: `http://localhost:${this.ports!.gatewayPort}`,
      SKIP_ENV_VALIDATION: "1" // 跳过环境变量验证
    };

    const child = spawn(
      "pnpm",
      ["run", "dev"],
      {
        cwd: this.paths.frontendCwd,
        env,
        stdio: ["ignore", "pipe", "pipe"]
      }
    );

    child.stdout?.pipe(logStream);
    child.stderr?.pipe(logStream);

    this.services.set("frontend", { name: "frontend", child, logStream, logPath });

    // 等待服务启动（HTTP 层可访问）
    await waitForPort(this.ports!.frontendPort, 60000);
    await waitForHttp(`http://localhost:${this.ports!.frontendPort}`, 30000);
  }

  async shutdown(): Promise<void> {
    for (const [name, service] of this.services) {
      try {
        service.child.kill("SIGTERM");
        service.logStream.end();
      } catch (error) {
        console.error(`Failed to stop ${name}:`, error);
      }
    }
    this.services.clear();
  }

  private notifyStage(stage: string): void {
    this.observer?.onStageStart?.(stage);
  }

  private notifySuccess(stage: string): void {
    this.observer?.onStageSuccess?.(stage);
  }
}
