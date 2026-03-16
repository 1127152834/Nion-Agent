import { ChildProcess, spawn, spawnSync } from "node:child_process";
import { createWriteStream, existsSync, readFileSync, rmSync, statSync, WriteStream } from "node:fs";
import path from "node:path";
import { isPortInUse, waitForHttp, waitForPort } from "./health";
import type { DesktopRuntimePaths } from "./paths";
import { readDesktopRuntimePortsConfig, type DesktopRuntimePorts } from "./runtime-ports-config";

// 关键：只管理 3 个服务（没有 contextdb）
type ServiceName = "langgraph" | "gateway" | "frontend";

interface ManagedService {
  name: ServiceName;
  child: ChildProcess;
  logStream: WriteStream;
  logPath: string;
  logStartOffset?: number;
}

export type { DesktopRuntimePorts } from "./runtime-ports-config";

export interface DesktopStartupObserver {
  onStageStart?: (stage: string) => void;
  onStageSuccess?: (stage: string) => void;
  onStageFailure?: (stage: string, error: unknown) => void;
  /** 前端 HTTP 层已可访问时触发，此时可提前导航，无需等待完整健康检查 */
  onFrontendHttpReady?: (ports: DesktopRuntimePorts) => void;
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

      // 阶段 1.5：校验端口可用
      this.notifyStage("runtime.check-ports");
      await this.checkPortsAvailable();
      this.notifySuccess("runtime.check-ports");

      // 阶段 2：检查依赖
      this.notifyStage("runtime.check-dependencies");
      await this.checkDependencies();
      this.notifySuccess("runtime.check-dependencies");

      // 阶段 3 + 5 并行：LangGraph 启动 & Frontend 编译同步开始
      // Frontend 编译不依赖后端，提前 spawn 可节省 15-30s
      this.notifyStage("runtime.start.langgraph");
      this.notifyStage("runtime.start.frontend");
      // 注意：必须先 spawn LangGraph，否则 waitForPort 会一直超时，导致启动流程失败。
      const langgraphPromise = this.startLangGraph();
      const frontendSpawnInfo = this.spawnFrontend();
      await langgraphPromise;
      this.notifySuccess("runtime.start.langgraph");

      // 阶段 4：启动 Gateway（依赖 LangGraph 就绪）
      this.notifyStage("runtime.start.gateway");
      await this.startGateway();
      this.notifySuccess("runtime.start.gateway");

      // 阶段 4.5：恢复 pending runs
      this.notifyStage("runtime.recover.pending-runs");
      await this.recoverPendingRuns();
      this.notifySuccess("runtime.recover.pending-runs");

      // 阶段 5 续：等待 Frontend HTTP 就绪
      await this.waitForFrontendReady();
      this.notifySuccess("runtime.start.frontend");

      // 通知主进程可以提前导航
      this.observer?.onFrontendHttpReady?.(this.ports!);

      // 健康检查异步执行，不阻塞启动流程
      void this.verifyFrontendWorkspaceHealth(
        frontendSpawnInfo.logPath,
        frontendSpawnInfo.logStartOffset,
      ).catch((err) => {
        console.warn("[Frontend] Workspace health check failed (non-fatal):", err);
      });

