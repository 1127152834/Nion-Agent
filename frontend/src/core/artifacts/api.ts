import { getBackendBaseURL } from "@/core/config";
import type { ArtifactGroup } from "@/core/threads";

interface ArtifactGroupsResponse {
  groups: ArtifactGroup[];
}

export interface WorkspaceDirectoryEntry {
  path: string;
  name: string;
  depth: number;
  child_count: number;
  mtime: number | null;
}

export interface WorkspaceFileEntry {
  path: string;
  name: string;
  depth: number;
  size: number;
  mtime: number | null;
}

export interface WorkspaceTreeResponse {
  root: string;
  generated_at: string;
  depth: number;
  truncated: boolean;
  directories: WorkspaceDirectoryEntry[];
  files: WorkspaceFileEntry[];
}

export interface WorkspaceMetaResponse {
  thread_id: string;
  root: string;
  actual_root: string;
  execution_mode: "sandbox" | "host" | string;
  host_workdir: string | null;
  generated_at: string;
}

const artifactGroupsBaseURL = (threadId: string) =>
  `${getBackendBaseURL()}/api/threads/${threadId}/artifact-groups`;

export async function loadArtifactGroups(threadId: string): Promise<ArtifactGroup[]> {
  const response = await fetch(artifactGroupsBaseURL(threadId));
  if (response.status === 404) {
    return [];
  }
  if (!response.ok) {
    throw new Error(`Failed to load artifact groups (${response.status})`);
  }
  const payload = (await response.json()) as ArtifactGroupsResponse;
  return payload.groups ?? [];
}

export async function replaceArtifactGroups(
  threadId: string,
  groups: ArtifactGroup[],
): Promise<ArtifactGroup[]> {
  const response = await fetch(artifactGroupsBaseURL(threadId), {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ groups }),
  });
  if (!response.ok) {
    throw new Error(`Failed to save artifact groups (${response.status})`);
  }
  const payload = (await response.json()) as ArtifactGroupsResponse;
  return payload.groups ?? groups;
}

export function artifactGroupDownloadURL(threadId: string, groupId: string): string {
  return `${artifactGroupsBaseURL(threadId)}/${groupId}/download`;
}

export async function loadWorkspaceMeta(
  threadId: string,
  opts?: {
    root?: string;
  },
): Promise<WorkspaceMetaResponse> {
  const params = new URLSearchParams();
  if (opts?.root) {
    params.set("root", opts.root);
  }

  const response = await fetch(
    `${getBackendBaseURL()}/api/threads/${threadId}/workspace/meta${
      params.size > 0 ? `?${params.toString()}` : ""
    }`,
  );

  if (!response.ok) {
    throw new Error(`Failed to load workspace meta (${response.status})`);
  }

  return (await response.json()) as WorkspaceMetaResponse;
}

export async function loadWorkspaceTree(
  threadId: string,
  opts?: {
    root?: string;
    depth?: number;
    includeHidden?: boolean;
    maxNodes?: number;
  },
): Promise<WorkspaceTreeResponse> {
  const params = new URLSearchParams();
  if (opts?.root) {
    params.set("root", opts.root);
  }
  if (typeof opts?.depth === "number") {
    params.set("depth", String(opts.depth));
  }
  if (typeof opts?.includeHidden === "boolean") {
    params.set("include_hidden", String(opts.includeHidden));
  }
  if (typeof opts?.maxNodes === "number") {
    params.set("max_nodes", String(opts.maxNodes));
  }

  const response = await fetch(
    `${getBackendBaseURL()}/api/threads/${threadId}/workspace/tree${
      params.size > 0 ? `?${params.toString()}` : ""
    }`,
  );

  if (!response.ok) {
    throw new Error(`Failed to load workspace tree (${response.status})`);
  }

  return (await response.json()) as WorkspaceTreeResponse;
}
