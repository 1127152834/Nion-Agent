import { getBackendBaseURL } from "@/core/config";

import type {
  PluginStudioAutoVerifyReport,
  PluginStudioMatchRules,
  PluginStudioPublishResult,
  PluginStudioPackageResult,
  PluginStudioSourcePackage,
  PluginStudioSession,
  PluginStudioTestMaterial,
  PluginStudioTestMaterialsResponse,
  PluginStudioWorkspaceSeedResult,
  PluginStudioWorkflowStage,
  PluginStudioWorkflowState,
  WorkbenchPackageFile,
  WorkbenchPluginManifestV2,
  WorkbenchMarketplacePluginDetail,
  WorkbenchMarketplacePluginListItem,
} from "./types";
import { normalizeSemver } from "./versioning";

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
  preview_thread_id?: string | null;
  description: string;
  state: "draft" | "generated" | "auto_verified" | "manual_verified" | "packaged";
  auto_verified: boolean;
  manual_verified: boolean;
  current_version?: string;
  release_notes?: string | null;
  source_mode?: "scratch" | "imported";
  linked_plugin_id?: string | null;
  published_at?: string | null;
  created_at: string;
  updated_at: string;
  readme_url?: string | null;
  demo_image_urls?: string[];
  package_download_url?: string | null;
  workflow_stage?: PluginStudioWorkflowStage;
  workflow_state?: {
    goal?: string;
    target_user?: string;
    plugin_scope?: string;
    entry_points?: string[];
    core_actions?: string[];
    file_match_mode?: string;
    layout_template?: string;
    visual_style?: string;
    responsive_rules?: string;
  };
  draft_version?: string | null;
  match_rules?: {
    allowAll?: boolean;
    kind?: "file" | "directory" | "project";
    extensions?: string[];
    pathPattern?: string;
    projectMarkers?: string[];
  };
  test_materials?: Array<{
    path?: string;
    kind?: "file" | "directory";
    source?: "upload" | "zip";
  }>;
  selected_test_material_path?: string | null;
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

type PluginStudioPublishPayload = {
  session: PluginStudioSessionPayload;
  plugin_id: string;
  version: string;
  filename: string;
  package_download_url: string;
  packaged_at: string;
  verify_report: PluginStudioAutoVerifyPayload;
};

type PluginStudioTestMaterialsPayload = {
  session_id: string;
  test_materials?: Array<{
    path?: string;
    kind?: "file" | "directory";
    source?: "upload" | "zip";
  }>;
  selected_test_material_path?: string | null;
};

type PluginStudioWorkspaceSeedPayload = {
  session_id: string;
  thread_id: string;
  source_root: string;
  test_materials_root?: string | null;
};

type PluginStudioSourcePackagePayload = {
  session_id: string;
  manifest: Partial<WorkbenchPluginManifestV2>;
  files?: Record<string, { encoding: "text" | "base64"; content: string }>;
};

function fileToBase64(file: File): Promise<string> {
  return file.arrayBuffer().then((buffer) => {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }
    return btoa(binary);
  });
}

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

function defaultWorkflowState(): PluginStudioWorkflowState {
  return {
    goal: "",
    targetUser: "",
    pluginScope: "",
    entryPoints: [],
    coreActions: [],
    fileMatchMode: "",
    layoutTemplate: "",
    visualStyle: "",
    responsiveRules: "",
  };
}

function defaultMatchRules(): PluginStudioMatchRules {
  return {
    allowAll: false,
    kind: "file",
    extensions: [],
    pathPattern: "",
    projectMarkers: [],
  };
}

function mapWorkbenchManifest(raw: Partial<WorkbenchPluginManifestV2>): WorkbenchPluginManifestV2 {
  return {
    ...raw,
    id: String(raw.id ?? "").trim(),
    name: String(raw.name ?? "").trim(),
    version: normalizeSemver(raw.version, "0.1.0"),
    entry: String(raw.entry ?? "").trim(),
    runtime: "iframe",
    description: typeof raw.description === "string" ? raw.description : undefined,
    targets: Array.isArray(raw.targets) ? raw.targets : undefined,
    capabilities: Array.isArray(raw.capabilities) ? raw.capabilities : undefined,
    fixtures: Array.isArray(raw.fixtures) ? raw.fixtures : undefined,
    contributions: raw.contributions,
    testSpec: raw.testSpec,
    docs: raw.docs,
    verification: raw.verification,
    provenance: raw.provenance,
    ui: raw.ui,
  };
}

