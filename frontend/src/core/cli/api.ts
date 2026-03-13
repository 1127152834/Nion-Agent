import { getBackendBaseURL } from "@/core/config";

import type {
  CLIConfig,
  CLIStateConfig,
  CLIDiscoveredBin,
  CLIDiscoveredTool,
  CLIDiscoverResponse,
  CLIInstallJobStartResponse,
  CLIInstallJobStatusResponse,
  CLIInstallResponse,
  CLIMarketplaceInstallKind,
  CLIMarketplaceToolDetail,
  CLIMarketplaceToolListItem,
  CLIPrerequisitesResponse,
  CLIProbeResponse,
  CLISetEnabledResponse,
  CLIToolchainEnsureResponse,
  CLIUninstallResponse,
} from "./types";

type CliConfigPayload = {
  clis?: Record<string, unknown>;
};

type MarketplaceCliToolListItemPayload = {
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
  install_kind?: string | null;
  detail_url: string;
};

type MarketplaceCliToolDetailPayload = {
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
  platforms?: unknown[];
};

type CLIDiscoverPayload = {
  tools?: Array<{
    tool_id: string;
    bins?: Array<{ name: string; path: string }>;
  }>;
  candidates?: Array<{ name: string; path: string }>;
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
    // fall through
  }
  return text;
}

function mapDiscoveredBin(payload: { name: string; path: string }): CLIDiscoveredBin {
  return {
    name: String(payload.name ?? "").trim(),
    path: String(payload.path ?? "").trim(),
  };
}

function mapDiscoveredTool(payload: { tool_id: string; bins?: Array<{ name: string; path: string }> }): CLIDiscoveredTool {
  return {
    toolId: String(payload.tool_id ?? "").trim(),
    bins: Array.isArray(payload.bins) ? payload.bins.map(mapDiscoveredBin) : [],
  };
}

async function parseJSONValue(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function parseJSONRecord(response: Response): Promise<Record<string, unknown> | null> {
  const value = await parseJSONValue(response);
  if (!value || typeof value !== "object") {
    return null;
  }
  return value as Record<string, unknown>;
}

function mapCliMarketplaceToolListItem(
  payload: MarketplaceCliToolListItemPayload,
): CLIMarketplaceToolListItem {
  const installKindRaw = typeof payload.install_kind === "string"
    ? payload.install_kind
    : null;
  const installKind: CLIMarketplaceInstallKind | null =
    installKindRaw === "http" || installKindRaw === "uv" || installKindRaw === "pipx"
      ? installKindRaw
      : null;
  return {
    id: String(payload.id ?? "").trim(),
    name: String(payload.name ?? "").trim(),
    author: payload.author,
    category: payload.category,
    description: String(payload.description ?? ""),
    tags: Array.isArray(payload.tags) ? payload.tags.filter((t): t is string => typeof t === "string") : [],
    verified: Boolean(payload.verified),
    featured: Boolean(payload.featured),
    version: typeof payload.version === "string" && payload.version.trim() ? payload.version : "0.0.0",
    docsUrl: payload.docs_url,
    installKind,
    detailUrl: String(payload.detail_url ?? ""),
  };
}

function mapCliMarketplaceToolDetail(
  payload: MarketplaceCliToolDetailPayload,
): CLIMarketplaceToolDetail {
  return {
    id: String(payload.id ?? "").trim(),
    name: String(payload.name ?? "").trim(),
    author: payload.author,
    category: payload.category,
    description: String(payload.description ?? ""),
    tags: Array.isArray(payload.tags) ? payload.tags.filter((t): t is string => typeof t === "string") : [],
    verified: Boolean(payload.verified),
    featured: Boolean(payload.featured),
    version: typeof payload.version === "string" && payload.version.trim() ? payload.version : "0.0.0",
    docsUrl: payload.docs_url,
    readmeMarkdown: typeof payload.readme_markdown === "string" ? payload.readme_markdown : "",
    platforms: Array.isArray(payload.platforms) ? payload.platforms : [],
  };
}

export async function loadCLIConfig(): Promise<CLIConfig> {
  const response = await fetch(`${getBackendBaseURL()}/api/cli/config`);
  if (!response.ok) {
    const detail = resolveErrorMessage(await response.text(), `Failed to load CLI config (${response.status})`);
    throw new Error(detail);
  }
  const payload = (await parseJSONValue(response)) as CliConfigPayload | null;
  const rawClis = payload?.clis;
  const clis = rawClis && typeof rawClis === "object" ? (rawClis as Record<string, CLIStateConfig>) : {};
  return {
    clis,
  };
}

export async function updateCLIConfig(config: CLIConfig): Promise<CLIConfig> {
  const response = await fetch(
    `${getBackendBaseURL()}/api/cli/config`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clis: config.clis ?? {} }),
    },
  );
  if (!response.ok) {
    const detail = resolveErrorMessage(await response.text(), `Failed to update CLI config (${response.status})`);
    throw new Error(detail);
  }
  return response.json() as Promise<CLIConfig>;
}

