import { describe, expect, it } from "vitest";

import { getChatThreadVisibilityOverrides } from "@/components/workspace/chats/chat-mode-utils";

describe("FE-CHAT-004 chat mode visibility", () => {
  it("FE-CHAT-004-workbench-plugin mode 应隐藏普通对话列表", () => {
    expect(getChatThreadVisibilityOverrides("workbench-plugin")).toEqual({
      workspace_mode: "plugin_assistant",
      thread_visibility: "hidden",
    });
  });

  it("FE-CHAT-004-other mode 不设置隐藏", () => {
    expect(getChatThreadVisibilityOverrides(null)).toBeNull();
  });

  it("FE-CHAT-004-skill mode 应隐藏普通对话列表", () => {
    expect(getChatThreadVisibilityOverrides("skill")).toEqual({
      workspace_mode: "plugin_assistant",
      thread_visibility: "hidden",
    });
  });
});
