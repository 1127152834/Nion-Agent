import { getBackendBaseURL } from "@/core/config";

import type {
  MCPConfig,
  MCPDebugInfo,
  MCPMarketplaceInstallInput,
  MCPMarketplaceInstallOption,
  MCPMarketplaceServerDetail,
  MCPMarketplaceServerListItem,
  MCPToolchainEnsureResponse,
  MCPPrerequisiteResponse,
  MCPServerConfig,
  MCPServerProbeResponse,
} from "./types";

type MarketplaceMcpServerListItemPayload = {
  id: string;
  name: string;
  author?: string | null;
  category?: string | null;
  description: string;
  tags?: string[];
  verified?: boolean;
  featured?: boolean;
  version?: string;
  docs_url?: string | null;
  detail_url: string;
  fingerprints?: unknown[];
};

type MarketplaceMcpServerDetailPayload = {
  id: string;
  name: string;
  author?: string | null;
  category?: string | null;
  description: string;
  tags?: string[];
  verified?: boolean;
  featured?: boolean;
  version?: string;
  docs_url?: string | null;
  readme_markdown?: string;
  demo_image_urls?: string[];
  install_options?: MCPMarketplaceInstallOptionPayload[];
};

type MCPMarketplaceInstallOptionPayload = {
  id: string;
  label: string;
  transport: "stdio" | "sse" | "http";
  prerequisites?: string[];
  template: unknown;
  inputs?: MCPMarketplaceInstallInputPayload[];
};

type MCPMarketplaceInstallInputPayload = {
  id: string;
  label: string;
  type: MCPMarketplaceInstallInput["type"];
  required: boolean;
  default?: MCPMarketplaceInstallInput["default"];
  placeholder?: string;
  help?: string;
  options?: string[];
  apply: MCPMarketplaceInstallInput["apply"];
};

function resolveErrorMessage(rawText: string, fallback: string): string {
  const text = rawText.trim();
  if (!text) {
    return fallback;
  }
  try {
    const payload = JSON.parse(text) as { detail?: unknown };
    if (typeof payload.detail === "string" && payload.detail.trim()) {
      return payload.detail.trim();
    }
    if (
      payload.detail
      && typeof payload.detail === "object"
      && "message" in payload.detail
      && typeof (payload.detail as { message?: unknown }).message === "string"
      && (payload.detail as { message: string }).message.trim()
    ) {
      return (payload.detail as { message: string }).message.trim();
    }
  } catch {
    // fall through and return original text
  }
  return text;
}

function mapMcpMarketplaceInstallInput(
  payload: MCPMarketplaceInstallInputPayload,
): MCPMarketplaceInstallInput {
  return {
    id: String(payload.id ?? "").trim(),
    label: String(payload.label ?? "").trim(),
    type: payload.type,
    required: Boolean(payload.required),
    default: payload.default,
    placeholder: typeof payload.placeholder === "string" ? payload.placeholder : undefined,
    help: typeof payload.help === "string" ? payload.help : undefined,
    options: Array.isArray(payload.options) ? payload.options.filter((item): item is string => typeof item === "string") : undefined,
    apply: payload.apply,
  };
}

function mapMcpMarketplaceInstallOption(
  payload: MCPMarketplaceInstallOptionPayload,
): MCPMarketplaceInstallOption {
  return {
    id: String(payload.id ?? "").trim(),
    label: String(payload.label ?? "").trim(),
    transport: payload.transport,
    prerequisites: Array.isArray(payload.prerequisites)
      ? payload.prerequisites.filter((item): item is string => typeof item === "string")
      : [],
    template: (payload.template ?? {}) as MCPServerConfig,
    inputs: Array.isArray(payload.inputs) ? payload.inputs.map(mapMcpMarketplaceInstallInput) : [],
  };
}

function isHttpOrSseTransport(value: string): value is "http" | "sse" {
  return value === "http" || value === "sse";
}

function mapMcpMarketplaceServerListItem(
  payload: MarketplaceMcpServerListItemPayload,
): MCPMarketplaceServerListItem {
  const fingerprintsRaw = Array.isArray(payload.fingerprints) ? payload.fingerprints : [];
  const fingerprints = fingerprintsRaw
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const obj = item as Record<string, unknown>;
      const transport = typeof obj.transport === "string" ? obj.transport.trim() : "";
      if (transport === "stdio") {
        const command = typeof obj.command === "string" ? obj.command.trim() : "";
        const args_prefix = Array.isArray(obj.args_prefix)
          ? obj.args_prefix.filter((arg): arg is string => typeof arg === "string")
          : [];
        if (!command) return null;
        return { transport: "stdio" as const, command, args_prefix };
      }
      if (isHttpOrSseTransport(transport)) {
        const url = typeof obj.url === "string" ? obj.url.trim() : "";
        if (!url) return null;
        return { transport, url };
      }
      return null;
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));

  return {
    id: payload.id,
    name: payload.name,
    author: payload.author,
    category: payload.category,
    description: payload.description,
    tags: Array.isArray(payload.tags) ? payload.tags.filter((item): item is string => typeof item === "string") : [],
    verified: Boolean(payload.verified),
    featured: Boolean(payload.featured),
    version: typeof payload.version === "string" && payload.version.trim() ? payload.version : "0.0.0",
    docsUrl: payload.docs_url,
    detailUrl: payload.detail_url,
    fingerprints,
  };
}

