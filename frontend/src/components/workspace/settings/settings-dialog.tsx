"use client";

import {
  ActivityIcon,
  BellIcon,
  InfoIcon,
  BrainIcon,
  DatabaseIcon,
  Link2Icon,
  PaletteIcon,
  SparklesIcon,
  WrenchIcon,
  SquareTerminalIcon,
  BotIcon,
  BoxIcon,
  ServerIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AboutSettingsPage } from "@/components/workspace/settings/about-settings-page";
import { AppearanceSettingsPage } from "@/components/workspace/settings/appearance-settings-page";
import { ChannelSettingsPage } from "@/components/workspace/settings/channel-settings-page";
import { CliToolsPage } from "@/components/workspace/settings/cli-tools-page";
import { DesktopRuntimeSettingsPage } from "@/components/workspace/settings/desktop-runtime-settings-page";
import { MemorySettingsPage } from "@/components/workspace/settings/memory-settings-page";
import { ModelSettingsPage } from "@/components/workspace/settings/model-settings-page";
import { NotificationSettingsPage } from "@/components/workspace/settings/notification-settings-page";
import { RetrievalSettingsPage } from "@/components/workspace/settings/retrieval-settings-page";
import { RuntimeTopologySettingsPage } from "@/components/workspace/settings/runtime-topology-settings-page";
import { SandboxSettingsPage } from "@/components/workspace/settings/sandbox-settings-page";
import { SessionPolicySettingsPage } from "@/components/workspace/settings/session-policy-settings-page";
import { SkillSettingsPage } from "@/components/workspace/settings/skill-settings-page";
import { ToolSettingsPage } from "@/components/workspace/settings/tool-settings-page";
import { WorkbenchPluginsPage } from "@/components/workspace/settings/workbench-plugins-page";
import { useI18n } from "@/core/i18n/hooks";
import { useDesktopRuntime } from "@/core/platform/hooks";
import { cn } from "@/lib/utils";

type SettingsSection =
  | "appearance"
  | "models"
  | "sessionPolicy"
  | "memory"
  | "embedding"
  | "tools"
  | "cliTools"
  | "channels"
  | "skills"
  | "sandbox"
  | "diagnostics"
  | "notification"
  | "workbench-plugins"
  | "desktop-runtime"
  | "about";

type SettingsDialogProps = React.ComponentProps<typeof Dialog> & {
  defaultSection?: SettingsSection;
};

export function SettingsDialog(props: SettingsDialogProps) {
  const { defaultSection = "appearance", ...dialogProps } = props;
  const { t } = useI18n();
  const { mounted, isDesktopRuntime } = useDesktopRuntime();
  const [activeSection, setActiveSection] =
    useState<SettingsSection>(defaultSection);

  useEffect(() => {
    // When opening the dialog, ensure the active section follows the caller's intent.
    // This allows triggers like "About" to open the dialog directly on that page.
    if (dialogProps.open) {
      setActiveSection(defaultSection);
    }
  }, [defaultSection, dialogProps.open]);

  const sections = useMemo(
    () => [
      {
        id: "appearance",
        label: t.settings.sections.appearance,
        icon: PaletteIcon,
      },
      {
        id: "models",
        label: t.settings.models?.title ?? "Models",
        icon: BotIcon,
      },
      {
        id: "sessionPolicy",
        label: t.settings.sections.sessionPolicy,
        icon: SparklesIcon,
      },
      {
        id: "memory",
        label: t.settings.sections.memory,
        icon: BrainIcon,
      },
      {
        id: "embedding",
        label: t.settings.sections.embedding ?? t.settings.retrieval?.title ?? "Retrieval",
        icon: DatabaseIcon,
      },
      { id: "tools", label: t.settings.sections.tools, icon: WrenchIcon },
      { id: "cliTools", label: t.settings.sections.cliTools ?? "CLI 工具", icon: SquareTerminalIcon },
      { id: "channels", label: t.settings.sections.channels, icon: Link2Icon },
      { id: "skills", label: t.settings.sections.skills, icon: SparklesIcon },
      {
        id: "notification",
        label: t.settings.sections.notification,
        icon: BellIcon,
      },
      {
        id: "diagnostics",
        label: t.settings.sections.diagnostics,
        icon: ActivityIcon,
      },
      { id: "workbench-plugins", label: t.settings.workbenchPlugins?.title ?? "Workbench plugins", icon: BoxIcon },
      { id: "sandbox", label: t.settings.sandbox?.title ?? "Sandbox", icon: BoxIcon },
      ...(mounted && isDesktopRuntime
        ? [{ id: "desktop-runtime", label: t.settings.sections.desktopRuntime, icon: ServerIcon }]
        : []),
      { id: "about", label: t.settings.sections.about, icon: InfoIcon },
    ],
    [
      t.settings.sections.appearance,
      t.settings.models?.title,
      t.settings.sections.sessionPolicy,
      t.settings.sections.memory,
      t.settings.sections.embedding,
      t.settings.retrieval?.title,
      t.settings.sections.tools,
      t.settings.sections.cliTools,
      t.settings.sections.channels,
      t.settings.sections.skills,
      t.settings.sections.notification,
      t.settings.sections.diagnostics,
      t.settings.workbenchPlugins?.title,
      t.settings.sandbox?.title,
      t.settings.sections.desktopRuntime,
      t.settings.sections.about,
      mounted,
      isDesktopRuntime,
    ],
  );
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
        <div className="grid min-h-0 flex-1 gap-4 md:grid-cols-[220px_1fr]">
          <nav className="bg-sidebar min-h-0 overflow-y-auto rounded-lg border p-2">
            <ul className="space-y-1 pr-1">
              {sections.map(({ id, label, icon: Icon }) => {
                const active = activeSection === id;
                return (
                  <li key={id}>
                    <button
                      type="button"
                      onClick={() => setActiveSection(id as SettingsSection)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                        active
                          ? "bg-primary text-primary-foreground shadow-sm"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground",
                      )}
                    >
                      <Icon className="size-4" />
                      <span>{label}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
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
              {activeSection === "tools" && <ToolSettingsPage />}
              {activeSection === "cliTools" && <CliToolsPage />}
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
              {activeSection === "diagnostics" && <RuntimeTopologySettingsPage />}
              {activeSection === "about" && <AboutSettingsPage />}
            </div>
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
}
