"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  WorkspaceBody,
  WorkspaceContainer,
  WorkspaceHeader,
} from "@/components/workspace/workspace-container";
import { useI18n } from "@/core/i18n/hooks";
import { useThreads } from "@/core/threads/hooks";
import {
  isHiddenWorkspaceThread,
  isThreadAwaitingResponse,
  pathOfThread,
  titleOfThread,
} from "@/core/threads/utils";
import { formatTimeAgo } from "@/core/utils/datetime";

export default function ChatsPage() {
  const { t } = useI18n();
  const { data: threads } = useThreads();
  const [search, setSearch] = useState("");

  useEffect(() => {
    document.title = `${t.pages.chats} - ${t.pages.appName}`;
  }, [t.pages.chats, t.pages.appName]);

  const filteredThreads = useMemo(() => {
    return threads?.filter((thread) => {
      if (isHiddenWorkspaceThread(thread)) {
        return false;
      }
      return titleOfThread(thread).toLowerCase().includes(search.toLowerCase());
    });
  }, [search, threads]);
  return (
    <WorkspaceContainer>
      <WorkspaceHeader></WorkspaceHeader>
      <WorkspaceBody>
        <div className="flex size-full flex-col">
          <header className="flex shrink-0 items-center justify-center pt-8">
            <Input
              type="search"
              className="h-12 w-full max-w-(--container-width-md) text-xl"
              placeholder={t.chats.searchChats}
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </header>
          <main className="min-h-0 flex-1">
            <ScrollArea className="size-full py-4">
              <div className="mx-auto flex size-full max-w-(--container-width-md) flex-col">
                {filteredThreads?.map((thread) => (
                  <Link
                    key={thread.thread_id}
                    href={pathOfThread(thread.thread_id)}
                  >
                    <div className="flex flex-col gap-2 border-b p-4">
                      <div>
                        <div className="inline-flex items-center gap-2">
                          <span>{titleOfThread(thread)}</span>
                          {isThreadAwaitingResponse(thread) ? (
                            <Badge
                              variant="secondary"
                              className="border-emerald-200 bg-emerald-100 text-[10px] text-emerald-700"
                            >
                              {t.chats.awaitingResponse}
                            </Badge>
                          ) : null}
                        </div>
                      </div>
                      {thread.updated_at && (
                        <div className="text-muted-foreground text-sm">
                          {formatTimeAgo(thread.updated_at)}
                        </div>
                      )}
                    </div>
                  </Link>
                ))}
              </div>
            </ScrollArea>
          </main>
        </div>
      </WorkspaceBody>
    </WorkspaceContainer>
  );
}
