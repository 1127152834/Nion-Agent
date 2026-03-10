import { getBackendBaseURL } from "@/core/config";

import type {
  PluginStudioAutoVerifyReport,
  PluginStudioPackageResult,
  PluginStudioSession,
  WorkbenchMarketplacePluginDetail,
  WorkbenchMarketplacePluginListItem,
} from "./types";

type MarketplacePluginListPayload = {
  id: string;
  name: string;
  description: string;
  version: string;
  maintainer?: string | null;
  tags?: string[];
  updated_at?: string | null;
  download_url: string;
  detail_url: string;
  docs_summary?: string | null;
};

type MarketplacePluginDetailPayload = {
  id: string;
  name: string;
  description: string;
  version: string;
  maintainer?: string | null;
  tags?: string[];
  updated_at?: string | null;
  download_url: string;
  readme_markdown: string;
  demo_image_urls?: string[];
};

type PluginStudioSessionPayload = {
  session_id: string;
  plugin_id: string;
  plugin_name: string;
  chat_thread_id?: string | null;
  description: string;
  state: "draft" | "generated" | "auto_verified" | "manual_verified" | "packaged";
  auto_verified: boolean;
  manual_verified: boolean;
  created_at: string;
  updated_at: string;
  readme_url?: string | null;
  demo_image_urls?: string[];
  package_download_url?: string | null;
};

type PluginStudioAutoVerifyPayload = {
  session_id: string;
  passed: boolean;
  executed_at: string;
  summary: string;
  steps: Array<{
    id: string;
    passed: boolean;
    message: string;
  }>;
};

type PluginStudioPackagePayload = {
  session_id: string;
  plugin_id: string;
  filename: string;
  package_download_url: string;
  packaged_at: string;
};

function mapMarketplacePluginListItem(
  payload: MarketplacePluginListPayload,
): WorkbenchMarketplacePluginListItem {
  return {
    id: payload.id,
    name: payload.name,
    description: payload.description,
    version: payload.version,
    maintainer: payload.maintainer,
    tags: payload.tags ?? [],
    updatedAt: payload.updated_at,
    downloadUrl: payload.download_url,
    detailUrl: payload.detail_url,
    docsSummary: payload.docs_summary,
  };
}

function mapMarketplacePluginDetail(
  payload: MarketplacePluginDetailPayload,
): WorkbenchMarketplacePluginDetail {
  return {
    id: payload.id,
    name: payload.name,
    description: payload.description,
    version: payload.version,
    maintainer: payload.maintainer,
    tags: payload.tags ?? [],
    updatedAt: payload.updated_at,
    downloadUrl: payload.download_url,
    readmeMarkdown: payload.readme_markdown,
    demoImageUrls: payload.demo_image_urls ?? [],
  };
}

function mapPluginStudioSession(payload: PluginStudioSessionPayload): PluginStudioSession {
  return {
    sessionId: payload.session_id,
    pluginId: payload.plugin_id,
    pluginName: payload.plugin_name,
    chatThreadId: payload.chat_thread_id ?? null,
    description: payload.description,
    state: payload.state,
    autoVerified: payload.auto_verified,
    manualVerified: payload.manual_verified,
    createdAt: payload.created_at,
    updatedAt: payload.updated_at,
    readmeUrl: payload.readme_url,
    demoImageUrls: payload.demo_image_urls ?? [],
    packageDownloadUrl: payload.package_download_url,
  };
}

function mapPluginStudioAutoVerifyReport(
  payload: PluginStudioAutoVerifyPayload,
): PluginStudioAutoVerifyReport {
  return {
    sessionId: payload.session_id,
    passed: payload.passed,
    executedAt: payload.executed_at,
    summary: payload.summary,
    steps: payload.steps,
  };
}

function mapPluginStudioPackageResult(payload: PluginStudioPackagePayload): PluginStudioPackageResult {
  return {
    sessionId: payload.session_id,
    pluginId: payload.plugin_id,
    filename: payload.filename,
    packageDownloadUrl: payload.package_download_url,
    packagedAt: payload.packaged_at,
  };
}

