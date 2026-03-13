import type {
  PluginStudioMatchRules,
  PluginStudioWorkflowState,
  WorkbenchTargetRule,
} from "@/core/workbench";

export const PLUGIN_ASSISTANT_PROGRESS_STEPS = [
  "requirements",
  "interaction",
  "ui_design",
  "generate",
] as const;

export type PluginAssistantProgressStep = (typeof PLUGIN_ASSISTANT_PROGRESS_STEPS)[number];

export type PluginAssistantMatchScope = "all_files" | "file" | "directory";

export interface PluginAssistantRuleForm {
  scope: PluginAssistantMatchScope;
  fileTypes: string[];
}

export function createDefaultWorkflowState(): PluginStudioWorkflowState {
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

export function createDefaultMatchRules(): PluginStudioMatchRules {
  return {
    allowAll: false,
    kind: "file",
    extensions: [],
    pathPattern: "",
    projectMarkers: [],
  };
}

export function createDefaultRuleForm(): PluginAssistantRuleForm {
  return {
    scope: "file",
    fileTypes: [],
  };
}

function normalizeText(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function normalizeStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeText(item))
      .filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

export function normalizeWorkflowState(
  value: Partial<PluginStudioWorkflowState> | null | undefined,
): PluginStudioWorkflowState {
  const base = createDefaultWorkflowState();
  if (!value) {
    return base;
  }
  return {
    ...base,
    goal: normalizeText(value.goal),
    targetUser: normalizeText(value.targetUser),
    pluginScope: normalizeText(value.pluginScope),
    entryPoints: normalizeStringList(value.entryPoints),
    coreActions: normalizeStringList(value.coreActions),
    fileMatchMode: normalizeText(value.fileMatchMode),
    layoutTemplate: normalizeText(value.layoutTemplate),
    visualStyle: normalizeText(value.visualStyle),
    responsiveRules: normalizeText(value.responsiveRules),
  };
}

export function normalizeMatchRules(
  value: Partial<PluginStudioMatchRules> | null | undefined,
): PluginStudioMatchRules {
  const base = createDefaultMatchRules();
  if (!value) {
    return base;
  }
  const kind = value.kind === "directory" || value.kind === "project" || value.kind === "file"
    ? value.kind
    : "file";
  return {
    allowAll: Boolean(value.allowAll),
    kind,
    extensions: normalizeStringList(value.extensions)
      .map((item) => item.replace(/^\./, "").toLowerCase())
      .filter(Boolean),
    pathPattern: normalizeText(value.pathPattern),
    projectMarkers: normalizeStringList(value.projectMarkers),
  };
}

export function normalizeRuleForm(
  value: Partial<PluginAssistantRuleForm> | null | undefined,
): PluginAssistantRuleForm {
  const base = createDefaultRuleForm();
  if (!value) {
    return base;
  }
  const scope = value.scope === "all_files" || value.scope === "directory" || value.scope === "file"
    ? value.scope
    : "file";
  return {
    scope,
    fileTypes: normalizeStringList(value.fileTypes)
      .map((item) => item.replace(/^\./, "").toLowerCase())
      .filter(Boolean),
  };
}

export function mapMatchRulesToRuleForm(
  rules: PluginStudioMatchRules | null | undefined,
): PluginAssistantRuleForm {
  const normalized = normalizeMatchRules(rules);
  if (normalized.allowAll) {
    return {
      scope: "all_files",
      fileTypes: [],
    };
  }

  if (normalized.kind === "directory" || normalized.kind === "project") {
    return {
      scope: "directory",
      fileTypes: [],
    };
  }

  return {
    scope: "file",
    fileTypes: normalized.extensions,
  };
}

export function mapRuleFormToMatchRules(
  form: PluginAssistantRuleForm,
): PluginStudioMatchRules {
  const normalized = normalizeRuleForm(form);
  if (normalized.scope === "all_files") {
    return {
      allowAll: true,
      kind: "file",
      extensions: [],
      pathPattern: "",
      projectMarkers: [],
    };
  }

  if (normalized.scope === "directory") {
    return {
      allowAll: false,
      kind: "directory",
      extensions: [],
      pathPattern: "",
      projectMarkers: [],
    };
  }

  return {
    allowAll: false,
    kind: "file",
    extensions: normalized.fileTypes,
    pathPattern: "",
    projectMarkers: [],
  };
}

export function isMatchRulesConfigured(rules: PluginStudioMatchRules): boolean {
  if (rules.allowAll) {
    return true;
  }
  return Boolean(
    rules.extensions.length
    || rules.pathPattern
    || rules.projectMarkers.length,
  );
}

export function isRuleFormReadyForUpload(form: PluginAssistantRuleForm): boolean {
  const normalized = normalizeRuleForm(form);
  if (normalized.scope === "all_files") {
    return true;
  }
  if (normalized.scope === "file") {
    return normalized.fileTypes.length > 0;
  }
  return true;
}

export function deriveFileMatchMode(rules: PluginStudioMatchRules): string {
  if (rules.allowAll) {
    return "all_files";
  }
  if (rules.kind === "project") {
    return "directory";
  }
  return rules.kind;
}

export function mapMatchRulesToTargets(rules: PluginStudioMatchRules): WorkbenchTargetRule[] {
  if (rules.allowAll) {
    return [{ kind: "file", priority: 85 }, { kind: "directory", priority: 85 }];
  }
  const target: WorkbenchTargetRule = {
    kind: rules.kind,
    priority: 85,
  };
  if (rules.extensions.length > 0) {
    target.extensions = rules.extensions;
  }
  if (rules.pathPattern) {
    target.pathPattern = rules.pathPattern;
  }
  if (rules.projectMarkers.length > 0 && rules.kind === "project") {
    target.projectMarkers = rules.projectMarkers;
  }
  if (rules.kind === "file" && !target.extensions && !target.pathPattern && !target.projectMarkers) {
    return [{ kind: "file", priority: 85 }];
  }
  if (rules.kind === "directory" && !target.pathPattern) {
    return [{ kind: "directory", priority: 85 }];
  }
  return [target];
}

export function computeWorkflowProgress(
  workflowState: PluginStudioWorkflowState,
  packaged: boolean,
) {
  const requirementDone = Boolean(
    workflowState.goal
    && workflowState.targetUser
    && workflowState.pluginScope,
  );
  const interactionDone = Boolean(
    workflowState.entryPoints.length >= 1
    && workflowState.coreActions.length >= 2
    && workflowState.fileMatchMode,
  );
  const uiDone = Boolean(
    workflowState.layoutTemplate
    && workflowState.visualStyle
    && workflowState.responsiveRules,
  );
  const generateDone = packaged;
  const flags = [requirementDone, interactionDone, uiDone, generateDone] as const;
  const firstPending = flags.findIndex((item) => !item);
  const activeIndex = firstPending === -1 ? flags.length - 1 : firstPending;
  return {
    flags,
    activeIndex,
  };
}

export function normalizeMaterialEntryPath(value: string): string {
  const replaced = value.replace(/\\/g, "/").trim().replace(/^\/+/, "");
  const parts = replaced.split("/").filter((item) => item && item !== ".");
  if (parts.length === 0 || parts.some((item) => item === "..")) {
    throw new Error(`Invalid material path: ${value}`);
  }
  return parts.join("/");
}
