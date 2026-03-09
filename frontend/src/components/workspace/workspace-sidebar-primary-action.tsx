"use client";

import { MessageSquarePlus } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { SidebarGroup, SidebarGroupContent } from "@/components/ui/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useI18n } from "@/core/i18n/hooks";
import { cn } from "@/lib/utils";

import {
  useWorkspaceSidebarNavigation,
  useWorkspaceSidebarPresentation,
} from "./workspace-sidebar-routing";

export function WorkspaceSidebarPrimaryAction() {
  const { t } = useI18n();
  const { isCollapsed } = useWorkspaceSidebarPresentation();
  const handleNavigate = useWorkspaceSidebarNavigation();

  const actionButton = (
    <Button
      asChild
      variant="outline"
      size={isCollapsed ? "icon-sm" : "sm"}
      className={cn(
        "border-sidebar-border bg-background text-foreground shadow-none hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        isCollapsed ? "mx-auto" : "w-full justify-start",
      )}
    >
      <Link href="/workspace/chats/new" onClick={handleNavigate}>
        <MessageSquarePlus />
        {isCollapsed ? (
          <span className="sr-only">{t.sidebar.newChat}</span>
        ) : (
          <span>{t.sidebar.newChat}</span>
        )}
      </Link>
    </Button>
  );

  return (
    <SidebarGroup className="pt-1 pb-0">
      <SidebarGroupContent>
        {isCollapsed ? (
          <Tooltip>
            <TooltipTrigger asChild>{actionButton}</TooltipTrigger>
            <TooltipContent side="right" align="center">
              {t.sidebar.newChat}
            </TooltipContent>
          </Tooltip>
        ) : (
          actionButton
        )}
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
