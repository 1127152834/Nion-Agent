import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SidebarProvider } from "@/components/ui/sidebar";
import { RecentChatList } from "@/components/workspace/recent-chat-list";
import { I18nProvider } from "@/core/i18n/context";
import type { AgentThread } from "@/core/threads/types";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ thread_id: "thread-a" }),
  usePathname: () => "/workspace/chats/thread-a",
}));

const deleteThreadAsync = vi.fn(async () => undefined);
const renameThread = vi.fn();

vi.mock("@/core/threads/hooks", () => ({
  useThreads: () => ({
    data: [
      {
        thread_id: "thread-a",
        values: { title: "你认识我不", messages: [{ type: "human", content: "hi" }] },
      },
      {
        thread_id: "thread-b",
        values: { title: "给我一个小惊喜吧", messages: [{ type: "human", content: "hi" }] },
      },
    ] as unknown as AgentThread[],
  }),
  useDeleteThread: () => ({ mutateAsync: deleteThreadAsync }),
  useRenameThread: () => ({ mutate: renameThread }),
}));

vi.mock("@/core/navigation", () => ({
  useAppRouter: () => ({ replace: vi.fn() }),
}));

vi.mock("@/components/workspace/workspace-sidebar-routing", () => ({
  useWorkspaceSidebarNavigation: () => vi.fn(),
}));

describe("FE-CHAT-005 删除对话确认弹窗", () => {
  it("FE-CHAT-005-batch 当前对话在选中列表中时，应展示所有待删除对话而不是只展示当前对话", async () => {
    document.cookie = "locale=zh-CN; path=/;";

    render(
      <I18nProvider initialLocale="zh-CN">
        <SidebarProvider>
          <RecentChatList />
        </SidebarProvider>
      </I18nProvider>,
    );

    fireEvent.click(screen.getByLabelText("管理对话"));
    fireEvent.click(screen.getByText("你认识我不"));
    fireEvent.click(screen.getByText("给我一个小惊喜吧"));
    fireEvent.click(screen.getByRole("button", { name: "删除选中" }));

    const batchDialog = screen.getByRole("dialog", { name: "删除选中的对话" });
    fireEvent.click(within(batchDialog).getByRole("button", { name: "删除选中" }));

    const currentDeleteDialog = screen.getByRole("dialog", { name: "删除当前对话" });
    // current-thread delete dialog should list all selected threads (at least these two titles)
    expect(within(currentDeleteDialog).getByText("你认识我不")).toBeInTheDocument();
    expect(within(currentDeleteDialog).getByText("给我一个小惊喜吧")).toBeInTheDocument();
  });
});
