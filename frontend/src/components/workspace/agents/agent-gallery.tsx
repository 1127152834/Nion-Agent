"use client";

import { BotIcon, PlusIcon, SearchIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAgents, useDefaultAgentConfig } from "@/core/agents";
import { useI18n } from "@/core/i18n/hooks";
import { useMemoryCatalog } from "@/core/memory/hooks";

import { AgentCard } from "./agent-card";

type AgentFilter = "all" | "default" | "heartbeat" | "evolution";

export function AgentGallery() {
  const { t } = useI18n();
  const { agents, isLoading } = useAgents();
  const { config: defaultAgent, isLoading: defaultAgentLoading } = useDefaultAgentConfig();
  const { catalog } = useMemoryCatalog();
  const router = useRouter();

  const [searchTerm, setSearchTerm] = useState("");
  const [filter, setFilter] = useState<AgentFilter>("all");

  const handleNewAgent = () => {
    router.push("/workspace/agents/new");
  };

  const catalogByName = useMemo(
    () => new Map(catalog.map((item) => [item.agent_name, item])),
    [catalog],
  );

  const cards = useMemo(() => {
    const source = [
      ...(defaultAgent ? [{ agent: defaultAgent, isDefault: true }] : []),
      ...agents.map((agent) => ({ agent, isDefault: false })),
    ];

    const normalizedSearch = searchTerm.trim().toLowerCase();

    return source.filter(({ agent, isDefault }) => {
      if (filter === "default" && !isDefault) {
        return false;
      }
      if (filter === "heartbeat" && !agent.heartbeat_enabled) {
        return false;
      }
      if (filter === "evolution" && !agent.evolution_enabled) {
        return false;
      }
      if (!normalizedSearch) {
        return true;
      }

      const catalogCard = catalogByName.get(agent.name);
      const haystack = [
        agent.name,
        agent.description,
        agent.model ?? "",
        (agent.tool_groups ?? []).join(" "),
        catalogCard?.capability_summary ?? "",
        catalogCard?.persona_summary ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(normalizedSearch);
    });
  }, [agents, catalogByName, defaultAgent, filter, searchTerm]);

  const isEmpty = cards.length === 0;

  return (
    <div className="flex size-full flex-col">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b px-6 py-4">
        <div>
          <h1 className="text-xl font-semibold">{t.agents.title}</h1>
          <p className="text-muted-foreground mt-0.5 text-sm">
            {t.agents.description}
          </p>
        </div>
        <Button onClick={handleNewAgent}>
          <PlusIcon className="mr-1.5 h-4 w-4" />
          {t.agents.newAgent}
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="mb-4 grid gap-2 sm:grid-cols-[1fr_200px]">
          <div className="relative">
            <SearchIcon className="text-muted-foreground pointer-events-none absolute top-2.5 left-3 h-4 w-4" />
            <Input
              className="pl-9"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder={t.agents.searchPlaceholder}
            />
          </div>
          <Select value={filter} onValueChange={(value) => setFilter(value as AgentFilter)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t.agents.filterAll}</SelectItem>
              <SelectItem value="default">{t.agents.filterDefault}</SelectItem>
              <SelectItem value="heartbeat">{t.agents.filterHeartbeat}</SelectItem>
              <SelectItem value="evolution">{t.agents.filterEvolution}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {isLoading || defaultAgentLoading ? (
          <div className="text-muted-foreground flex h-40 items-center justify-center text-sm">
            {t.common.loading}
          </div>
        ) : isEmpty ? (
          <div className="flex h-64 flex-col items-center justify-center gap-3 text-center">
            <div className="bg-muted flex h-14 w-14 items-center justify-center rounded-full">
              <BotIcon className="text-muted-foreground h-7 w-7" />
            </div>
            <div>
              <p className="font-medium">{t.agents.emptyTitle}</p>
              <p className="text-muted-foreground mt-1 text-sm">
                {t.agents.emptyDescription}
              </p>
            </div>
            <Button variant="outline" className="mt-2" onClick={handleNewAgent}>
              <PlusIcon className="mr-1.5 h-4 w-4" />
              {t.agents.newAgent}
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {cards.map(({ agent, isDefault }) => (
              <AgentCard
                key={agent.name}
                agent={agent}
                isDefault={isDefault}
                catalogCard={catalogByName.get(agent.name) ?? null}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
