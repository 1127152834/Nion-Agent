"use client";

import {
  ChevronsUpDown,
  InfoIcon,
  Settings2Icon,
  SettingsIcon,
} from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { useI18n } from "@/core/i18n/hooks";
import { useAppRouter } from "@/core/navigation";

import { SettingsDialog } from "./settings";
import { useWorkspaceSidebarPresentation } from "./workspace-sidebar-routing";

type MenuSettingsSection =
  | "appearance"
  | "models"
  | "sessionPolicy"
  | "memory"
  | "embedding"
  | "tools"
  | "channels"
  | "skills"
  | "sandbox"
  | "notification"
  | "workbench-plugins"
  | "desktop-runtime";

function normalizeSettingsSection(section: string | null): MenuSettingsSection | null {
  if (
    section === "appearance"
    || section === "models"
    || section === "sessionPolicy"
    || section === "memory"
    || section === "embedding"
    || section === "tools"
    || section === "channels"
    || section === "skills"
    || section === "sandbox"
    || section === "notification"
    || section === "workbench-plugins"
    || section === "desktop-runtime"
  ) {
    return section;
  }
  return null;
}

function NavMenuButtonContent({
  isSidebarOpen,
  t,
}: {
  isSidebarOpen: boolean;
  t: ReturnType<typeof useI18n>["t"];
}) {
  return isSidebarOpen ? (
    <div className="text-muted-foreground flex w-full items-center gap-2 text-left text-sm">
      <SettingsIcon className="size-4" />
      <span>{t.workspace.settingsAndMore}</span>
      <ChevronsUpDown className="text-muted-foreground ml-auto size-4" />
    </div>
  ) : (
    <div className="flex size-full items-center justify-center">
      <SettingsIcon className="text-muted-foreground size-5" />
    </div>
  );
}

export function WorkspaceNavMenu() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsDefaultSection, setSettingsDefaultSection] = useState<MenuSettingsSection>("appearance");
  const [mounted, setMounted] = useState(false);
  const { isExpanded } = useWorkspaceSidebarPresentation();
  const router = useAppRouter();
  const clearedSettingsHrefRef = useRef<string | null>(null);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchParamsValue = searchParams.toString();
  const settingsQuery = searchParams.get("settings");
  const { t } = useI18n();

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const section = normalizeSettingsSection(settingsQuery);
    if (!section) {
      return;
    }
    setSettingsDefaultSection(section);
    setSettingsOpen(true);

    const params = new URLSearchParams(searchParamsValue);
    params.delete("settings");
    const next = params.size ? `${pathname}?${params.toString()}` : pathname;
    // Guard against re-running the effect before the URL updates.
    if (clearedSettingsHrefRef.current === next) {
      return;
    }
    clearedSettingsHrefRef.current = next;
    router.replace(next, { scroll: false });
  }, [pathname, router, searchParamsValue, settingsQuery]);

  return (
    <>
      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        defaultSection={settingsDefaultSection}
      />
      <SidebarMenu className="w-full">
        <SidebarMenuItem>
          {mounted ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton
                  size="lg"
                  className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                >
                  <NavMenuButtonContent isSidebarOpen={isExpanded} t={t} />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
                align="end"
                sideOffset={4}
              >
                <DropdownMenuGroup>
                  <DropdownMenuItem
                    onClick={() => {
                      setSettingsDefaultSection("appearance");
                      setSettingsOpen(true);
                    }}
                  >
                    <Settings2Icon />
                    {t.common.settings}
                  </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => {
                    setSettingsOpen(false);
                    router.push("/workspace/about");
                  }}
                >
                  <InfoIcon />
                  {t.workspace.about}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <SidebarMenuButton size="lg" className="pointer-events-none">
              <NavMenuButtonContent isSidebarOpen={isExpanded} t={t} />
            </SidebarMenuButton>
          )}
        </SidebarMenuItem>
      </SidebarMenu>
    </>
  );
}
