import * as versioning from "@/core/workbench/versioning";

describe("workbench versioning", () => {
  test("resolveInstalledPluginVersion prefers marketplace version when higher", () => {
    const resolveInstalledPluginVersion = (versioning as unknown as {
      resolveInstalledPluginVersion?: (current: string, marketplace?: string | null) => string;
    }).resolveInstalledPluginVersion;

    expect(typeof resolveInstalledPluginVersion).toBe("function");
    expect(resolveInstalledPluginVersion!("0.1.0", "0.2.0")).toBe("0.2.0");
  });

  test("resolveInstalledPluginVersion keeps current when marketplace version is invalid or lower", () => {
    const resolveInstalledPluginVersion = (versioning as unknown as {
      resolveInstalledPluginVersion?: (current: string, marketplace?: string | null) => string;
    }).resolveInstalledPluginVersion;

    expect(resolveInstalledPluginVersion!("0.2.0", "0.1.0")).toBe("0.2.0");
    expect(resolveInstalledPluginVersion!("0.2.0", "v0.3.0")).toBe("0.2.0");
    expect(resolveInstalledPluginVersion!("0.2.0", null)).toBe("0.2.0");
  });
});

