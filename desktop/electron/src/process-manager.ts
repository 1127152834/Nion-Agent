import { ChildProcess, spawn } from "node:child_process";
import { createWriteStream, existsSync, readFileSync, rmSync, statSync, WriteStream } from "node:fs";
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
  logStartOffset?: number;
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

      // 阶段 4.5：恢复上次异常遗留的 pending runs，避免队列被孤儿 run 堵死
      this.notifyStage("runtime.recover.pending-runs");
      await this.recoverPendingRuns();
      this.notifySuccess("runtime.recover.pending-runs");

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
    // 检查 uv；开发态前端还需要 pnpm，打包态使用 bundled frontend server
    const { spawnSync } = await import("node:child_process");

    const uvCheck = spawnSync("uv", ["--version"], { stdio: "ignore" });
    if (uvCheck.error || uvCheck.status !== 0) {
      throw new Error("uv not found. Please install: curl -LsSf https://astral.sh/uv/install.sh | sh");
    }

    if (!this.paths.frontendServerEntry) {
      const pnpmCheck = spawnSync("pnpm", ["--version"], { stdio: "ignore" });
      if (pnpmCheck.error || pnpmCheck.status !== 0) {
        throw new Error("pnpm not found. Please install: npm install -g pnpm");
      }
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

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      NION_HOME: this.paths.appDataDir, // 关键：设置 NION_HOME
      NION_DESKTOP_RUNTIME: "1",
      NO_COLOR: "1"
    };

    // 如果有内置 Python，设置 NION_PYTHON_PATH 环境变量
    if (this.paths.pythonExecutable) {
      env.NION_PYTHON_PATH = this.paths.pythonExecutable;
      console.log(`[LangGraph] Using bundled Python: ${this.paths.pythonExecutable}`);
    }

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

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      NION_HOME: this.paths.appDataDir, // 关键：设置 NION_HOME
      NION_DESKTOP_RUNTIME: "1",
      CORS_ORIGINS: `http://localhost:${this.ports!.frontendPort},http://127.0.0.1:${this.ports!.frontendPort}`,
      LANGGRAPH_SERVER_BASE_URL: `http://localhost:${this.ports!.langgraphPort}`,
    };

    // 如果有内置 Python，设置 NION_PYTHON_PATH 环境变量
    if (this.paths.pythonExecutable) {
      env.NION_PYTHON_PATH = this.paths.pythonExecutable;
      console.log(`[Gateway] Using bundled Python: ${this.paths.pythonExecutable}`);
    }

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

  private async recoverPendingRuns(): Promise<void> {
    if (!this.ports) {
      return;
    }

    const url = `http://localhost:${this.ports.gatewayPort}/api/langgraph/runs/cancel?action=interrupt`;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ status: "pending" })
      });

      if (response.status === 204 || response.status === 404) {
        return;
      }

      const body = await response.text();
      console.warn(`[Runtime] Pending run recovery returned ${response.status}: ${body}`);
    } catch (error) {
      console.warn("[Runtime] Pending run recovery skipped:", error);
    }
  }

  private async startFrontend(): Promise<void> {
    const logPath = path.join(this.paths.logsDir, "frontend.log");
    const logStartOffset = this.getLogStartOffset(logPath);

    if (!this.paths.frontendServerEntry) {
      this.clearFrontendDevArtifacts();
    }

    const logStream = createWriteStream(logPath, { flags: "a" });

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      HOSTNAME: "127.0.0.1",
      PORT: String(this.ports!.frontendPort),
      NEXT_PUBLIC_IS_ELECTRON: "1",
      // 关键：设置前端环境变量，LangGraph 统一走 Gateway 代理，避免浏览器直连 2024 的 CORS 问题
      NEXT_PUBLIC_LANGGRAPH_BASE_URL: `http://localhost:${this.ports!.gatewayPort}/api/langgraph`,
      NEXT_PUBLIC_BACKEND_BASE_URL: `http://localhost:${this.ports!.gatewayPort}`,
      SKIP_ENV_VALIDATION: "1" // 跳过环境变量验证
    };

    let child: ChildProcess;

    if (this.paths.frontendServerEntry) {
      child = spawn(
        process.execPath,
        [this.paths.frontendServerEntry],
        {
          cwd: this.paths.frontendCwd,
          env: {
            ...env,
            ELECTRON_RUN_AS_NODE: "1",
            NODE_ENV: "production"
          },
          stdio: ["ignore", "pipe", "pipe"]
        }
      );
    } else {
      child = spawn(
        "pnpm",
        ["run", "dev"],
        {
          cwd: this.paths.frontendCwd,
          env,
          stdio: ["ignore", "pipe", "pipe"]
        }
      );
    }

    child.stdout?.pipe(logStream);
    child.stderr?.pipe(logStream);

    this.services.set("frontend", {
      name: "frontend",
      child,
      logStream,
      logPath,
      logStartOffset,
    });

    // 等待服务启动（HTTP 层可访问）
    await waitForPort(this.ports!.frontendPort, 60000);
    await waitForHttp(`http://localhost:${this.ports!.frontendPort}`, 30000);
    await this.verifyFrontendWorkspaceHealth(logPath, logStartOffset);
  }

  private clearFrontendDevArtifacts(): void {
    const nextDir = path.join(this.paths.frontendCwd, ".next");
    const targets = [path.join(nextDir, "dev"), path.join(nextDir, "cache")];
    const removed: string[] = [];

    for (const target of targets) {
      if (!existsSync(target)) {
        continue;
      }
      rmSync(target, { recursive: true, force: true });
      removed.push(path.basename(target));
    }

    console.log(
      `[Frontend] Dev artifact cleanup: ${removed.length > 0 ? removed.join(", ") : "none"}`
    );
  }

  private getLogStartOffset(logPath: string): number {
    try {
      return statSync(logPath).size;
    } catch {
      return 0;
    }
  }

  private readLogDelta(logPath: string, startOffset: number): string {
    try {
      const content = readFileSync(logPath);
      return content.subarray(Math.min(startOffset, content.length)).toString("utf8");
    } catch {
      return "";
    }
  }

  private detectFrontendCompileBlocker(logDelta: string): string | null {
    const patterns = [
      "Parsing ecmascript source code failed",
      "Unexpected character",
      "Can't resolve <dynamic>",
      "Module not found",
    ];

    for (const pattern of patterns) {
      if (logDelta.includes(pattern)) {
        return pattern;
      }
    }

    return null;
  }

  private async verifyFrontendWorkspaceHealth(
    logPath: string,
    logStartOffset: number,
  ): Promise<void> {
    if (!this.ports) {
      throw new Error("Ports not assigned");
    }

    const workspaceUrl = `http://localhost:${this.ports.frontendPort}/workspace/chats/new`;
    const response = await fetch(workspaceUrl);
    const body = await response.text();
    const hasErrorPage =
      body.includes('data-next-error-message') || body.includes('name="next-error"');

    if (response.status === 404 || response.status >= 500 || hasErrorPage) {
      const logDelta = this.readLogDelta(logPath, logStartOffset);
      const blocker = this.detectFrontendCompileBlocker(logDelta);
      const blockerSuffix = blocker ? ` (compile blocker: ${blocker})` : "";
      throw new Error(
        `Frontend workspace health check failed for ${workspaceUrl}: HTTP ${response.status}${blockerSuffix}`
      );
    }

    const logDelta = this.readLogDelta(logPath, logStartOffset);
    if (logDelta.includes("Parsing ecmascript source code failed")) {
      throw new Error(
        "Frontend workspace health check detected a blocking compile error in the current startup log"
      );
    }

    console.log(`[Frontend] Workspace health check passed: ${workspaceUrl}`);
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