function mapMcpMarketplaceServerDetail(
  payload: MarketplaceMcpServerDetailPayload,
): MCPMarketplaceServerDetail {
  return {
    id: payload.id,
    name: payload.name,
    author: payload.author,
    category: payload.category,
    description: payload.description,
    tags: Array.isArray(payload.tags) ? payload.tags.filter((item): item is string => typeof item === "string") : [],
    verified: Boolean(payload.verified),
    featured: Boolean(payload.featured),
    version: typeof payload.version === "string" && payload.version.trim() ? payload.version : "0.0.0",
    docsUrl: payload.docs_url,
    readmeMarkdown: typeof payload.readme_markdown === "string" ? payload.readme_markdown : "",
    demoImageUrls: Array.isArray(payload.demo_image_urls)
      ? payload.demo_image_urls.filter((item): item is string => typeof item === "string")
      : [],
    installOptions: Array.isArray(payload.install_options)
      ? payload.install_options.map(mapMcpMarketplaceInstallOption)
      : [],
    // Details endpoint doesn't currently include list fingerprints.
    fingerprints: [],
  };
}

export async function loadMCPConfig(): Promise<MCPConfig> {
  const response = await fetch(`${getBackendBaseURL()}/api/mcp/config`);
  if (!response.ok) {
    const detail = resolveErrorMessage(await response.text(), `Failed to load MCP config (${response.status})`);
    throw new Error(detail);
  }
  return response.json() as Promise<MCPConfig>;
}

export async function updateMCPConfig(config: MCPConfig): Promise<MCPConfig> {
  const response = await fetch(
    `${getBackendBaseURL()}/api/mcp/config`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(config),
    },
  );
  if (!response.ok) {
    const detail = resolveErrorMessage(await response.text(), `Failed to update MCP config (${response.status})`);
    throw new Error(detail);
  }
  return response.json() as Promise<MCPConfig>;
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

export async function getMcpDebugInfo(): Promise<MCPDebugInfo> {
  const response = await fetch(`${getBackendBaseURL()}/api/mcp/_debug`, { method: "GET" });
  if (!response.ok) {
    const detail = resolveErrorMessage(await response.text(), `Failed to load MCP debug info (${response.status})`);
    throw new Error(detail);
  }
  return response.json() as Promise<MCPDebugInfo>;
}

export async function listMcpMarketplaceServers(): Promise<MCPMarketplaceServerListItem[]> {
  const response = await fetch(`${getBackendBaseURL()}/api/mcp/marketplace/servers`, {
    method: "GET",
  });
  if (!response.ok) {
    const detail = resolveErrorMessage(await response.text(), `Failed to list MCP marketplace servers (${response.status})`);
    throw new Error(detail);
  }
  const payload = (await response.json()) as { servers?: MarketplaceMcpServerListItemPayload[] };
  return (payload.servers ?? []).map(mapMcpMarketplaceServerListItem);
}

export async function getMcpMarketplaceServerDetail(serverId: string): Promise<MCPMarketplaceServerDetail> {
  const response = await fetch(`${getBackendBaseURL()}/api/mcp/marketplace/servers/${encodeURIComponent(serverId)}`, {
    method: "GET",
  });
  if (!response.ok) {
    const detail = resolveErrorMessage(await response.text(), `Failed to get MCP marketplace server detail (${response.status})`);
    throw new Error(detail);
  }
  const payload = (await response.json()) as MarketplaceMcpServerDetailPayload;
  return mapMcpMarketplaceServerDetail(payload);
}

export async function checkMcpPrerequisites(commands: string[]): Promise<MCPPrerequisiteResponse> {
  if (commands.length === 0) {
    return { commands: {} };
  }
  const searchParams = new URLSearchParams();
  searchParams.set("commands", commands.join(","));
  const response = await fetch(`${getBackendBaseURL()}/api/mcp/prerequisites?${searchParams.toString()}`, {
    method: "GET",
  });
  if (!response.ok) {
    const detail = resolveErrorMessage(await response.text(), `Failed to check prerequisites (${response.status})`);
    throw new Error(detail);
  }
  return response.json() as Promise<MCPPrerequisiteResponse>;
}

export async function ensureNodeToolchain(): Promise<MCPToolchainEnsureResponse> {
  const response = await fetch(`${getBackendBaseURL()}/api/mcp/toolchains/node/ensure`, {
    method: "POST",
  });
  if (!response.ok) {
    const detail = resolveErrorMessage(await response.text(), `Failed to ensure Node toolchain (${response.status})`);
    throw new Error(detail);
  }
  return response.json() as Promise<MCPToolchainEnsureResponse>;
}
