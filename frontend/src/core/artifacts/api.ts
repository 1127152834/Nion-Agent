import { getBackendBaseURL } from "@/core/config";
import type { ArtifactGroup } from "@/core/threads";

interface ArtifactGroupsResponse {
  groups: ArtifactGroup[];
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
