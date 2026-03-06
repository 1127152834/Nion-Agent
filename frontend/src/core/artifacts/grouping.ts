import { getFileName } from "@/core/utils/files";

import type { ArtifactGroup } from "../threads";

function inferPrefix(filepath: string): string {
  const filename = getFileName(filepath);
  const [head] = filename.split(".");
  const [prefix] = (head ?? filename).split(/[-_]/);
  return (prefix ?? filename).trim().toLowerCase();
}

export function groupArtifactsByPrefix(artifacts: string[]): ArtifactGroup[] {
  const grouped = new Map<string, string[]>();

  for (const artifact of artifacts) {
    const prefix = inferPrefix(artifact);
    if (!prefix) {
      continue;
    }
    const existing = grouped.get(prefix);
    if (existing) {
      existing.push(artifact);
    } else {
      grouped.set(prefix, [artifact]);
    }
  }

  return Array.from(grouped.entries())
    .filter(([, files]) => files.length > 1)
    .map(([prefix, files]) => ({
      id: `auto-prefix:${prefix}`,
      name: prefix,
      artifacts: files,
      created_at: 0,
      description: null,
      metadata: null,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}
