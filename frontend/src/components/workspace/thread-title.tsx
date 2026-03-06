import type { BaseStream } from "@langchain/langgraph-sdk";
import { useEffect } from "react";

import { useI18n } from "@/core/i18n/hooks";
import type { AgentThreadState } from "@/core/threads";

import { useThreadChat } from "./chats";
import { FlipDisplay } from "./flip-display";

export function ThreadTitle({
  threadId,
  thread,
}: {
  className?: string;
  threadId: string;
  thread: BaseStream<AgentThreadState>;
}) {
  const { t } = useI18n();
  const { isNewThread } = useThreadChat();
  const untitled = t.workspace.threadTitle.untitled;
  const loading = t.workspace.threadTitle.loading;

  useEffect(() => {
    const pageTitle = isNewThread
      ? t.pages.newChat
      : thread.values?.title && thread.values.title !== "Untitled" && thread.values.title !== untitled
        ? thread.values.title
        : untitled;
    if (thread.isThreadLoading) {
      document.title = `${loading} - ${t.pages.appName}`;
    } else {
      document.title = `${pageTitle} - ${t.pages.appName}`;
    }
  }, [
    isNewThread,
    loading,
    t.pages.appName,
    t.pages.newChat,
    thread.isThreadLoading,
    thread.values,
    untitled,
  ]);

  if (!thread.values?.title) {
    return null;
  }
  return (
    <FlipDisplay uniqueKey={threadId}>
      {thread.values.title ?? untitled}
    </FlipDisplay>
  );
}
