import { spawnSync } from "node:child_process";
import path from "node:path";

import type { DesktopRuntimePaths } from "./paths";

export interface DesktopRuntimePorts {
  frontendPort: number;
  gatewayPort: number;
  langgraphPort: number;
}

export interface DesktopRuntimePortsConfig {
  version: string | null;
  ports: DesktopRuntimePorts;
}

export const DEFAULT_DESKTOP_RUNTIME_PORTS: DesktopRuntimePorts = {
  langgraphPort: 2024,
  gatewayPort: 8001,
  frontendPort: 3000,
};

type RuntimePortInput = Partial<
  Record<keyof DesktopRuntimePorts, number | string | null | undefined>
>;

const MIN_PORT = 1024;
const MAX_PORT = 65535;

const READ_RUNTIME_PORTS_SCRIPT = `
import json
from src.config.config_repository import ConfigRepository

repo = ConfigRepository()
config, version, _ = repo.read()

if not isinstance(config, dict):
    config = {}

desktop = config.get("desktop")
if not isinstance(desktop, dict):
    desktop = {}

runtime_ports = desktop.get("runtime_ports")
if not isinstance(runtime_ports, dict):
    runtime_ports = {}

print(json.dumps({
    "version": version,
    "langgraphPort": runtime_ports.get("langgraph_port"),
    "gatewayPort": runtime_ports.get("gateway_port"),
    "frontendPort": runtime_ports.get("frontend_port"),
}))
`.trim();

const WRITE_RUNTIME_PORTS_SCRIPT = `
import json
import sys

from src.config.config_repository import ConfigRepository
from src.config.config_store import VersionConflictError

ports = json.loads(sys.argv[1])

for _ in range(3):
    repo = ConfigRepository()
    config, version, _ = repo.read()

    if not isinstance(config, dict):
        config = {}

    desktop = config.get("desktop")
    if not isinstance(desktop, dict):
        desktop = {}
        config["desktop"] = desktop

    desktop["runtime_ports"] = {
        "langgraph_port": int(ports["langgraphPort"]),
        "gateway_port": int(ports["gatewayPort"]),
        "frontend_port": int(ports["frontendPort"]),
    }

    try:
        next_version = repo.write(config_dict=config, expected_version=version)
        print(json.dumps({"version": next_version}))
        break
    except VersionConflictError:
        continue
else:
    raise RuntimeError("Failed to update runtime ports after version conflicts")
`.trim();

function parseInteger(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isInteger(value) ? value : null;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isInteger(parsed) ? parsed : null;
  }

  return null;
}

function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port >= MIN_PORT && port <= MAX_PORT;
}

function parseJsonFromStdout<T>(stdout: string): T {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      return JSON.parse(lines[i]) as T;
    } catch {
      // Ignore non-JSON lines (debug logs, warnings, etc.)
    }
  }

  throw new Error(`No JSON payload found in Python output: ${stdout}`);
}

function runPythonScript(
  paths: DesktopRuntimePaths,
  script: string,
  args: string[] = [],
): string {
  const bundledPython = paths.pythonExecutable;
  const command = bundledPython ?? "uv";
  const commandArgs = bundledPython
    ? ["-c", script, ...args]
    : ["run", "python", "-c", script, ...args];

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NION_HOME: paths.appDataDir,
    NION_DESKTOP_RUNTIME: "1",
  };

  if (bundledPython) {
    const venvBinDir = path.dirname(bundledPython);
    const venvRoot = path.dirname(venvBinDir);
    env.VIRTUAL_ENV = venvRoot;
    env.PATH = `${venvBinDir}${path.delimiter}${process.env.PATH ?? ""}`;
  }

  const result = spawnSync(command, commandArgs, {
    cwd: paths.backendCwd,
    env,
    encoding: "utf-8",
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(
      `Python script failed (${result.status}): ${(result.stderr || result.stdout || "").trim()}`,
    );
  }

  return result.stdout ?? "";
}

function ensureDistinctPorts(ports: DesktopRuntimePorts): void {
  const values = [ports.langgraphPort, ports.gatewayPort, ports.frontendPort];
  if (new Set(values).size !== values.length) {
    throw new Error("Runtime ports must be distinct");
  }
}

