"use client";

import { usePathname } from "next/navigation";
import { useCallback } from "react";

import { useSidebar } from "@/components/ui/sidebar";

export type WorkspaceSidebarSection =
  | "chats"
  | "agents"
  | "rss"
  | "scheduler"
  | null;

export function getWorkspaceSidebarSection(
  pathname: string,
): WorkspaceSidebarSection {
  if (pathname === "/workspace/chats" || pathname.startsWith("/workspace/chats/")) {
    return "chats";
  }

  if (pathname.startsWith("/workspace/agents")) {
    return "agents";
  }

  if (pathname.startsWith("/workspace/rss")) {
    return "rss";
  }

  if (pathname.startsWith("/workspace/scheduler")) {
    return "scheduler";
  }

  return null;
}

export function useWorkspaceSidebarSection(): WorkspaceSidebarSection {
  const pathname = usePathname();
  return getWorkspaceSidebarSection(pathname);
}

export function useWorkspaceSidebarNavigation() {
  const { isMobile, setOpenMobile } = useSidebar();

  return useCallback(() => {
    if (isMobile) {
      setOpenMobile(false);
    }
  }, [isMobile, setOpenMobile]);
}

export function useWorkspaceSidebarPresentation() {
  const { isMobile, open, openMobile, state } = useSidebar();

  return {
    isMobile,
    isCollapsed: !isMobile && state === "collapsed",
    isExpanded: isMobile ? openMobile : open,
  };
}