export async function listCliMarketplaceTools(): Promise<{ tools: CLIMarketplaceToolListItem[] }> {
  const response = await fetch(`${getBackendBaseURL()}/api/cli/marketplace/tools`);
  if (!response.ok) {
    const detail = resolveErrorMessage(await response.text(), `Failed to load CLI marketplace (${response.status})`);
    throw new Error(detail);
  }
  const payload = await parseJSONRecord(response);
  const rawTools = payload && "tools" in payload ? (payload as { tools?: unknown }).tools : null;
  const tools = Array.isArray(rawTools)
    ? (rawTools as MarketplaceCliToolListItemPayload[]).map(mapCliMarketplaceToolListItem)
    : [];
  return { tools };
}

export async function getCliMarketplaceToolDetail(
  toolId: string,
): Promise<CLIMarketplaceToolDetail> {
  const response = await fetch(
    `${getBackendBaseURL()}/api/cli/marketplace/tools/${encodeURIComponent(toolId)}`,
  );
  if (!response.ok) {
    const detail = resolveErrorMessage(await response.text(), `Failed to load CLI tool detail (${response.status})`);
    throw new Error(detail);
  }
  const payload = (await response.json().catch(() => null)) as MarketplaceCliToolDetailPayload | null;
  if (!payload) {
    throw new Error("Empty response");
  }
  return mapCliMarketplaceToolDetail(payload);
}

export async function installCliTool(toolId: string): Promise<CLIInstallResponse> {
  const response = await fetch(
    `${getBackendBaseURL()}/api/cli/install`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool_id: toolId }),
    },
  );
  const payload = await parseJSONRecord(response);
  if (!response.ok) {
    const detail = typeof payload?.detail === "string" ? payload.detail : undefined;
    throw new Error(detail ?? `Install failed (${response.status})`);
  }
  return {
    success: Boolean(payload?.success),
    message: typeof payload?.message === "string" ? payload.message : "",
    toolId: typeof payload?.tool_id === "string" ? payload.tool_id : toolId,
    enabled: Boolean(payload?.enabled),
    bins: Array.isArray(payload?.bins)
      ? payload.bins.filter((b: unknown): b is string => typeof b === "string")
      : [],
  };
}

export async function startCliInstallJob(toolId: string): Promise<CLIInstallJobStartResponse> {
  const response = await fetch(
    `${getBackendBaseURL()}/api/cli/install/jobs`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool_id: toolId }),
    },
  );
  const payload = await parseJSONRecord(response);
  if (!response.ok) {
    const detail = typeof payload?.detail === "string" ? payload.detail : undefined;
    throw new Error(detail ?? `Failed to start install job (${response.status})`);
  }
  return {
    success: Boolean(payload?.success),
    message: typeof payload?.message === "string" ? payload.message : "",
    jobId: typeof payload?.job_id === "string" ? payload.job_id : "",
    toolId: typeof payload?.tool_id === "string" ? payload.tool_id : toolId,
  };
}

