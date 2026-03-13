export type ChatThreadVisibilityOverrides = {
  workspace_mode: "plugin_assistant";
  thread_visibility: "hidden";
};

export function getChatThreadVisibilityOverrides(
  mode?: string | null,
): ChatThreadVisibilityOverrides | null {
  const normalized = (mode ?? "").trim();
  if (normalized === "workbench-plugin" || normalized === "skill") {
    return {
      workspace_mode: "plugin_assistant",
      thread_visibility: "hidden",
    };
  }
  return null;
}
