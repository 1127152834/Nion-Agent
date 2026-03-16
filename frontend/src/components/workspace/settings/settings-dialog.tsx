"use client";

import {
  BellIcon,
  BrainIcon,
  DatabaseIcon,
  GlobeIcon,
  Link2Icon,
  PaletteIcon,
  RouteIcon,
  SparklesIcon,
  WrenchIcon,
  SquareTerminalIcon,
  BotIcon,
  BoxIcon,
  ServerIcon,
  PlugIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SidebarGroupLabel } from "@/components/ui/sidebar";
import { AppearanceSettingsPage } from "@/components/workspace/settings/appearance-settings-page";
import { ChannelSettingsPage } from "@/components/workspace/settings/channel-settings-page";
import { CliToolsPage } from "@/components/workspace/settings/cli-tools-page";
import { DesktopRuntimeSettingsPage } from "@/components/workspace/settings/desktop-runtime-settings-page";
import { DiagnosticsSettingsPage } from "@/components/workspace/settings/diagnostics-settings-page";
import { MCPServersPage } from "@/components/workspace/settings/mcp-servers-page";
import { MemorySettingsPage } from "@/components/workspace/settings/memory-settings-page";
import { ModelSettingsPage } from "@/components/workspace/settings/model-settings-page";
import { NotificationSettingsPage } from "@/components/workspace/settings/notification-settings-page";
import { RetrievalSettingsPage } from "@/components/workspace/settings/retrieval-settings-page";
import { SandboxSettingsPage } from "@/components/workspace/settings/sandbox-settings-page";
import { SearchSettingsPage } from "@/components/workspace/settings/search-settings-page";
import { SessionPolicySettingsPage } from "@/components/workspace/settings/session-policy-settings-page";
import { SkillSettingsPage } from "@/components/workspace/settings/skill-settings-page";
import { ToolSettingsPage } from "@/components/workspace/settings/tool-settings-page";
import { WorkbenchPluginsPage } from "@/components/workspace/settings/workbench-plugins-page";
import { useI18n } from "@/core/i18n/hooks";
import { useDesktopRuntime } from "@/core/platform/hooks";
import { cn } from "@/lib/utils";

import { SettingsDialogProvider } from "./settings-dialog-context";

type SettingsSection =
  | "appearance"
  | "models"
  | "sessionPolicy"
  | "memory"
  | "embedding"
  | "diagnostics"
  | "tools"
  | "cliTools"
  | "searchSettings"
  | "mcpServers"
  | "channels"
  | "skills"
  | "sandbox"
  | "notification"
  | "workbench-plugins"
  | "desktop-runtime";

type SettingsDialogProps = React.ComponentProps<typeof Dialog> & {
  defaultSection?: SettingsSection;
};

type SettingsNavItem = {
  id: SettingsSection;
  label: string;
  icon: typeof PaletteIcon;
};

function SettingsNavGroupTitle({
  icon: Icon,
  title,
}: {
  icon: typeof PaletteIcon;
  title: string;
}) {
  return (
    <div className="space-y-1">
      <SidebarGroupLabel
        className={cn(
          // Intentionally subdued so group titles read as structure, not as clickable items.
          "h-auto gap-2 rounded-none bg-transparent px-2 py-1",
          "text-[11px] font-semibold text-sidebar-foreground/60",
        )}
      >
        <Icon className="size-3.5 shrink-0 opacity-70" />
        <span className="truncate">{title}</span>
      </SidebarGroupLabel>
      <div className="mx-2 h-px bg-sidebar-border/60" aria-hidden="true" />
    </div>
  );
}

