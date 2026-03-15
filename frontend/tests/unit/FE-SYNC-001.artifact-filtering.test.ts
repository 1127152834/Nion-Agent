import { describe, expect, it } from "vitest";

import { filterAndSortArtifacts, getArtifactFilterType } from "@/core/artifacts/filtering";

describe("FE-SYNC-001 产物筛选与排序", () => {
  it("FE-SYNC-001-根据后缀分类", () => {
    expect(getArtifactFilterType("outputs/report.pdf")).toBe("document");
    expect(getArtifactFilterType("outputs/chart.png")).toBe("image");
    expect(getArtifactFilterType("outputs/app.ts")).toBe("code");
    expect(getArtifactFilterType("outputs/demo.skill")).toBe("skill");
  });

  it("FE-SYNC-001-过滤并按文件名排序", () => {
    const files = [
      "outputs/zeta.md",
      "outputs/alpha.md",
      "outputs/image.png",
      "outputs/main.ts",
    ];

    const filtered = filterAndSortArtifacts(files, {
      query: "out",
      filterType: "document",
      sortMode: "name-asc",
    });

    expect(filtered).toEqual(["outputs/alpha.md", "outputs/zeta.md"]);
  });
});