      return this.ports!;
    } catch (error) {
      await this.shutdown();
      throw error;
    }
  }

  private async assignPorts(): Promise<DesktopRuntimePorts> {
    const { ports } = readDesktopRuntimePortsConfig(this.paths);
    console.log("[Runtime] Port assignment loaded from config.db:", ports);
    return ports;
  }

  private async checkDependencies(): Promise<void> {
    // 依赖策略：
    // - 优先使用打包内置的 Python（runtime/core/python）。
    // - 若无内置 Python，则退化为开发态依赖 uv（让 uv 管理 Python/依赖）。
    const bundledPython = this.paths.pythonExecutable;

    if (!bundledPython) {
      const uvCheck = spawnSync("uv", ["--version"], { stdio: "ignore" });
      if (uvCheck.error || uvCheck.status !== 0) {
        throw new Error("uv not found. Please install: curl -LsSf https://astral.sh/uv/install.sh | sh");
      }
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

    const inUsePorts = await this.findInUsePorts();
    if (inUsePorts.length === 0) {
      return;
    }

    console.warn(
      `[Runtime] Port conflict detected (${inUsePorts.join(", ")}). Attempting to terminate owner processes.`
    );

    await this.forceReleasePorts(inUsePorts);

    const remainingConflicts = await this.findInUsePorts();
    if (remainingConflicts.length > 0) {
      throw new Error(`Port conflict detected: ${remainingConflicts.join(", ")}`);
    }
  }

  private async findInUsePorts(): Promise<number[]> {
    if (!this.ports) {
      return [];
    }

    const checks = await Promise.all([
      isPortInUse(this.ports.langgraphPort),
      isPortInUse(this.ports.gatewayPort),
      isPortInUse(this.ports.frontendPort)
    ]);

    return [
      checks[0] ? this.ports.langgraphPort : null,
      checks[1] ? this.ports.gatewayPort : null,
      checks[2] ? this.ports.frontendPort : null
    ].filter((port): port is number => port !== null);
  }

  private async forceReleasePorts(ports: number[]): Promise<void> {
    const pidSet = new Set<number>();

    for (const port of ports) {
      const pids = this.findPortOwnerPids(port);
      for (const pid of pids) {
        pidSet.add(pid);
      }
    }

    if (pidSet.size === 0) {
      throw new Error(
        `Port conflict detected: ${ports.join(", ")} (unable to detect owner process PID)`
      );
    }

    console.warn(`[Runtime] Sending SIGTERM to PID(s): ${Array.from(pidSet).join(", ")}`);
    this.killPids(pidSet, "SIGTERM");
    await this.sleep(500);

    const remainingAfterTerm = ports.filter((port) => this.isPortStillInUseSync(port));
    if (remainingAfterTerm.length === 0) {
      return;
    }

    console.warn(
      `[Runtime] Port(s) still occupied after SIGTERM (${remainingAfterTerm.join(", ")}), sending SIGKILL`
    );
    this.killPids(pidSet, "SIGKILL");
    await this.sleep(200);
  }

  private isPortStillInUseSync(port: number): boolean {
    const result = spawnSync(
      process.platform === "win32" ? "netstat" : "lsof",
      process.platform === "win32"
        ? ["-ano", "-p", "tcp"]
        : ["-nP", "-t", `-iTCP:${port}`, "-sTCP:LISTEN"],
      { encoding: "utf-8" }
    );

    if (result.error) {
      return false;
    }

    if (process.platform === "win32") {
      return (result.stdout ?? "")
        .split(/\r?\n/)
        .some((line) => /LISTEN/i.test(line) && line.includes(`:${port}`));
    }

    return (result.stdout ?? "").trim().length > 0;
  }

  private findPortOwnerPids(port: number): number[] {
    if (process.platform === "win32") {
      return this.findPortOwnerPidsWindows(port);
    }

    const result = spawnSync("lsof", ["-nP", "-t", `-iTCP:${port}`, "-sTCP:LISTEN"], {
      encoding: "utf-8"
    });

    if (result.error) {
      console.warn(`[Runtime] Failed to inspect owner PID for port ${port}:`, result.error.message);
      return [];
    }

    return this.parsePidList(result.stdout ?? "");
  }

  private findPortOwnerPidsWindows(port: number): number[] {
    const result = spawnSync("netstat", ["-ano", "-p", "tcp"], { encoding: "utf-8" });
    if (result.error) {
      console.warn(`[Runtime] Failed to inspect owner PID for port ${port}:`, result.error.message);
      return [];
    }

    const pids = new Set<number>();
    const lines = (result.stdout ?? "").split(/\r?\n/);
    for (const line of lines) {
      if (!/LISTEN/i.test(line)) {
        continue;
      }
      if (!line.includes(`:${port}`)) {
        continue;
      }
      const columns = line.trim().split(/\s+/);
      const pid = Number(columns[columns.length - 1]);
      if (Number.isInteger(pid) && pid > 0 && pid !== process.pid) {
        pids.add(pid);
      }
    }
    return Array.from(pids);
  }

  private parsePidList(raw: string): number[] {
    const pids = new Set<number>();
    for (const token of raw.split(/\s+/)) {
      if (!token) {
        continue;
      }
      const pid = Number(token);
      if (Number.isInteger(pid) && pid > 0 && pid !== process.pid) {
        pids.add(pid);
      }
    }
    return Array.from(pids);
  }

  private killPids(pids: Set<number>, signal: NodeJS.Signals): void {
    for (const pid of pids) {
      try {
        process.kill(pid, signal);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[Runtime] Failed to send ${signal} to PID ${pid}: ${message}`);
      }
    }
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, ms));
  }

  private async startLangGraph(): Promise<void> {
    this.spawnLangGraph();
    await this.waitForLangGraph();
  }

  private spawnLangGraph(): void {
    const logPath = path.join(this.paths.logsDir, "langgraph.log");
    const logStream = createWriteStream(logPath, { flags: "a" });

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      NION_HOME: this.paths.appDataDir,
      NION_DESKTOP_RUNTIME: "1",
      NION_APP_IS_PACKAGED: this.paths.frontendServerEntry ? "1" : "0",
      NO_COLOR: "1"
    };

    if (this.paths.pythonExecutable) {
      env.NION_PYTHON_PATH = this.paths.pythonExecutable;
      const venvBinDir = path.dirname(this.paths.pythonExecutable);
      const venvRoot = path.dirname(venvBinDir);
      env.VIRTUAL_ENV = venvRoot;
      env.PATH = `${venvBinDir}${path.delimiter}${process.env.PATH ?? ""}`;
      console.log(`[LangGraph] Using bundled Python: ${this.paths.pythonExecutable}`);
    }

    const child = this.paths.pythonExecutable
      ? spawn(
          this.paths.pythonExecutable,
          ["-m", "langgraph_cli", "dev", "--no-browser", "--allow-blocking", "--no-reload"],
          { cwd: this.paths.backendCwd, env, stdio: ["ignore", "pipe", "pipe"] }
        )
      : spawn(
          "uv",
          ["run", "langgraph", "dev", "--no-browser", "--allow-blocking", "--no-reload"],
          { cwd: this.paths.backendCwd, env, stdio: ["ignore", "pipe", "pipe"] }
        );

    child.stdout?.pipe(logStream);
    child.stderr?.pipe(logStream);
    this.services.set("langgraph", { name: "langgraph", child, logStream, logPath });
  }

  private async waitForLangGraph(): Promise<void> {
    await waitForPort(this.ports!.langgraphPort, 30000);
  }

  private async startGateway(): Promise<void> {
    const logPath = path.join(this.paths.logsDir, "gateway.log");
    const logStream = createWriteStream(logPath, { flags: "a" });

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      NION_HOME: this.paths.appDataDir, // 关键：设置 NION_HOME
      NION_DESKTOP_RUNTIME: "1",
      NION_APP_IS_PACKAGED: this.paths.frontendServerEntry ? "1" : "0",
      CORS_ORIGINS: `http://localhost:${this.ports!.frontendPort},http://127.0.0.1:${this.ports!.frontendPort}`,
      LANGGRAPH_SERVER_BASE_URL: `http://localhost:${this.ports!.langgraphPort}`,
    };

    // 如果有内置 Python，设置 NION_PYTHON_PATH 环境变量（用于 LocalSandbox 等场景）
    if (this.paths.pythonExecutable) {
      env.NION_PYTHON_PATH = this.paths.pythonExecutable;
      const venvBinDir = path.dirname(this.paths.pythonExecutable);
      const venvRoot = path.dirname(venvBinDir);
      env.VIRTUAL_ENV = venvRoot;
      env.PATH = `${venvBinDir}${path.delimiter}${process.env.PATH ?? ""}`;
      console.log(`[Gateway] Using bundled Python: ${this.paths.pythonExecutable}`);
    }

    const child = this.paths.pythonExecutable
      ? spawn(
          this.paths.pythonExecutable,
          ["-m", "uvicorn", "app.gateway.app:app", "--host", "0.0.0.0", "--port", String(this.ports!.gatewayPort)],
          {
            cwd: this.paths.backendCwd,
            env,
            stdio: ["ignore", "pipe", "pipe"]
          }
        )
      : spawn(
          "uv",
          ["run", "uvicorn", "app.gateway.app:app", "--host", "0.0.0.0", "--port", String(this.ports!.gatewayPort)],
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

  private spawnFrontend(): { logPath: string; logStartOffset: number } {
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
      NEXT_PUBLIC_LANGGRAPH_BASE_URL: `http://localhost:${this.ports!.gatewayPort}/api/langgraph`,
      NEXT_PUBLIC_BACKEND_BASE_URL: `http://localhost:${this.ports!.gatewayPort}`,
      SKIP_ENV_VALIDATION: "1"
    };

    let child: ChildProcess;
    if (this.paths.frontendServerEntry) {
      child = spawn(
        process.execPath,
        [this.paths.frontendServerEntry],
        {
          cwd: this.paths.frontendCwd,
          env: { ...env, ELECTRON_RUN_AS_NODE: "1", NODE_ENV: "production" },
          stdio: ["ignore", "pipe", "pipe"]
        }
      );
    } else {
      child = spawn("pnpm", ["run", "dev"], {
        cwd: this.paths.frontendCwd,
        env,
        stdio: ["ignore", "pipe", "pipe"]
      });
    }

    child.stdout?.pipe(logStream);
    child.stderr?.pipe(logStream);
    this.services.set("frontend", { name: "frontend", child, logStream, logPath, logStartOffset });

    return { logPath, logStartOffset };
  }

  private async waitForFrontendReady(): Promise<void> {
    await waitForPort(this.ports!.frontendPort, 60000);
    await waitForHttp(`http://localhost:${this.ports!.frontendPort}`, 30000);
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
