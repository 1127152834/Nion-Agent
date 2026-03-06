"use client";

import { MessageSquarePlus } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { useI18n } from "@/core/i18n/hooks";
import { env } from "@/env";
import { cn } from "@/lib/utils";

export function WorkspaceHeader({ className }: { className?: string }) {
  const { t } = useI18n();
  const { state } = useSidebar();
  const pathname = usePathname();
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
          "group/workspace-header flex h-12 flex-col justify-center",
          className,
        )}
        style={
          titlebarInset > 0
            ? {
                paddingTop: `${titlebarInset}px`,
                height: `${48 + titlebarInset}px`,
              }
            : undefined
        }
      >
        {state === "collapsed" ? (
          <div className="group-has-data-[collapsible=icon]/sidebar-wrapper:-translate-y flex w-full cursor-pointer items-center justify-center">
            <div className="text-primary block pt-1 font-serif group-hover/workspace-header:hidden">
              DF
            </div>
            <SidebarTrigger className="hidden pl-2 group-hover/workspace-header:block" />
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2">
            {env.NEXT_PUBLIC_STATIC_WEBSITE_ONLY === "true" ? (
              <Link href="/" className="text-primary ml-2 font-serif">
                Nion
              </Link>
            ) : (
              <div className="text-primary ml-2 cursor-default font-serif">
                Nion
              </div>
            )}
            <SidebarTrigger />
          </div>
        )}
      </div>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            isActive={pathname === "/workspace/chats/new"}
            asChild
          >
            <Link className="text-muted-foreground" href="/workspace/chats/new">
              <MessageSquarePlus size={16} />
              <span>{t.sidebar.newChat}</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </>
  );
}