export function SettingsDialog(props: SettingsDialogProps) {
  const { defaultSection = "appearance", ...dialogProps } = props;
  const { t } = useI18n();
  const { mounted, isDesktopRuntime } = useDesktopRuntime();
  const [activeSection, setActiveSection] =
    useState<SettingsSection>(defaultSection);

  useEffect(() => {
    // When opening the dialog, ensure the active section follows the caller's intent.
    if (dialogProps.open) {
      setActiveSection(defaultSection);
    }
  }, [defaultSection, dialogProps.open]);

  const navGroups = useMemo(() => {
    const items: Record<SettingsSection, SettingsNavItem> = {
      appearance: { id: "appearance", label: t.settings.sections.appearance, icon: PaletteIcon },
      models: { id: "models", label: t.settings.models?.title ?? "Models", icon: BotIcon },
      sessionPolicy: { id: "sessionPolicy", label: t.settings.sections.sessionPolicy, icon: SparklesIcon },
      memory: { id: "memory", label: t.settings.sections.memory, icon: BrainIcon },
      embedding: {
        id: "embedding",
        label: t.settings.sections.embedding ?? t.settings.retrieval?.title ?? "Retrieval",
        icon: DatabaseIcon,
      },
      diagnostics: { id: "diagnostics", label: t.settings.sections.diagnostics, icon: RouteIcon },
      tools: { id: "tools", label: t.settings.sections.tools, icon: WrenchIcon },
      cliTools: { id: "cliTools", label: t.settings.sections.cliTools, icon: SquareTerminalIcon },
      searchSettings: { id: "searchSettings", label: t.settings.sections.searchSettings ?? "搜索设置", icon: GlobeIcon },
      mcpServers: { id: "mcpServers", label: t.settings.sections.mcpServers ?? "MCP 服务器", icon: PlugIcon },
      channels: { id: "channels", label: t.settings.sections.channels, icon: Link2Icon },
      skills: { id: "skills", label: t.settings.sections.skills, icon: SparklesIcon },
      notification: { id: "notification", label: t.settings.sections.notification, icon: BellIcon },
      "workbench-plugins": {
        id: "workbench-plugins",
        label: t.settings.workbenchPlugins?.title ?? "Workbench plugins",
        icon: BoxIcon,
      },
      sandbox: { id: "sandbox", label: t.settings.sandbox?.title ?? "Sandbox", icon: BoxIcon },
      "desktop-runtime": { id: "desktop-runtime", label: t.settings.sections.desktopRuntime, icon: ServerIcon },
    };

    const groups: {
      id: string;
      title: string;
      icon: typeof PaletteIcon;
      items: SettingsNavItem[];
    }[] = [
      {
        id: "experience",
        title: t.settings.navGroups.experience,
        icon: PaletteIcon,
        items: [items.appearance, items.notification],
      },
      {
        id: "conversation",
        title: t.settings.navGroups.conversation,
        icon: SparklesIcon,
        items: [items.models, items.sessionPolicy],
      },
      {
        id: "memory",
        title: t.settings.navGroups.memory,
        icon: BrainIcon,
        items: [items.memory, items.embedding, items.searchSettings],
      },
      {
        id: "tools",
        title: t.settings.navGroups.tools,
        icon: WrenchIcon,
        items: [
          items.tools,
          items.cliTools,
          items.mcpServers,
          items.channels,
          items.skills,
          items["workbench-plugins"],
        ],
      },
      {
        id: "system",
        title: t.settings.navGroups.system,
        icon: ServerIcon,
        items: [
          items.sandbox,
          items.diagnostics,
          ...(mounted && isDesktopRuntime ? [items["desktop-runtime"]] : []),
        ],
      },
    ];

    return groups.filter((group) => group.items.length > 0);
  }, [
    t.settings.sections.appearance,
    t.settings.models?.title,
    t.settings.sections.sessionPolicy,
    t.settings.sections.memory,
    t.settings.sections.embedding,
    t.settings.retrieval?.title,
    t.settings.sections.diagnostics,
    t.settings.sections.tools,
    t.settings.sections.cliTools,
    t.settings.sections.searchSettings,
    t.settings.sections.mcpServers,
    t.settings.sections.channels,
    t.settings.sections.skills,
    t.settings.sections.notification,
    t.settings.workbenchPlugins?.title,
    t.settings.sandbox?.title,
    t.settings.sections.desktopRuntime,
    t.settings.navGroups.experience,
    t.settings.navGroups.conversation,
    t.settings.navGroups.memory,
    t.settings.navGroups.tools,
    t.settings.navGroups.system,
    mounted,
    isDesktopRuntime,
  ]);
  return (
    <Dialog
      {...dialogProps}
      onOpenChange={(open) => props.onOpenChange?.(open)}
    >
      <DialogContent
        className="flex h-[75vh] max-h-[calc(100vh-2rem)] flex-col sm:max-w-5xl md:max-w-6xl"
        aria-describedby={undefined}
      >
        <DialogHeader className="gap-1">
          <DialogTitle>{t.settings.title}</DialogTitle>
          <p className="text-muted-foreground text-sm">
            {t.settings.description}
          </p>
        </DialogHeader>
        <SettingsDialogProvider
          value={{
            activeSection,
            goToSection: (sectionId) => setActiveSection(sectionId as SettingsSection),
          }}
        >
          <div className="grid min-h-0 flex-1 gap-4 md:grid-cols-[220px_1fr]">
            <nav className="bg-sidebar min-h-0 overflow-y-auto rounded-lg border border-sidebar-border p-2">
              <div className="space-y-3 pr-1">
                {navGroups.map((group) => (
                  <div key={group.id} className="space-y-2">
                    <SettingsNavGroupTitle icon={group.icon} title={group.title} />
                    <ul className="space-y-1">
                      {group.items.map(({ id, label, icon: Icon }) => {
                        const active = activeSection === id;
                        return (
                          <li key={id}>
                            <button
                              type="button"
                              onClick={() => setActiveSection(id)}
                              className={cn(
                                "group flex w-full items-center gap-3 rounded-md border px-3 py-2 text-sm transition-colors",
                                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                                active
                                  ? "border-sidebar-border bg-sidebar-accent font-semibold text-foreground"
                                  : "border-transparent text-muted-foreground hover:border-sidebar-border/70 hover:bg-sidebar-accent/50 hover:text-foreground",
                              )}
                            >
                              <Icon
                                className={cn(
                                  "size-4 shrink-0",
                                  active
                                    ? "opacity-90"
                                    : "opacity-70 group-hover:opacity-90",
                                )}
                              />
                              <span className="truncate">{label}</span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            </nav>
            <ScrollArea className="h-full min-h-0 rounded-lg border">
              <div className="space-y-8 p-6">
                {activeSection === "appearance" && <AppearanceSettingsPage />}
                {activeSection === "models" && <ModelSettingsPage />}
                {activeSection === "sessionPolicy" && <SessionPolicySettingsPage />}
                {activeSection === "memory" && (
                  <MemorySettingsPage
                    onClose={() => props.onOpenChange?.(false)}
                  />
                )}
                {activeSection === "embedding" && <RetrievalSettingsPage />}
                {activeSection === "diagnostics" && <DiagnosticsSettingsPage />}
                {activeSection === "tools" && <ToolSettingsPage />}
                {activeSection === "cliTools" && <CliToolsPage />}
                {activeSection === "searchSettings" && <SearchSettingsPage />}
                {activeSection === "mcpServers" && <MCPServersPage />}
                {activeSection === "channels" && <ChannelSettingsPage />}
                {activeSection === "skills" && (
                  <SkillSettingsPage
                    onClose={() => props.onOpenChange?.(false)}
                  />
                )}
                {activeSection === "workbench-plugins" && (
                  <WorkbenchPluginsPage
                    onClose={() => props.onOpenChange?.(false)}
                  />
                )}
                {activeSection === "sandbox" && <SandboxSettingsPage />}
                {activeSection === "desktop-runtime" && <DesktopRuntimeSettingsPage />}
                {activeSection === "notification" && <NotificationSettingsPage />}
              </div>
            </ScrollArea>
          </div>
        </SettingsDialogProvider>
      </DialogContent>
    </Dialog>
  );
}
