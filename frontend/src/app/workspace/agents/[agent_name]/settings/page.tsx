"use client";

import { ArrowLeftIcon, BotIcon, OrbitIcon, RadarIcon, SparklesIcon } from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";
import { use } from "react";
import type { ComponentType } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AgentMemorySection } from "@/components/workspace/agents/settings/agent-memory-section";
import { BasicSettings } from "@/components/workspace/agents/settings/basic-settings";
import { IdentityEditor, SoulEditor } from "@/components/workspace/agents/settings/editor-section";
import { EvolutionReportsViewer } from "@/components/workspace/agents/settings/evolution-reports";
import { EvolutionSettingsComponent } from "@/components/workspace/agents/settings/evolution-settings";
import { HeartbeatLogsViewer } from "@/components/workspace/agents/settings/heartbeat-logs";
import { HeartbeatSettingsComponent } from "@/components/workspace/agents/settings/heartbeat-settings";
import { AgentSchedulerSettingsSection } from "@/components/workspace/agents/settings/scheduler-settings";
import { useAgent, useDefaultAgentConfig } from "@/core/agents";
import { useI18n } from "@/core/i18n/hooks";
import { useAppRouter } from "@/core/navigation";
import { cn } from "@/lib/utils";

type AgentSettingsSection =
  | "basic"
  | "memory"
  | "soul"
  | "identity"
  | "heartbeat"
  | "scheduler"
  | "evolution"
  | "logs"
  | "reports";

const SECTION_DEFAULT: AgentSettingsSection = "basic";

function normalizeSection(value: string | null): AgentSettingsSection {
  if (!value) {
    return SECTION_DEFAULT;
  }
  if (
    value === "basic"
    || value === "memory"
    || value === "soul"
    || value === "identity"
    || value === "heartbeat"
    || value === "scheduler"
    || value === "evolution"
    || value === "logs"
    || value === "reports"
  ) {
    return value;
  }
  return SECTION_DEFAULT;
}

export default function AgentSettingsPage({
  params,
}: {
  params: Promise<{ agent_name: string }>;
}) {
  const { agent_name } = use(params);
  const decodedAgentName = decodeURIComponent(agent_name);
  const isDefaultAgent = decodedAgentName === "_default";
  const router = useAppRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { t } = useI18n();
  const copy = t.agents.settings;

  const { agent } = useAgent(isDefaultAgent ? null : decodedAgentName);
  const { config: defaultAgent } = useDefaultAgentConfig();
  const displayAgent = isDefaultAgent ? defaultAgent : agent;

  const activeSection = normalizeSection(searchParams.get("section"));

  const navigateSection = (section: AgentSettingsSection) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("section", section);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const openChat = () => {
    if (isDefaultAgent) {
      router.push("/workspace/chats/new");
      return;
    }
    router.push(`/workspace/agents/${encodeURIComponent(decodedAgentName)}/chats/new`);
  };

  const navGroups: {
    title: string;
    icon: ComponentType<{ className?: string }>;
    items: { id: AgentSettingsSection; label: string }[];
  }[] = [
    {
      title: copy.layout.overviewGroup,
      icon: BotIcon,
      items: [
        { id: "basic", label: copy.tabs.basic },
        { id: "memory", label: copy.tabs.memory },
      ],
    },
    {
      title: copy.layout.personaGroup,
      icon: SparklesIcon,
      items: [
        { id: "soul", label: copy.tabs.soul },
        { id: "identity", label: copy.tabs.identity },
      ],
    },
    {
      title: copy.layout.runtimeGroup,
      icon: OrbitIcon,
      items: [
        { id: "heartbeat", label: copy.tabs.heartbeat },
        { id: "scheduler", label: copy.tabs.scheduler },
        { id: "evolution", label: copy.tabs.evolution },
      ],
    },
    {
      title: copy.layout.observabilityGroup,
      icon: RadarIcon,
      items: [
        { id: "logs", label: copy.tabs.logs },
        { id: "reports", label: copy.tabs.reports },
      ],
    },
  ];

  return (
    <div className="flex size-full flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b px-4 py-3">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => router.push("/workspace/agents")}
        >
          <ArrowLeftIcon className="h-4 w-4" />
        </Button>
        <h1 className="text-sm font-semibold">
          {copy.pageTitle.replace("{name}", decodedAgentName)}
        </h1>
      </header>

      <main className="flex-1 overflow-auto p-4 md:p-6">
        <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
          <aside className="bg-sidebar rounded-2xl border p-3 lg:sticky lg:top-6 lg:self-start">
            <div className="space-y-1">
              {navGroups.map((group) => {
                const GroupIcon = group.icon;
                return (
                  <div key={group.title} className="mb-3">
                    <div className="text-muted-foreground mb-1 flex items-center gap-2 px-2 text-xs font-medium">
                      <GroupIcon className="size-3.5" />
                      {group.title}
                    </div>
                    <div className="space-y-1">
                      {group.items.map((item) => {
                        const active = activeSection === item.id;
                        return (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => navigateSection(item.id)}
                            className={cn(
                              "flex w-full items-center rounded-lg px-3 py-2 text-sm transition-colors",
                              active
                                ? "bg-primary text-primary-foreground"
                                : "text-muted-foreground hover:bg-muted hover:text-foreground",
                            )}
                          >
                            {item.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </aside>

          <section className="space-y-4">
            <div className="rounded-2xl border bg-gradient-to-br from-primary/10 via-primary/5 to-background p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold">{decodedAgentName}</p>
                    {isDefaultAgent ? <Badge variant="outline">{t.agents.defaultBadge}</Badge> : null}
                    {displayAgent?.model ? <Badge variant="secondary">{displayAgent.model}</Badge> : null}
                  </div>
                  <p className="text-muted-foreground text-xs leading-6">
                    {displayAgent?.description ?? copy.layout.subtitle}
                  </p>
                </div>
                <Button size="sm" onClick={openChat}>
                  {copy.layout.openChat}
                </Button>
              </div>
            </div>

            {activeSection === "basic" ? <BasicSettings agentName={decodedAgentName} /> : null}
            {activeSection === "memory" ? <AgentMemorySection agentName={decodedAgentName} /> : null}
            {activeSection === "heartbeat" ? <HeartbeatSettingsComponent agentName={decodedAgentName} /> : null}
            {activeSection === "scheduler" ? <AgentSchedulerSettingsSection agentName={decodedAgentName} /> : null}
            {activeSection === "evolution" ? <EvolutionSettingsComponent agentName={decodedAgentName} /> : null}
            {activeSection === "soul" ? <SoulEditor agentName={decodedAgentName} /> : null}
            {activeSection === "identity" ? <IdentityEditor agentName={decodedAgentName} /> : null}
            {activeSection === "logs" ? <HeartbeatLogsViewer agentName={decodedAgentName} /> : null}
            {activeSection === "reports" ? <EvolutionReportsViewer agentName={decodedAgentName} /> : null}
          </section>
        </div>
      </main>
    </div>
  );
}