function mapCliInstallJobStatusPayload(
  payload: Record<string, unknown> | null,
  fallbackJobId: string,
): CLIInstallJobStatusResponse {
  const statusRaw = typeof payload?.status === "string" ? payload.status : "pending";
  const status =
    statusRaw === "pending" || statusRaw === "running" || statusRaw === "succeeded" || statusRaw === "failed"
      ? statusRaw
      : "pending";

  const rawResult = payload?.result;
  let result: CLIInstallJobStatusResponse["result"] = null;
  if (rawResult && typeof rawResult === "object" && !Array.isArray(rawResult)) {
    const record = rawResult as Record<string, unknown>;
    const enabled = typeof record.enabled === "boolean" ? record.enabled : undefined;
    const bins = Array.isArray(record.bins)
      ? record.bins.filter((v: unknown): v is string => typeof v === "string")
      : undefined;
    result = {
      ...(enabled !== undefined ? { enabled } : {}),
      ...(bins ? { bins } : {}),
    };
  }

  return {
    success: Boolean(payload?.success),
    jobId: typeof payload?.job_id === "string" ? payload.job_id : fallbackJobId,
    toolId: typeof payload?.tool_id === "string" ? payload.tool_id : "",
    status,
    message: typeof payload?.message === "string" ? payload.message : "",
    lastLogLine: typeof payload?.last_log_line === "string" ? payload.last_log_line : "",
    logsTail: Array.isArray(payload?.logs_tail)
      ? payload.logs_tail.filter((v: unknown): v is string => typeof v === "string")
      : [],
    result,
  };
}

export async function getCliInstallJobStatus(jobId: string): Promise<CLIInstallJobStatusResponse> {
  const response = await fetch(
    `${getBackendBaseURL()}/api/cli/install/jobs/${encodeURIComponent(jobId)}`,
  );
  const payload = await parseJSONRecord(response);
  if (!response.ok) {
    const detail = typeof payload?.detail === "string" ? payload.detail : undefined;
    throw new Error(detail ?? `Failed to load install job (${response.status})`);
  }
  return mapCliInstallJobStatusPayload(payload, jobId);
}

export function subscribeCliInstallJobStatus(
  jobId: string,
  onSnapshot: (snapshot: CLIInstallJobStatusResponse) => void,
): () => void {
  const baseUrl = getBackendBaseURL();
  if (!baseUrl || typeof window === "undefined" || typeof EventSource === "undefined") {
    return () => undefined;
  }
  const url = `${baseUrl}/api/cli/install/jobs/${encodeURIComponent(jobId)}/events`;
  const source = new EventSource(url);

  const handler = (rawEvent: Event) => {
    let payload: Record<string, unknown> | null = null;
    try {
      const messageEvent = rawEvent as MessageEvent<string>;
      payload = JSON.parse(messageEvent.data) as Record<string, unknown>;
    } catch {
      return;
    }
    const snapshot = mapCliInstallJobStatusPayload(payload, jobId);
    onSnapshot(snapshot);
    if (snapshot.status === "succeeded" || snapshot.status === "failed") {
      source.close();
    }
  };

  source.addEventListener("snapshot", handler as EventListener);

  return () => {
    source.close();
  };
}

export async function uninstallCliTool(
  toolId: string,
  keepConfig: boolean,
): Promise<CLIUninstallResponse> {
  const response = await fetch(
    `${getBackendBaseURL()}/api/cli/uninstall`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool_id: toolId, keep_config: keepConfig }),
    },
  );
  const payload = await parseJSONRecord(response);
  if (!response.ok) {
    const detail = typeof payload?.detail === "string" ? payload.detail : undefined;
    throw new Error(detail ?? `Uninstall failed (${response.status})`);
  }
  return {
    success: Boolean(payload?.success),
    message: typeof payload?.message === "string" ? payload.message : "",
    toolId: typeof payload?.tool_id === "string" ? payload.tool_id : toolId,
  };
}

