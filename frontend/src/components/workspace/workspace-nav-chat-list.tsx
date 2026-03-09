"use client";

import { BotIcon, Clock3Icon, MessagesSquare, NewspaperIcon } from "lucide-react";
import Link from "next/link";

import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { useI18n } from "@/core/i18n/hooks";

import {
  useWorkspaceSidebarNavigation,
  useWorkspaceSidebarSection,
} from "./workspace-sidebar-routing";

export function WorkspaceNavChatList() {
  const { t } = useI18n();
  const section = useWorkspaceSidebarSection();
  const handleNavigate = useWorkspaceSidebarNavigation();

  return (
    <SidebarGroup className="py-0">
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton isActive={section === "chats"} tooltip={t.sidebar.chats} asChild>
            <Link
              className="text-muted-foreground"
              href="/workspace/chats"
              onClick={handleNavigate}
            >
              <MessagesSquare />
              <span>{t.sidebar.chats}</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton
            isActive={section === "agents"}
            tooltip={t.sidebar.agents}
            asChild
          >
            <Link
              className="text-muted-foreground"
              href="/workspace/agents"
              onClick={handleNavigate}
            >
              <BotIcon />
              <span>{t.sidebar.agents}</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton
            isActive={section === "rss"}
            tooltip={t.sidebar.rss}
            asChild
          >
            <Link
              className="text-muted-foreground"
              href="/workspace/rss"
              onClick={handleNavigate}
            >
              <NewspaperIcon />
              <span>{t.sidebar.rss}</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton
            isActive={section === "scheduler"}
            tooltip={t.sidebar.scheduler}
            asChild
          >
            <Link
              className="text-muted-foreground"
              href="/workspace/scheduler"
              onClick={handleNavigate}
            >
              <Clock3Icon />
              <span>{t.sidebar.scheduler}</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarGroup>
  );
}
