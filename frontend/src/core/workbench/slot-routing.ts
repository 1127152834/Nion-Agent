import type { ReadonlyURLSearchParams } from "next/navigation";

export type WorkbenchSlotTargetKind = "file" | "directory" | "project";

export type WorkbenchSlotRouteState = {
  pluginId: string;
  artifactPath: string;
  targetKind: WorkbenchSlotTargetKind;
  nonce?: string;
};

export const WORKBENCH_SLOT_QUERY_KEYS = {
  panel: "wb_panel",
  pluginId: "wb_plugin",
  artifactPath: "wb_path",
  targetKind: "wb_kind",
  nonce: "wb_nonce",
} as const;

const VALID_TARGET_KINDS = new Set<WorkbenchSlotTargetKind>([
  "file",
  "directory",
  "project",
]);
const VALID_PANEL_VALUES = new Set(["console", "plugin"]);

function normalizeTargetKind(raw: string | null | undefined): WorkbenchSlotTargetKind {
  if (!raw) {
    return "file";
  }
  if (VALID_TARGET_KINDS.has(raw as WorkbenchSlotTargetKind)) {
    return raw as WorkbenchSlotTargetKind;
  }
  return "file";
}

export function parseWorkbenchSlotRouteState(
  searchParams: URLSearchParams | ReadonlyURLSearchParams,
): WorkbenchSlotRouteState | null {
  const panel = (searchParams.get(WORKBENCH_SLOT_QUERY_KEYS.panel) ?? "").trim();
  if (!VALID_PANEL_VALUES.has(panel)) {
    return null;
  }

  const pluginId = (searchParams.get(WORKBENCH_SLOT_QUERY_KEYS.pluginId) ?? "").trim();
  const artifactPath = (searchParams.get(WORKBENCH_SLOT_QUERY_KEYS.artifactPath) ?? "").trim();
  if (!pluginId || !artifactPath) {
    return null;
  }

  const targetKind = normalizeTargetKind(searchParams.get(WORKBENCH_SLOT_QUERY_KEYS.targetKind));
  const nonce = searchParams.get(WORKBENCH_SLOT_QUERY_KEYS.nonce) ?? undefined;

  return {
    pluginId,
    artifactPath,
    targetKind,
    nonce,
  };
}

export function buildWorkbenchSlotRouteURL(params: {
  pathname: string;
  pluginId: string;
  artifactPath: string;
  targetKind?: WorkbenchSlotTargetKind;
  searchParams?: URLSearchParams | ReadonlyURLSearchParams;
  withNonce?: boolean;
}): string {
  const next = new URLSearchParams(params.searchParams?.toString() ?? "");
  next.set(WORKBENCH_SLOT_QUERY_KEYS.panel, "console");
  next.set(WORKBENCH_SLOT_QUERY_KEYS.pluginId, params.pluginId);
  next.set(WORKBENCH_SLOT_QUERY_KEYS.artifactPath, params.artifactPath);
  next.set(WORKBENCH_SLOT_QUERY_KEYS.targetKind, params.targetKind ?? "file");
  if (params.withNonce ?? true) {
    next.set(WORKBENCH_SLOT_QUERY_KEYS.nonce, String(Date.now()));
  }
  const query = next.toString();
  return query ? `${params.pathname}?${query}` : params.pathname;
}