export async function listWorkbenchMarketplacePlugins(): Promise<WorkbenchMarketplacePluginListItem[]> {
  const response = await fetch(`${getBackendBaseURL()}/api/workbench/marketplace/plugins`, {
    method: "GET",
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Failed to list marketplace plugins (${response.status})`);
  }
  const payload = (await response.json()) as { plugins?: MarketplacePluginListPayload[] };
  return (payload.plugins ?? []).map(mapMarketplacePluginListItem);
}

export async function getWorkbenchMarketplacePluginDetail(
  pluginId: string,
): Promise<WorkbenchMarketplacePluginDetail> {
  const response = await fetch(`${getBackendBaseURL()}/api/workbench/marketplace/plugins/${pluginId}`, {
    method: "GET",
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Failed to get marketplace plugin detail (${response.status})`);
  }
  const payload = (await response.json()) as MarketplacePluginDetailPayload;
  return mapMarketplacePluginDetail(payload);
}

export async function downloadWorkbenchMarketplacePluginPackage(pluginId: string): Promise<File> {
  const response = await fetch(`${getBackendBaseURL()}/api/workbench/marketplace/plugins/${pluginId}/download`, {
    method: "GET",
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Failed to download marketplace plugin package (${response.status})`);
  }
  const blob = await response.blob();
  return new File([blob], `${pluginId}.nwp`, {
    type: blob.type || "application/zip",
  });
}

export async function createPluginStudioSession(params: {
  pluginName: string;
  pluginId?: string;
  description?: string;
  chatThreadId?: string;
}): Promise<PluginStudioSession> {
  const response = await fetch(`${getBackendBaseURL()}/api/workbench/plugin-studio/sessions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      plugin_name: params.pluginName,
      plugin_id: params.pluginId,
      description: params.description ?? "",
      chat_thread_id: params.chatThreadId,
    }),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Failed to create plugin studio session (${response.status})`);
  }
  const payload = (await response.json()) as PluginStudioSessionPayload;
  return mapPluginStudioSession(payload);
}

export async function getPluginStudioSession(sessionId: string): Promise<PluginStudioSession> {
  const response = await fetch(`${getBackendBaseURL()}/api/workbench/plugin-studio/sessions/${sessionId}`, {
    method: "GET",
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Failed to get plugin studio session (${response.status})`);
  }
  const payload = (await response.json()) as PluginStudioSessionPayload;
  return mapPluginStudioSession(payload);
}

export async function generatePluginStudioSession(
  sessionId: string,
  params?: { description?: string },
): Promise<PluginStudioSession> {
  const response = await fetch(`${getBackendBaseURL()}/api/workbench/plugin-studio/sessions/${sessionId}/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      description: params?.description,
    }),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Failed to generate plugin studio session (${response.status})`);
  }
  const payload = (await response.json()) as PluginStudioSessionPayload;
  return mapPluginStudioSession(payload);
}

export async function autoVerifyPluginStudioSession(sessionId: string): Promise<PluginStudioAutoVerifyReport> {
  const response = await fetch(`${getBackendBaseURL()}/api/workbench/plugin-studio/sessions/${sessionId}/verify/auto`, {
    method: "POST",
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Failed to auto verify plugin studio session (${response.status})`);
  }
  const payload = (await response.json()) as PluginStudioAutoVerifyPayload;
  return mapPluginStudioAutoVerifyReport(payload);
}

export async function manualVerifyPluginStudioSession(
  sessionId: string,
  params: { passed: boolean; note?: string },
): Promise<PluginStudioSession> {
  const response = await fetch(`${getBackendBaseURL()}/api/workbench/plugin-studio/sessions/${sessionId}/verify/manual`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      passed: params.passed,
      note: params.note,
    }),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Failed to set plugin studio manual verification (${response.status})`);
  }
  const payload = (await response.json()) as PluginStudioSessionPayload;
  return mapPluginStudioSession(payload);
}

export async function packagePluginStudioSession(sessionId: string): Promise<PluginStudioPackageResult> {
  const response = await fetch(`${getBackendBaseURL()}/api/workbench/plugin-studio/sessions/${sessionId}/package`, {
    method: "POST",
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Failed to package plugin studio session (${response.status})`);
  }
  const payload = (await response.json()) as PluginStudioPackagePayload;
  return mapPluginStudioPackageResult(payload);
}

export async function downloadPluginStudioPackage(sessionId: string, pluginId: string): Promise<File> {
  const response = await fetch(
    `${getBackendBaseURL()}/api/workbench/plugin-studio/sessions/${sessionId}/package/download`,
    {
      method: "GET",
    },
  );
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Failed to download plugin studio package (${response.status})`);
  }
  const blob = await response.blob();
  return new File([blob], `${pluginId}.nwp`, {
    type: blob.type || "application/zip",
  });
}