function mapWorkflowState(
  payload: PluginStudioSessionPayload["workflow_state"] | undefined,
): PluginStudioWorkflowState {
  const base = defaultWorkflowState();
  if (!payload) {
    return base;
  }
  return {
    ...base,
    goal: typeof payload.goal === "string" ? payload.goal : "",
    targetUser: typeof payload.target_user === "string" ? payload.target_user : "",
    pluginScope: typeof payload.plugin_scope === "string" ? payload.plugin_scope : "",
    entryPoints: Array.isArray(payload.entry_points) ? payload.entry_points.filter((item): item is string => typeof item === "string") : [],
    coreActions: Array.isArray(payload.core_actions) ? payload.core_actions.filter((item): item is string => typeof item === "string") : [],
    fileMatchMode: typeof payload.file_match_mode === "string" ? payload.file_match_mode : "",
    layoutTemplate: typeof payload.layout_template === "string" ? payload.layout_template : "",
    visualStyle: typeof payload.visual_style === "string" ? payload.visual_style : "",
    responsiveRules: typeof payload.responsive_rules === "string" ? payload.responsive_rules : "",
  };
}

function mapMatchRules(payload: PluginStudioSessionPayload["match_rules"] | undefined): PluginStudioMatchRules {
  const base = defaultMatchRules();
  if (!payload) {
    return base;
  }
  const kind = payload.kind === "directory" || payload.kind === "project" || payload.kind === "file"
    ? payload.kind
    : "file";
  return {
    allowAll: Boolean(payload.allowAll),
    kind,
    extensions: Array.isArray(payload.extensions) ? payload.extensions.filter((item): item is string => typeof item === "string") : [],
    pathPattern: typeof payload.pathPattern === "string" ? payload.pathPattern : "",
    projectMarkers: Array.isArray(payload.projectMarkers) ? payload.projectMarkers.filter((item): item is string => typeof item === "string") : [],
  };
}

function mapTestMaterials(
  payload: PluginStudioSessionPayload["test_materials"] | PluginStudioTestMaterialsPayload["test_materials"],
): PluginStudioTestMaterial[] {
  if (!Array.isArray(payload)) {
    return [];
  }
  return payload
    .map((item) => {
      const path = typeof item?.path === "string" ? item.path : "";
      if (!path) {
        return null;
      }
      const kind = item?.kind === "directory" ? "directory" : "file";
      const source = item?.source === "zip" ? "zip" : "upload";
      return {
        path,
        kind,
        source,
      } satisfies PluginStudioTestMaterial;
    })
    .filter((item): item is PluginStudioTestMaterial => Boolean(item));
}

