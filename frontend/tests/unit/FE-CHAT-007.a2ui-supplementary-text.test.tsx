import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MessageList } from "@/components/workspace/messages/message-list";
import { I18nProvider } from "@/core/i18n/context";

vi.mock("next/navigation", () => ({
  useParams: () => ({ thread_id: "thread-a" }),
}));

describe("FE-CHAT-007 A2UI 渲染后文字说明收纳", () => {
  it("FE-CHAT-007-tuck 将紧随 A2UI 卡片后的 assistant markdown 收纳到“文字说明”折叠区", () => {
    document.cookie = "locale=zh-CN; path=/;";

    const markdown = [
      "武汉未来七天天气预报如下：",
      "",
      "- 整体气温：8°C ~ 19°C",
      "- 风力：<3级",
      "",
      "具体预报：",
    ].join("\n");

    const thread = {
      messages: [
        { id: "h1", type: "human", content: "武汉近7天天气" },
        {
          id: "t1",
          type: "tool",
          name: "send_a2ui_json_to_client",
          tool_call_id: "call-a2ui-1",
          content: "",
          additional_kwargs: {
            a2ui: {
              surface_id: "weather-demo",
              // Keep operations empty for this unit test:
              // we only verify the UI-first suppression behavior, not the renderer itself.
              operations: [],
            },
          },
        },
        { id: "a1", type: "ai", content: markdown },
      ],
      isLoading: false,
      isThreadLoading: false,
    } as unknown as Parameters<typeof MessageList>[0]["thread"];

    render(
      <I18nProvider initialLocale="zh-CN">
        <MessageList threadId="thread-a" thread={thread} />
      </I18nProvider>,
    );

    // Default UX: the supplementary text is expanded inside the A2UI card.
    expect(screen.getByRole("button", { name: "收起文字说明" })).toBeInTheDocument();

    // The markdown should NOT be duplicated as a standalone assistant message in the timeline.
    // If it were duplicated, we'd see two occurrences of the same sentence.
    expect(screen.getAllByText("武汉未来七天天气预报如下：")).toHaveLength(1);
  });
});
