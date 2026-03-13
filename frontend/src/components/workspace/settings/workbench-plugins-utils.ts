"use client";

import type { InstalledPlugin } from "@/core/workbench";

export type UploadConflict =
  | { kind: "id"; existing: InstalledPlugin }
  | { kind: "name"; existing: InstalledPlugin };

function normalizePluginName(value: string): string {
  return value.trim().toLowerCase();
}

export function splitWorkbenchPlugins(
  plugins: InstalledPlugin[],
  builtInIds: ReadonlySet<string>,
): {
  myPlugins: InstalledPlugin[];
  builtInPlugins: InstalledPlugin[];
} {
  const myPlugins: InstalledPlugin[] = [];
  const builtInPlugins: InstalledPlugin[] = [];

  for (const plugin of plugins) {
    if (builtInIds.has(plugin.manifest.id)) {
      builtInPlugins.push(plugin);
      continue;
    }
    myPlugins.push(plugin);
  }

  return { myPlugins, builtInPlugins };
}

export function detectUploadConflict(
  plugins: InstalledPlugin[],
  candidate: { id: string; name: string },
): UploadConflict | null {
  const normalizedId = candidate.id.trim();
  const normalizedName = normalizePluginName(candidate.name);

  if (normalizedId) {
    const byId = plugins.find((plugin) => plugin.manifest.id === normalizedId);
    if (byId) {
      return { kind: "id", existing: byId };
    }
  }

  if (normalizedName) {
    const byName = plugins.find((plugin) => normalizePluginName(plugin.manifest.name) === normalizedName);
    if (byName) {
      return { kind: "name", existing: byName };
    }
  }

  return null;
}
