"use client";

import { BotIcon } from "lucide-react";

import { type Agent } from "@/core/agents";
import { cn } from "@/lib/utils";

export function AgentWelcome({
  className,
  agent,
  agentName,
}: {
  className?: string;
  agent: Agent | null | undefined;
  agentName: string;
}) {
  const displayName = agent?.name ?? agentName;
  const description = agent?.description;

  return (
    <div
      className={cn(
        "mx-auto flex w-full flex-col items-center justify-center gap-4 px-4 text-center",
        className,
      )}
    >
      <div className="flex h-16 w-16 items-center justify-center rounded-[1.6rem] bg-[linear-gradient(180deg,rgba(233,248,239,0.96),rgba(214,239,223,0.9))] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_16px_38px_-24px_rgba(61,120,83,0.45)] ring-1 ring-emerald-700/8">
        <BotIcon className="text-emerald-700 h-7 w-7" />
      </div>
      <div className="text-[clamp(2.1rem,4vw,3.2rem)] font-semibold tracking-[-0.055em] text-balance text-foreground">
        {displayName}
      </div>
      {description ? (
        <p className="text-foreground/62 max-w-[40rem] text-[15px] leading-8 sm:text-base">
          {description}
        </p>
      ) : null}
    </div>
  );
}
