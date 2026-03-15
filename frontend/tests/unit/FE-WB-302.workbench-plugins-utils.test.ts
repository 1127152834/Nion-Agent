import { detectUploadConflict, splitWorkbenchPlugins } from "@/components/workspace/settings/workbench-plugins-utils";
import type { InstalledPlugin } from "@/core/workbench";

function makeInstalledPlugin(params: {
  id: string;
  name: string;
  version?: string;
}): InstalledPlugin {
  const version = params.version ?? "0.1.0";
  return {
    manifest: {
      id: params.id,
      name: params.name,
      version,
      entry: "index.html",
      runtime: "iframe",
    },
    version,
    path: `~/.nion/workbench-plugins/${params.id}`,
    enabled: true,
    installedAt: new Date("2026-01-01T00:00:00.000Z").toISOString(),
  };
}

describe("workbench plugins utils", () => {
  test("splitWorkbenchPlugins groups by built-in ids", () => {
    const builtInIds = new Set(["frontend-workbench"]);
    const builtIn = makeInstalledPlugin({ id: "frontend-workbench", name: "Frontend Workbench" });
    const mine = makeInstalledPlugin({ id: "my-plugin", name: "My Plugin" });

    const result = splitWorkbenchPlugins([builtIn, mine], builtInIds);

    expect(result.builtInPlugins.map((p) => p.manifest.id)).toEqual(["frontend-workbench"]);
    expect(result.myPlugins.map((p) => p.manifest.id)).toEqual(["my-plugin"]);
  });

  test("detectUploadConflict prefers id match over name match", () => {
    const plugins = [
      makeInstalledPlugin({ id: "same-id", name: "Old Name" }),
      makeInstalledPlugin({ id: "other", name: "Same Name" }),
    ];

    const conflict = detectUploadConflict(plugins, { id: "same-id", name: "Same Name" });

    expect(conflict?.kind).toBe("id");
    expect(conflict?.existing.manifest.id).toBe("same-id");
  });

  test("detectUploadConflict falls back to name match", () => {
    const plugins = [makeInstalledPlugin({ id: "existing", name: "Same Name" })];
    const conflict = detectUploadConflict(plugins, { id: "new", name: "Same Name" });

    expect(conflict?.kind).toBe("name");
    expect(conflict?.existing.manifest.id).toBe("existing");
  });
});

