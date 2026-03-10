"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import {
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { env } from "@/env";
import { cn } from "@/lib/utils";

import { useWorkspaceSidebarPresentation } from "./workspace-sidebar-routing";

export function WorkspaceHeader({ className }: { className?: string }) {
  const { isCollapsed } = useWorkspaceSidebarPresentation();
  const [titlebarInset, setTitlebarInset] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const ua = window.navigator.userAgent || "";
    const platform = window.navigator.platform || "";
    const isElectron = ua.includes("Electron");
    const isMac = /Mac/i.test(platform) || /Macintosh|Mac OS X/i.test(ua);
    setTitlebarInset(isElectron && isMac ? 26 : 0);
  }, []);

  return (
    <>
      <div
        className={cn(
          "group/workspace-header flex h-16 flex-col justify-center cursor-move transition-all duration-200 hover:bg-gradient-to-b hover:from-muted/40 hover:to-muted/20",
          className,
        )}
        style={{
          WebkitAppRegion: "drag",
          ...(titlebarInset > 0
            ? {
                paddingTop: `${titlebarInset}px`,
                height: `${64 + titlebarInset}px`,
              }
            : {}),
        } as React.CSSProperties}
      >
        {isCollapsed ? (
          <div className="group-has-data-[collapsible=icon]/sidebar-wrapper:-translate-y flex w-full cursor-pointer items-center justify-center">
            <div className="text-primary block pt-1 text-lg leading-none font-serif tracking-[0.08em] group-hover/workspace-header:hidden">
              NION
            </div>
            <SidebarTrigger
              className="hidden group-hover/workspace-header:block"
              style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
            />
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2">
            {env.NEXT_PUBLIC_STATIC_WEBSITE_ONLY === "true" ? (
              <Link
                href="/"
                className="text-primary ml-2 font-serif"
                style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
              >
                Nion
              </Link>
            ) : (
              <div className="text-primary ml-2 cursor-default font-serif">
                Nion
              </div>
            )}
            <SidebarTrigger style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties} />
          </div>
        )}
      </div>
    </>
  );
}
