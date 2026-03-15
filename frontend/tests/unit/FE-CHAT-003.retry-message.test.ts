import { describe, expect, it } from "vitest";

import { findLastRetryableUserMessage } from "@/core/messages/retry";

describe("FE-CHAT-003 重试消息选择规则", () => {
  it("FE-CHAT-003-返回最后一条 human 文本消息", () => {
    const messages = [
      { type: "human", content: "早期问题" },
      { type: "ai", content: "回答" },
      { type: "human", content: "  最新问题  " },
    ];

    expect(
      findLastRetryableUserMessage(
        messages as unknown as Parameters<typeof findLastRetryableUserMessage>[0],
      ),
    ).toBe("最新问题");
  });

  it("FE-CHAT-003-支持块结构内容并忽略非 human 消息", () => {
    const messages = [
      { type: "tool", content: "tool output" },
      {
        type: "human",
        content: [
          { type: "image_url", image_url: { url: "https://example.com/a.png" } },
          { type: "text", text: "来自块结构的提问" },
        ],
      },
      { type: "ai", content: "answer" },
    ];

    expect(
      findLastRetryableUserMessage(
        messages as unknown as Parameters<typeof findLastRetryableUserMessage>[0],
      ),
    ).toBe("来自块结构的提问");
  });
});
