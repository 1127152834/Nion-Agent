"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { Toaster } from "sonner";

import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { RuntimeOnboardingOverlay } from "@/components/workspace/runtime-onboarding-overlay";
import { SchedulerReminderWatcher } from "@/components/workspace/scheduler/scheduler-reminder-watcher";
import { WorkspaceSidebar } from "@/components/workspace/workspace-sidebar";
import { RSSContextProvider } from "@/core/rss";
import { getLocalSettings, useLocalSettings } from "@/core/settings";

const queryClient = new QueryClient();

export default function WorkspaceLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const [settings, setSettings] = useLocalSettings();
  const [open, setOpen] = useState(false); // SSR default: open (matches server render)
  const [titlebarInset, setTitlebarInset] = useState(0);

  useLayoutEffect(() => {
    // Runs synchronously before first paint on the client — no visual flash
    setOpen(!getLocalSettings().layout.sidebar_collapsed);

    const ua = window.navigator.userAgent || "";
    const platform = window.navigator.platform || "";
    const isElectron = ua.includes("Electron");
    const isMac = /Mac/i.test(platform) || /Macintosh|Mac OS X/i.test(ua);
    setTitlebarInset(isElectron && isMac ? 28 : 0);
  }, []);
  useEffect(() => {
    setOpen(!settings.layout.sidebar_collapsed);
  }, [settings.layout.sidebar_collapsed]);
  const handleOpenChange = useCallback(
    (open: boolean) => {
      setOpen(open);
      setSettings("layout", { sidebar_collapsed: !open });
    },
    [setSettings],
  );
  return (
    <QueryClientProvider client={queryClient}>
      <RSSContextProvider>
        <RuntimeOnboardingOverlay />
        <SchedulerReminderWatcher />
        <RuntimeOnboardingOverlay />
        <SidebarProvider
          className="h-screen"
          style={
            {
              "--desktop-titlebar-safe-area": `${titlebarInset}px`,
            } as React.CSSProperties
          }
          open={open}
          onOpenChange={handleOpenChange}
        >
          <WorkspaceSidebar />
          <SidebarInset className="min-w-0 pt-[var(--desktop-titlebar-safe-area,0px)]">
            {children}
          </SidebarInset>
        </SidebarProvider>
      </RSSContextProvider>
      <Toaster position="top-center" />
    </QueryClientProvider>
  );
}
