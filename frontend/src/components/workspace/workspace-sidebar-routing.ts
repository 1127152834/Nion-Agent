"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";

import { useSidebar } from "@/components/ui/sidebar";
import { useAppRouter } from "@/core/navigation";
import { pathOfChatsIndex, pathOfNewThread } from "@/core/threads/utils";

export type WorkspaceSidebarSection =
  | "chats"
  | "agents"
  | "scheduler"
  | null;

const WORKSPACE_SIDEBAR_PREFETCH_ROUTES = [
  pathOfNewThread(),
  pathOfChatsIndex(),
  "/workspace/agents",
  "/workspace/about",
  "/workspace/scheduler",
] as const;

type WorkspaceSidebarNavigationMatch = "exact" | "prefix";

export function getWorkspaceSidebarSection(
  pathname: string,
): WorkspaceSidebarSection {
  if (pathname === pathOfNewThread()) {
    return null;
  }

  if (pathname === pathOfChatsIndex() || pathname.startsWith(`${pathOfChatsIndex()}/`)) {
    return "chats";
  }

  if (pathname.startsWith("/workspace/agents")) {
    return "agents";
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

export function isWorkspaceChatsNavActive(pathname: string): boolean {
  return isWorkspaceChatSidebarContext(pathname);
}

export function useWorkspaceChatsNavActive(): boolean {
  const pathname = usePathname();
  return isWorkspaceChatsNavActive(pathname);
}

export function isWorkspaceChatSidebarContext(pathname: string): boolean {
  return pathname === pathOfNewThread() || getWorkspaceSidebarSection(pathname) === "chats";
}

export function useWorkspaceChatSidebarContext(): boolean {
  const pathname = usePathname();
  return isWorkspaceChatSidebarContext(pathname);
}

export function useWorkspaceSidebarNavigation() {
  const { isMobile, setOpenMobile } = useSidebar();

  return useCallback(() => {
    if (isMobile) {
      setOpenMobile(false);
    }
  }, [isMobile, setOpenMobile]);
}

export function usePrefetchWorkspaceSidebarRoutes() {
  const router = useAppRouter();

  useEffect(() => {
    for (const route of WORKSPACE_SIDEBAR_PREFETCH_ROUTES) {
      router.prefetch(route);
    }
  }, [router]);
}

function isModifiedNavigationEvent(event: MouseEvent<HTMLAnchorElement>) {
  return event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
}

function matchesSidebarNavigationTarget(
  pathname: string,
  href: string,
  match: WorkspaceSidebarNavigationMatch,
) {
  if (match === "prefix") {
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  return pathname === href;
}

export function useWorkspaceSidebarLink(
  href: string,
  options?: { match?: WorkspaceSidebarNavigationMatch },
) {
  const pathname = usePathname();
  const router = useAppRouter();
  const { isMobile, setOpenMobile } = useSidebar();
  const [isNavigating, setIsNavigating] = useState(false);
  const previousPathnameRef = useRef(pathname);

  const match = options?.match ?? "exact";
  const isTargetPath = matchesSidebarNavigationTarget(pathname, href, match);

  useEffect(() => {
    if (previousPathnameRef.current !== pathname) {
      setIsNavigating(false);
    }

    previousPathnameRef.current = pathname;
  }, [pathname]);

  const onClick = useCallback((event: MouseEvent<HTMLAnchorElement>) => {
    if (event.defaultPrevented || isModifiedNavigationEvent(event)) {
      return;
    }

    if (isMobile) {
      setOpenMobile(false);
    }

    if (isTargetPath || isNavigating) {
      event.preventDefault();
      return;
    }

    event.preventDefault();
    setIsNavigating(true);
    router.push(href);
  }, [href, isMobile, isNavigating, isTargetPath, router, setOpenMobile]);

  return {
    isNavigating,
    linkProps: {
      href,
      onClick,
      prefetch: true,
      "aria-busy": isNavigating || undefined,
      "aria-disabled": isNavigating || undefined,
    },
  };
}

export function useWorkspaceSidebarPresentation() {
  const { isMobile, open, openMobile, state } = useSidebar();

  return {
    isMobile,
    isCollapsed: !isMobile && state === "collapsed",
    isExpanded: isMobile ? openMobile : open,
  };
}
