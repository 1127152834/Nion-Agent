"use client";

import { BotIcon, PlusIcon, SearchIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAgents, useDefaultAgentConfig } from "@/core/agents";
import { useI18n } from "@/core/i18n/hooks";
import { useMemoryCatalog } from "@/core/memory/hooks";
import { useAppRouter as useRouter } from "@/core/navigation";

import { AgentCard } from "./agent-card";

export function AgentGallery() {
  const { t } = useI18n();
  const { agents, isLoading } = useAgents();
  const { config: defaultAgent, isLoading: defaultAgentLoading } = useDefaultAgentConfig();
  const { catalog } = useMemoryCatalog();
  const router = useRouter();

  const [searchTerm, setSearchTerm] = useState("");

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
    return source.filter(({ agent }) => {
      if (!normalizedSearch) {
        return true;
      }
      const catalogCard = catalogByName.get(agent.name);
      const haystack = [
        agent.name,
        agent.display_name ?? "",
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
  }, [agents, catalogByName, defaultAgent, searchTerm]);

  const isEmpty = cards.length === 0;

  return (
    <div className="flex size-full flex-col">
      <div className="border-b px-6 py-5">
        <section className="relative overflow-hidden rounded-3xl border border-border/80 bg-card/80 px-6 py-6 shadow-[0_20px_45px_-38px_rgba(38,32,26,0.52)]">
          <div className="pointer-events-none absolute -top-24 -right-24 size-72 rounded-full bg-gradient-to-b from-primary/10 to-transparent" />
          <div className="pointer-events-none absolute -left-32 -bottom-32 size-80 rounded-full bg-gradient-to-tr from-muted/70 to-transparent" />

          <div className="relative flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">{t.agents.title}</h1>
              <p className="text-muted-foreground mt-1.5 text-sm">{t.agents.description}</p>
            </div>
            <Button className="rounded-full px-4" onClick={handleNewAgent}>
              <PlusIcon className="mr-1.5 size-4" />
              {t.agents.newAgent}
            </Button>
          </div>

          <div className="relative mt-6 grid gap-2 lg:grid-cols-[1fr_auto]">
            <div className="relative">
              <SearchIcon className="text-muted-foreground pointer-events-none absolute top-3 left-3.5 size-4" />
              <Input
                className="h-11 rounded-xl pl-10"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder={t.agents.searchPlaceholder}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="text-muted-foreground inline-flex h-11 items-center rounded-full border border-border/80 bg-background/80 px-4 text-xs">
                {t.agents.totalCount.replace("{count}", String(cards.length))}
              </span>
            </div>
          </div>
        </section>
      </div>

      <div className="flex-1 overflow-y-auto px-6 pb-6 pt-5">
        {isLoading || defaultAgentLoading ? (
          <div className="text-muted-foreground flex h-40 items-center justify-center text-sm">
            {t.common.loading}
          </div>
        ) : isEmpty ? (
          <div className="flex h-64 flex-col items-center justify-center gap-3 rounded-2xl border border-dashed text-center">
            <div className="bg-muted flex size-14 items-center justify-center rounded-full">
              <BotIcon className="text-muted-foreground size-7" />
            </div>
            <div>
              <p className="font-medium">{t.agents.emptyTitle}</p>
              <p className="text-muted-foreground mt-1 text-sm">{t.agents.emptyDescription}</p>
            </div>
            <Button variant="outline" className="mt-2 rounded-full" onClick={handleNewAgent}>
              <PlusIcon className="mr-1.5 size-4" />
              {t.agents.newAgent}
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 items-start gap-5 md:grid-cols-2 xl:grid-cols-3">
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
