"use client";

import {
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarRail,
  SidebarSeparator,
} from "@/components/ui/sidebar";

import { RecentChatList } from "./recent-chat-list";
import { WorkspaceHeader } from "./workspace-header";
import { WorkspaceNavChatList } from "./workspace-nav-chat-list";
import { WorkspaceNavMenu } from "./workspace-nav-menu";
import { WorkspaceSidebarPrimaryAction } from "./workspace-sidebar-primary-action";
import {
  useWorkspaceChatSidebarContext,
  usePrefetchWorkspaceSidebarRoutes,
  useWorkspaceSidebarPresentation,
} from "./workspace-sidebar-routing";

export function WorkspaceSidebar({
  ...props
}: React.ComponentProps<typeof Sidebar>) {
  usePrefetchWorkspaceSidebarRoutes();
  const showChatContext = useWorkspaceChatSidebarContext();
  const { isExpanded } = useWorkspaceSidebarPresentation();
  const showRecentChats = showChatContext && isExpanded;

  return (
    <>
      <Sidebar variant="floating" collapsible="icon" {...props}>
        <SidebarHeader className="py-0">
          <WorkspaceHeader />
        </SidebarHeader>
        <SidebarContent>
          <WorkspaceSidebarPrimaryAction />
          <SidebarSeparator />
          <WorkspaceNavChatList />
          {showRecentChats ? (
            <>
              <SidebarSeparator />
              <RecentChatList />
            </>
          ) : null}
        </SidebarContent>
        <SidebarFooter>
          <WorkspaceNavMenu />
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
    </>
  );
}