export async function probeCliTool(toolId: string): Promise<CLIProbeResponse> {
  const response = await fetch(
    `${getBackendBaseURL()}/api/cli/tools/${encodeURIComponent(toolId)}/probe`,
  );
  const payload = await parseJSONRecord(response);
  if (!response.ok) {
    const detail = typeof payload?.detail === "string" ? payload.detail : undefined;
    throw new Error(detail ?? `Probe failed (${response.status})`);
  }
  return {
    success: Boolean(payload?.success),
    message: typeof payload?.message === "string" ? payload.message : "",
    installed: Boolean(payload?.installed),
    toolId: typeof payload?.tool_id === "string" ? payload.tool_id : toolId,
    bins: Array.isArray(payload?.bins)
      ? payload.bins.filter((b: unknown): b is string => typeof b === "string")
      : [],
  };
}

export async function discoverClis(mode: "whitelist" | "full"): Promise<CLIDiscoverResponse> {
  const response = await fetch(
    `${getBackendBaseURL()}/api/cli/discover?mode=${encodeURIComponent(mode)}`,
  );
  if (!response.ok) {
    const detail = resolveErrorMessage(await response.text(), `Discover failed (${response.status})`);
    throw new Error(detail);
  }
  const payload = (await parseJSONValue(response)) as CLIDiscoverPayload | null;
  const rawTools = payload?.tools;
  const rawCandidates = payload?.candidates;
  return {
    tools: Array.isArray(rawTools) ? rawTools.map(mapDiscoveredTool) : [],
    candidates: Array.isArray(rawCandidates) ? rawCandidates.map(mapDiscoveredBin) : [],
  };
}

export async function setCliEnabled(
  toolId: string,
  enabled: boolean,
  confirmationToken?: string | null,
): Promise<CLISetEnabledResponse> {
  const response = await fetch(
    `${getBackendBaseURL()}/api/cli/tools/${encodeURIComponent(toolId)}/set-enabled`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled, confirmation_token: confirmationToken ?? null }),
    },
  );
  const payload = await parseJSONRecord(response);
  if (!response.ok) {
    const detail = typeof payload?.detail === "string" ? payload.detail : undefined;
    throw new Error(detail ?? `Failed to update enabled (${response.status})`);
  }
  return {
    success: Boolean(payload?.success),
    message: typeof payload?.message === "string" ? payload.message : "",
    toolId: typeof payload?.tool_id === "string" ? payload.tool_id : toolId,
    enabled: Boolean(payload?.enabled),
    requiresConfirmation: Boolean(payload?.requires_confirmation),
    confirmationToken: typeof payload?.confirmation_token === "string" ? payload.confirmation_token : null,
  };
}

export async function checkCliPrerequisites(commands: string[]): Promise<CLIPrerequisitesResponse> {
  const unique = Array.from(new Set(commands.map((c) => String(c ?? "").trim()).filter(Boolean)));
  const qs = unique.length > 0 ? `?commands=${encodeURIComponent(unique.join(","))}` : "";
  const response = await fetch(`${getBackendBaseURL()}/api/cli/prerequisites${qs}`);
  if (!response.ok) {
    const detail = resolveErrorMessage(await response.text(), `Prerequisites check failed (${response.status})`);
    throw new Error(detail);
  }
  return response.json() as Promise<CLIPrerequisitesResponse>;
}

export async function ensureCliUvToolchain(): Promise<CLIToolchainEnsureResponse> {
  const response = await fetch(
    `${getBackendBaseURL()}/api/cli/toolchains/uv/ensure`,
    { method: "POST" },
  );
  if (!response.ok) {
    const detail = resolveErrorMessage(await response.text(), `Failed to ensure uv toolchain (${response.status})`);
    throw new Error(detail);
  }
  return response.json() as Promise<CLIToolchainEnsureResponse>;
}

export async function ensureCliPipxToolchain(): Promise<CLIToolchainEnsureResponse> {
  const response = await fetch(
    `${getBackendBaseURL()}/api/cli/toolchains/pipx/ensure`,
    { method: "POST" },
  );
  if (!response.ok) {
    const detail = resolveErrorMessage(await response.text(), `Failed to ensure pipx toolchain (${response.status})`);
    throw new Error(detail);
  }
  return response.json() as Promise<CLIToolchainEnsureResponse>;
}
