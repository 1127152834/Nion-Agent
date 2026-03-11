"use client";

import { ArrowLeftIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { use } from "react";

import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { BasicSettings } from "@/components/workspace/agents/settings/basic-settings";
import { IdentityEditor, SoulEditor } from "@/components/workspace/agents/settings/editor-section";
import { EvolutionReportsViewer } from "@/components/workspace/agents/settings/evolution-reports";
import { EvolutionSettingsComponent } from "@/components/workspace/agents/settings/evolution-settings";
import { HeartbeatLogsViewer } from "@/components/workspace/agents/settings/heartbeat-logs";
import { HeartbeatSettingsComponent } from "@/components/workspace/agents/settings/heartbeat-settings";
import { useI18n } from "@/core/i18n/hooks";

export default function AgentSettingsPage({
  params,
}: {
  params: Promise<{ agent_name: string }>;
}) {
  const { agent_name } = use(params);
  const router = useRouter();
  const { t } = useI18n();
  const copy = t.agents.settings;

  return (
    <div className="flex size-full flex-col">
      {/* Header */}
      <header className="flex shrink-0 items-center gap-3 border-b px-4 py-3">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => router.push("/workspace/agents")}
        >
          <ArrowLeftIcon className="h-4 w-4" />
        </Button>
        <h1 className="text-sm font-semibold">
          {copy.pageTitle.replace("{name}", decodeURIComponent(agent_name))}
        </h1>
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-3xl">
          <Tabs defaultValue="basic">
            <TabsList variant="line" className="mb-6">
              <TabsTrigger value="basic">{copy.tabs.basic}</TabsTrigger>
              <TabsTrigger value="heartbeat">{copy.tabs.heartbeat}</TabsTrigger>
              <TabsTrigger value="evolution">{copy.tabs.evolution}</TabsTrigger>
              <TabsTrigger value="soul">{copy.tabs.soul}</TabsTrigger>
              <TabsTrigger value="identity">{copy.tabs.identity}</TabsTrigger>
              <TabsTrigger value="logs">{copy.tabs.logs}</TabsTrigger>
              <TabsTrigger value="reports">{copy.tabs.reports}</TabsTrigger>
            </TabsList>

            <TabsContent value="basic">
              <BasicSettings agentName={agent_name} />
            </TabsContent>

            <TabsContent value="heartbeat">
              <HeartbeatSettingsComponent agentName={agent_name} />
            </TabsContent>

            <TabsContent value="evolution">
              <EvolutionSettingsComponent agentName={agent_name} />
            </TabsContent>

            <TabsContent value="soul">
              <SoulEditor agentName={agent_name} />
            </TabsContent>

            <TabsContent value="identity">
              <IdentityEditor agentName={agent_name} />
            </TabsContent>

            <TabsContent value="logs">
              <HeartbeatLogsViewer agentName={agent_name} />
            </TabsContent>

            <TabsContent value="reports">
              <EvolutionReportsViewer agentName={agent_name} />
            </TabsContent>
          </Tabs>
        </div>
      </main>
    </div>
  );
}