export function sanitizeDesktopRuntimePorts(raw: RuntimePortInput): DesktopRuntimePorts {
  const langgraphPort = parseInteger(raw.langgraphPort);
  const gatewayPort = parseInteger(raw.gatewayPort);
  const frontendPort = parseInteger(raw.frontendPort);

  if (langgraphPort === null || !isValidPort(langgraphPort)) {
    throw new Error(`Invalid langgraphPort: ${String(raw.langgraphPort)}`);
  }

  if (gatewayPort === null || !isValidPort(gatewayPort)) {
    throw new Error(`Invalid gatewayPort: ${String(raw.gatewayPort)}`);
  }

  if (frontendPort === null || !isValidPort(frontendPort)) {
    throw new Error(`Invalid frontendPort: ${String(raw.frontendPort)}`);
  }

  const ports: DesktopRuntimePorts = {
    langgraphPort,
    gatewayPort,
    frontendPort,
  };

  ensureDistinctPorts(ports);
  return ports;
}

export function normalizeDesktopRuntimePorts(raw: RuntimePortInput): DesktopRuntimePorts {
  const parsed: DesktopRuntimePorts = {
    langgraphPort: parseInteger(raw.langgraphPort) ?? DEFAULT_DESKTOP_RUNTIME_PORTS.langgraphPort,
    gatewayPort: parseInteger(raw.gatewayPort) ?? DEFAULT_DESKTOP_RUNTIME_PORTS.gatewayPort,
    frontendPort: parseInteger(raw.frontendPort) ?? DEFAULT_DESKTOP_RUNTIME_PORTS.frontendPort,
  };

  const valid = {
    langgraphPort: isValidPort(parsed.langgraphPort)
      ? parsed.langgraphPort
      : DEFAULT_DESKTOP_RUNTIME_PORTS.langgraphPort,
    gatewayPort: isValidPort(parsed.gatewayPort)
      ? parsed.gatewayPort
      : DEFAULT_DESKTOP_RUNTIME_PORTS.gatewayPort,
    frontendPort: isValidPort(parsed.frontendPort)
      ? parsed.frontendPort
      : DEFAULT_DESKTOP_RUNTIME_PORTS.frontendPort,
  };

  if (new Set([valid.langgraphPort, valid.gatewayPort, valid.frontendPort]).size !== 3) {
    return { ...DEFAULT_DESKTOP_RUNTIME_PORTS };
  }

  return valid;
}

export function readDesktopRuntimePortsConfig(paths: DesktopRuntimePaths): DesktopRuntimePortsConfig {
  try {
    type ReadPayload = {
      version?: unknown;
      langgraphPort?: unknown;
      gatewayPort?: unknown;
      frontendPort?: unknown;
    };

    const stdout = runPythonScript(paths, READ_RUNTIME_PORTS_SCRIPT);
    const payload = parseJsonFromStdout<ReadPayload>(stdout);

    return {
      version: typeof payload.version === "string" ? payload.version : null,
      ports: normalizeDesktopRuntimePorts({
        langgraphPort: payload.langgraphPort as number | string | undefined,
        gatewayPort: payload.gatewayPort as number | string | undefined,
        frontendPort: payload.frontendPort as number | string | undefined,
      }),
    };
  } catch (error) {
    console.warn("[Runtime Ports] Failed to read config from store, using defaults", error);
    return {
      version: null,
      ports: { ...DEFAULT_DESKTOP_RUNTIME_PORTS },
    };
  }
}

export function writeDesktopRuntimePortsConfig(
  paths: DesktopRuntimePaths,
  rawPorts: RuntimePortInput,
): DesktopRuntimePortsConfig {
  const ports = sanitizeDesktopRuntimePorts(rawPorts);

  type WritePayload = {
    version?: unknown;
  };

  const stdout = runPythonScript(
    paths,
    WRITE_RUNTIME_PORTS_SCRIPT,
    [JSON.stringify(ports)],
  );
  const payload = parseJsonFromStdout<WritePayload>(stdout);

  return {
    version: typeof payload.version === "string" ? payload.version : null,
    ports,
  };
}