function mapPluginStudioSession(payload: PluginStudioSessionPayload): PluginStudioSession {
  return {
    sessionId: payload.session_id,
    pluginId: payload.plugin_id,
    pluginName: payload.plugin_name,
    chatThreadId: payload.chat_thread_id ?? null,
    previewThreadId: payload.preview_thread_id ?? null,
    description: payload.description,
    state: payload.state,
    autoVerified: payload.auto_verified,
    manualVerified: payload.manual_verified,
    currentVersion: normalizeSemver(payload.current_version, "0.1.0"),
    releaseNotes: payload.release_notes ?? undefined,
    sourceMode: payload.source_mode ?? "scratch",
    linkedPluginId: payload.linked_plugin_id ?? undefined,
    publishedAt: payload.published_at ?? undefined,
    createdAt: payload.created_at,
    updatedAt: payload.updated_at,
    readmeUrl: payload.readme_url,
    demoImageUrls: payload.demo_image_urls ?? [],
    packageDownloadUrl: payload.package_download_url,
    workflowStage: payload.workflow_stage ?? "requirements",
    workflowState: mapWorkflowState(payload.workflow_state),
    draftVersion: normalizeSemver(payload.draft_version, normalizeSemver(payload.current_version, "0.1.0")),
    matchRules: mapMatchRules(payload.match_rules),
    testMaterials: mapTestMaterials(payload.test_materials),
    selectedTestMaterialPath: payload.selected_test_material_path ?? undefined,
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

function mapPluginStudioPublishResult(payload: PluginStudioPublishPayload): PluginStudioPublishResult {
  return {
    session: mapPluginStudioSession(payload.session),
    pluginId: payload.plugin_id,
    version: normalizeSemver(payload.version, "0.1.0"),
    filename: payload.filename,
    packageDownloadUrl: payload.package_download_url,
    packagedAt: payload.packaged_at,
    verifyReport: mapPluginStudioAutoVerifyReport(payload.verify_report),
  };
}

function mapPluginStudioWorkspaceSeedResult(
  payload: PluginStudioWorkspaceSeedPayload,
): PluginStudioWorkspaceSeedResult {
  return {
    sessionId: payload.session_id,
    threadId: payload.thread_id,
    sourceRoot: payload.source_root,
    testMaterialsRoot: payload.test_materials_root ?? undefined,
  };
}

function mapPluginStudioSourcePackage(
  payload: PluginStudioSourcePackagePayload,
): PluginStudioSourcePackage {
  const files = new Map<string, WorkbenchPackageFile>();
  if (payload.files && typeof payload.files === "object") {
    for (const [path, file] of Object.entries(payload.files)) {
      if (!path || !file || (file.encoding !== "text" && file.encoding !== "base64")) {
        continue;
      }
      files.set(path, {
        encoding: file.encoding,
        content: typeof file.content === "string" ? file.content : "",
      });
    }
  }

  return {
    sessionId: payload.session_id,
    manifest: mapWorkbenchManifest(payload.manifest),
    files,
  };
}

function mapPluginStudioTestMaterialsResult(payload: PluginStudioTestMaterialsPayload): PluginStudioTestMaterialsResponse {
  return {
    sessionId: payload.session_id,
    testMaterials: mapTestMaterials(payload.test_materials),
    selectedTestMaterialPath: payload.selected_test_material_path ?? undefined,
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

export async function importPluginStudioSessionSource(
  sessionId: string,
  params: {
    file: File;
    pluginId?: string;
    pluginName?: string;
    description?: string;
    threadId?: string;
  },
): Promise<PluginStudioSession> {
  const packageBase64 = await fileToBase64(params.file);
  const response = await fetch(
    `${getBackendBaseURL()}/api/workbench/plugin-studio/sessions/${sessionId}/source/import`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        package_base64: packageBase64,
        filename: params.file.name,
        linked_plugin_id: params.pluginId,
        plugin_name: params.pluginName,
        description: params.description,
        thread_id: params.threadId,
      }),
    },
  );
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(resolveErrorMessage(detail, `Failed to import plugin source (${response.status})`));
  }
  const payload = (await response.json()) as PluginStudioSessionPayload;
  return mapPluginStudioSession(payload);
}

export async function seedPluginStudioWorkspace(
  sessionId: string,
  params: {
    threadId: string;
    includeTestMaterials?: boolean;
  },
): Promise<PluginStudioWorkspaceSeedResult> {
  const response = await fetch(
    `${getBackendBaseURL()}/api/workbench/plugin-studio/sessions/${sessionId}/workspace/seed`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        thread_id: params.threadId,
        include_test_materials: params.includeTestMaterials ?? true,
      }),
    },
  );
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(resolveErrorMessage(detail, `Failed to seed plugin workspace (${response.status})`));
  }
  const payload = (await response.json()) as PluginStudioWorkspaceSeedPayload;
  return mapPluginStudioWorkspaceSeedResult(payload);
}

export async function pullPluginStudioWorkspace(
  sessionId: string,
  params: {
    threadId: string;
  },
): Promise<PluginStudioSession> {
  const response = await fetch(
    `${getBackendBaseURL()}/api/workbench/plugin-studio/sessions/${sessionId}/workspace/pull`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        thread_id: params.threadId,
      }),
    },
  );
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(resolveErrorMessage(detail, `Failed to pull plugin workspace (${response.status})`));
  }
  const payload = (await response.json()) as PluginStudioSessionPayload;
  return mapPluginStudioSession(payload);
}

export async function getPluginStudioSourcePackage(sessionId: string): Promise<PluginStudioSourcePackage> {
  const response = await fetch(
    `${getBackendBaseURL()}/api/workbench/plugin-studio/sessions/${sessionId}/source/package`,
    {
      method: "GET",
    },
  );
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(resolveErrorMessage(detail, `Failed to load plugin source package (${response.status})`));
  }
  const payload = (await response.json()) as PluginStudioSourcePackagePayload;
  return mapPluginStudioSourcePackage(payload);
}

