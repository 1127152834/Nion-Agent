import { getBackendBaseURL } from "@/core/config";

import type { MCPConfig } from "./types";

export async function loadMCPConfig() {
  const response = await fetch(`${getBackendBaseURL()}/api/mcp/config`);
  return response.json() as Promise<MCPConfig>;
}

export async function updateMCPConfig(config: MCPConfig) {
  const response = await fetch(`${getBackendBaseURL()}/api/mcp/config`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(config),
    },
  );
  return response.json();
}

export interface MCPServerProbeResponse {
  success: boolean;
  message: string;
  tool_count: number;
  tools: string[];
}

export async function probeMCPServer(serverName: string) {
  const response = await fetch(
    `${getBackendBaseURL()}/api/mcp/servers/${encodeURIComponent(serverName)}/probe`,
  );
  const payload = (await response.json().catch(() => null)) as
    | MCPServerProbeResponse
    | { detail?: string }
    | null;

  if (!response.ok) {
    const detail = payload && "detail" in payload ? payload.detail : undefined;
    throw new Error(detail ?? `Failed to probe MCP server (${response.status})`);
  }

  return payload as MCPServerProbeResponse;
}
