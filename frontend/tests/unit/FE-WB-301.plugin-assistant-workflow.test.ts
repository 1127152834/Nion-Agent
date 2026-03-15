import { describe, expect, it } from "vitest";

import {
  computeWorkflowProgress,
  createDefaultMatchRules,
  createDefaultRuleForm,
  createDefaultWorkflowState,
  isRuleFormReadyForUpload,
  mapMatchRulesToRuleForm,
  mapRuleFormToMatchRules,
  mapMatchRulesToTargets,
  normalizeMaterialEntryPath,
} from "@/app/workspace/plugins/assistant/workflow";

describe("FE-WB-301 插件助手阶段机与规则映射", () => {
  it("FE-WB-301-按字段完整度推进阶段", () => {
    const state = createDefaultWorkflowState();
    expect(computeWorkflowProgress(state, false).activeIndex).toBe(0);

    state.goal = "构建一个前端调试插件";
    state.targetUser = "前端工程师";
    state.pluginScope = "代码编辑+预览";
    expect(computeWorkflowProgress(state, false).activeIndex).toBe(1);

    state.entryPoints = ["文件右键打开"];
    state.coreActions = ["打开文件", "保存文件"];
    state.fileMatchMode = "file";
    expect(computeWorkflowProgress(state, false).activeIndex).toBe(2);

    state.layoutTemplate = "vscode-like";
    state.visualStyle = "light";
    state.responsiveRules = "窄宽度优先编辑区";
    expect(computeWorkflowProgress(state, false).activeIndex).toBe(3);
    expect(computeWorkflowProgress(state, true).flags[3]).toBe(true);
  });

  it("FE-WB-301-简化规则映射到 manifest.targets", () => {
    const allRules = createDefaultMatchRules();
    allRules.allowAll = true;
    expect(mapMatchRulesToTargets(allRules)).toEqual([
      { kind: "file", priority: 85 },
      { kind: "directory", priority: 85 },
    ]);

    const legacyProjectRules = createDefaultMatchRules();
    legacyProjectRules.kind = "project";
    expect(mapMatchRulesToTargets(legacyProjectRules)).toEqual([
      {
        kind: "project",
        priority: 85,
      },
    ]);
  });

  it("FE-WB-301-向导规则与 match_rules 双向映射", () => {
    const form = createDefaultRuleForm();
    form.scope = "file";
    form.fileTypes = ["tsx", "vue"];
    expect(mapRuleFormToMatchRules(form)).toEqual({
      allowAll: false,
      kind: "file",
      extensions: ["tsx", "vue"],
      pathPattern: "",
      projectMarkers: [],
    });

    const legacyRules = createDefaultMatchRules();
    legacyRules.kind = "project";
    const mapped = mapMatchRulesToRuleForm(legacyRules);
    expect(mapped.scope).toBe("directory");
    expect(mapped.fileTypes).toEqual([]);
  });

  it("FE-WB-301-测试资料路径规范化与校验", () => {
    expect(normalizeMaterialEntryPath("fixtures/demo.tsx")).toBe("fixtures/demo.tsx");
    expect(normalizeMaterialEntryPath("/fixtures\\demo.tsx")).toBe("fixtures/demo.tsx");
    expect(() => normalizeMaterialEntryPath("../danger.tsx")).toThrow();
    expect(() => normalizeMaterialEntryPath("")).toThrow();
    expect(isRuleFormReadyForUpload(createDefaultRuleForm())).toBe(false);
  });
});