export async function publishPluginStudioSession(
  sessionId: string,
  params: {
    version: string;
    releaseNotes: string;
    description: string;
    conversationSnapshot?: string;
    autoDownload?: boolean;
  },
): Promise<PluginStudioPublishResult> {
  const response = await fetch(
    `${getBackendBaseURL()}/api/workbench/plugin-studio/sessions/${sessionId}/publish`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        version: params.version,
        release_notes: params.releaseNotes,
        description: params.description,
        conversation_snapshot: params.conversationSnapshot ?? "",
        auto_download: params.autoDownload ?? false,
      }),
    },
  );
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(resolveErrorMessage(detail, `Failed to publish plugin session (${response.status})`));
  }
  const payload = (await response.json()) as PluginStudioPublishPayload;
  return mapPluginStudioPublishResult(payload);
}

export async function updatePluginStudioSessionDraft(
  sessionId: string,
  params: {
    description?: string;
    draftVersion?: string;
    chatThreadId?: string;
    matchRules?: PluginStudioMatchRules;
    workflowState?: PluginStudioWorkflowState;
    workflowStage?: PluginStudioWorkflowStage;
    selectedTestMaterialPath?: string | null;
  },
): Promise<PluginStudioSession> {
  const response = await fetch(
    `${getBackendBaseURL()}/api/workbench/plugin-studio/sessions/${sessionId}/draft`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        description: params.description,
        draft_version: params.draftVersion,
        chat_thread_id: params.chatThreadId,
        match_rules: params.matchRules,
        workflow_stage: params.workflowStage,
        workflow_state: params.workflowState
          ? {
            goal: params.workflowState.goal,
            target_user: params.workflowState.targetUser,
            plugin_scope: params.workflowState.pluginScope,
            entry_points: params.workflowState.entryPoints,
            core_actions: params.workflowState.coreActions,
            file_match_mode: params.workflowState.fileMatchMode,
            layout_template: params.workflowState.layoutTemplate,
            visual_style: params.workflowState.visualStyle,
            responsive_rules: params.workflowState.responsiveRules,
          }
          : undefined,
        selected_test_material_path: params.selectedTestMaterialPath ?? undefined,
      }),
    },
  );
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(resolveErrorMessage(detail, `Failed to update plugin draft (${response.status})`));
  }
  const payload = (await response.json()) as PluginStudioSessionPayload;
  return mapPluginStudioSession(payload);
}

export async function importPluginStudioTestMaterials(
  sessionId: string,
  params: {
    threadId?: string;
    entries: Array<{
      path: string;
      contentBase64: string;
      source: "upload" | "zip";
    }>;
    selectedPath?: string;
  },
): Promise<PluginStudioTestMaterialsResponse> {
  const response = await fetch(
    `${getBackendBaseURL()}/api/workbench/plugin-studio/sessions/${sessionId}/test-materials/import`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        thread_id: params.threadId,
        entries: params.entries.map((entry) => ({
          path: entry.path,
          content_base64: entry.contentBase64,
          source: entry.source,
        })),
        selected_path: params.selectedPath,
      }),
    },
  );
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(resolveErrorMessage(detail, `Failed to import test materials (${response.status})`));
  }
  const payload = (await response.json()) as PluginStudioTestMaterialsPayload;
  return mapPluginStudioTestMaterialsResult(payload);
}

export async function listPluginStudioTestMaterials(
  sessionId: string,
): Promise<PluginStudioTestMaterialsResponse> {
  const response = await fetch(
    `${getBackendBaseURL()}/api/workbench/plugin-studio/sessions/${sessionId}/test-materials`,
    {
      method: "GET",
    },
  );
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(resolveErrorMessage(detail, `Failed to list test materials (${response.status})`));
  }
  const payload = (await response.json()) as PluginStudioTestMaterialsPayload;
  return mapPluginStudioTestMaterialsResult(payload);
}

export async function deletePluginStudioTestMaterial(
  sessionId: string,
  params: {
    threadId?: string;
    path: string;
  },
): Promise<PluginStudioTestMaterialsResponse> {
  const response = await fetch(
    `${getBackendBaseURL()}/api/workbench/plugin-studio/sessions/${sessionId}/test-materials`,
    {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        thread_id: params.threadId,
        path: params.path,
      }),
    },
  );
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(resolveErrorMessage(detail, `Failed to delete test material (${response.status})`));
  }
  const payload = (await response.json()) as PluginStudioTestMaterialsPayload;
  return mapPluginStudioTestMaterialsResult(payload);
}
