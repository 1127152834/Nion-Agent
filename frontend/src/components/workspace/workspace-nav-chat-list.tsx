"use client";

import { BotIcon, Clock3Icon, Loader2, MessagesSquare, NewspaperIcon } from "lucide-react";
import Link from "next/link";

import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { useI18n } from "@/core/i18n/hooks";
import { pathOfChatsIndex } from "@/core/threads/utils";
import { cn } from "@/lib/utils";

import {
  useWorkspaceChatsNavActive,
  useWorkspaceSidebarLink,
  useWorkspaceSidebarSection,
} from "./workspace-sidebar-routing";

export function WorkspaceNavChatList() {
  const { t } = useI18n();
  const chatsNavActive = useWorkspaceChatsNavActive();
  const section = useWorkspaceSidebarSection();
  const chatsLink = useWorkspaceSidebarLink(pathOfChatsIndex());
  const agentsLink = useWorkspaceSidebarLink("/workspace/agents", { match: "prefix" });
  const rssLink = useWorkspaceSidebarLink("/workspace/rss", { match: "prefix" });
  const schedulerLink = useWorkspaceSidebarLink("/workspace/scheduler", { match: "prefix" });

  return (
    <SidebarGroup className="py-0">
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            isActive={chatsNavActive || chatsLink.isNavigating}
            tooltip={t.sidebar.chats}
            asChild
          >
            <Link
              className={cn(
                "text-muted-foreground",
                chatsLink.isNavigating && "cursor-progress",
              )}
              {...chatsLink.linkProps}
            >
              {chatsLink.isNavigating ? <Loader2 className="animate-spin" /> : <MessagesSquare />}
              <span>{t.sidebar.chats}</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton
            isActive={section === "agents" || agentsLink.isNavigating}
            tooltip={t.sidebar.agents}
            asChild
          >
            <Link
              className={cn(
                "text-muted-foreground",
                agentsLink.isNavigating && "cursor-progress",
              )}
              {...agentsLink.linkProps}
            >
              {agentsLink.isNavigating ? <Loader2 className="animate-spin" /> : <BotIcon />}
              <span>{t.sidebar.agents}</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton
            isActive={section === "rss" || rssLink.isNavigating}
            tooltip={t.sidebar.rss}
            asChild
          >
            <Link
              className={cn(
                "text-muted-foreground",
                rssLink.isNavigating && "cursor-progress",
              )}
              {...rssLink.linkProps}
            >
              {rssLink.isNavigating ? <Loader2 className="animate-spin" /> : <NewspaperIcon />}
              <span>{t.sidebar.rss}</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton
            isActive={section === "scheduler" || schedulerLink.isNavigating}
            tooltip={t.sidebar.scheduler}
            asChild
          >
            <Link
              className={cn(
                "text-muted-foreground",
                schedulerLink.isNavigating && "cursor-progress",
              )}
              {...schedulerLink.linkProps}
            >
              {schedulerLink.isNavigating ? <Loader2 className="animate-spin" /> : <Clock3Icon />}
              <span>{t.sidebar.scheduler}</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarGroup>
  );
}
