"use client";

import { BotIcon, CircleCheckIcon } from "lucide-react";
import { useRouter } from "next/navigation";

import { useAgents, useDefaultAgentConfig } from "@/core/agents";
import { useI18n } from "@/core/i18n/hooks";
import { cn } from "@/lib/utils";

interface AgentPickerCardsProps {
  selectedAgentName: string;
  className?: string;
}

function routeOfAgent(agentName: string): string {
  if (agentName === "_default") {
    return "/workspace/chats/new";
  }
  return `/workspace/agents/${agentName}/chats/new`;
}

export function AgentPickerCards({
  selectedAgentName,
  className,
}: AgentPickerCardsProps) {
  const { t } = useI18n();
  const pickerCopy = t.agents.picker;
  const router = useRouter();
  const { config: defaultAgent } = useDefaultAgentConfig();
  const { agents } = useAgents();

  const cards = [
    ...(defaultAgent ? [defaultAgent] : []),
    ...agents,
  ];

  if (cards.length === 0) {
    return null;
  }

  return (
    <div className={cn("w-full max-w-[860px]", className)}>
      <p className="text-muted-foreground mb-3 text-center text-xs">{pickerCopy.selectAgent}</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((agent) => {
          const selected = agent.name === selectedAgentName;
          return (
            <button
              key={agent.name}
              type="button"
              onClick={() => router.push(routeOfAgent(agent.name))}
              className={cn(
                "group rounded-xl border bg-background/80 px-4 py-3 text-left transition-all",
                "hover:border-primary/40 hover:bg-primary/5",
                selected
                  ? "border-primary/60 ring-primary/30 ring-2"
                  : "border-border",
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <div className="bg-primary/10 text-primary flex size-7 shrink-0 items-center justify-center rounded-md">
                    <BotIcon className="size-4" />
                  </div>
                  <p className="truncate text-sm font-medium">
                    {agent.name === "_default" ? pickerCopy.defaultAgentName : agent.name}
                  </p>
                </div>
                {selected ? (
                  <CircleCheckIcon className="text-primary mt-0.5 size-4 shrink-0" />
                ) : null}
              </div>
              <p className="text-muted-foreground mt-2 line-clamp-2 text-xs">
                {agent.description || (agent.name === "_default" ? pickerCopy.defaultAgentDescription : pickerCopy.noDescription)}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
