import { describe, expect, it } from "vitest";

import {
  stripImplicitMentionSuffix,
  summarizeImplicitMentions,
  type ImplicitMention,
} from "@/core/messages/utils";

describe("FE-CHAT-006 隐式引用（implicit_mentions）展示清理", () => {
  const implicitMentions: ImplicitMention[] = [
    {
      kind: "context",
      value: "/mnt/user-data/workspace/foo.ts",
      mention: "@/mnt/user-data/workspace/foo.ts",
    },
    { kind: "skill", value: "connect-nion", mention: "/connect-nion" },
    { kind: "mcp", value: "context7", mention: "@context7" },
    { kind: "cli", value: "xhs-cli", mention: "#xhs-cli" },
  ];

  it("FE-CHAT-006-stripImplicitMentionSuffix 可剥离追加的 mentions 行（顺序/空白无关，包含 CLI）", () => {
    const content =
      "你好\n\n  #xhs-cli   @context7 /connect-nion   @/mnt/user-data/workspace/foo.ts  ";
    expect(stripImplicitMentionSuffix(content, implicitMentions)).toBe("你好");
  });

  it("FE-CHAT-006-stripImplicitMentionSuffix 可兼容 Windows 换行符", () => {
    const content =
      "你好\r\n\r\n#xhs-cli @context7 /connect-nion @/mnt/user-data/workspace/foo.ts";
    expect(stripImplicitMentionSuffix(content, implicitMentions)).toBe("你好");
  });

  it("FE-CHAT-006-stripImplicitMentionSuffix 在 mentions 不匹配时不应误删正文", () => {
    const content = "你好\n\n#xhs-cli @context7";
    expect(stripImplicitMentionSuffix(content, implicitMentions)).toBe(content);
  });

  it("FE-CHAT-006-stripImplicitMentionSuffix 遇到重复 token 时不应误删正文", () => {
    const content = "你好\n\n#xhs-cli #xhs-cli";
    expect(stripImplicitMentionSuffix(content, implicitMentions)).toBe(content);
  });

  it("FE-CHAT-006-summarizeImplicitMentions 计数正确", () => {
    expect(summarizeImplicitMentions(implicitMentions)).toEqual({
      context: 1,
      skill: 1,
      mcp: 1,
      cli: 1,
    });
  });
});

