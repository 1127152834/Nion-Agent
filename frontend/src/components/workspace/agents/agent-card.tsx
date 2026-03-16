"use client";

import {
  ActivityIcon,
  BrainIcon,
  MessageSquareIcon,
  OrbitIcon,
  SparklesIcon,
  SettingsIcon,
  Trash2Icon,
  WrenchIcon,
} from "lucide-react";
import { useState } from "react";
import type { ComponentType } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useDeleteAgent } from "@/core/agents";
import type { Agent } from "@/core/agents";
import { useI18n } from "@/core/i18n/hooks";
import type { AgentDirectoryCard } from "@/core/memory/types";
import { useAppRouter as useRouter } from "@/core/navigation";
import { cn } from "@/lib/utils";

import { AgentAvatarEditor } from "./agent-avatar-editor";

interface AgentCardProps {
  agent: Agent;
  isDefault?: boolean;
  catalogCard?: AgentDirectoryCard | null;
}

interface SignalIndicatorProps {
  title: string;
  active: boolean;
  tone?: "ok" | "warn";
  icon: ComponentType<{ className?: string }>;
}

function SignalIndicator({ title, active, tone = "ok", icon: Icon }: SignalIndicatorProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="text-muted-foreground inline-flex h-7 items-center gap-1.5 rounded-full border border-border/80 bg-background/90 px-2.5">
          <Icon className="size-3.5" />
          <span
            className={cn(
              "relative size-2 shrink-0 rounded-full",
              active && tone === "ok" ? "bg-emerald-500" : "",
              active && tone === "warn" ? "bg-amber-500" : "",
              !active ? "bg-muted-foreground/65" : "",
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                "pointer-events-none absolute -inset-0.5 rounded-full blur-[2px]",
                active && tone === "ok" ? "bg-emerald-500/55 animate-signal-breathe" : "",
                active && tone === "warn" ? "bg-amber-500/45" : "",
                !active ? "bg-muted-foreground/22" : "",
              )}
            />
          </span>
        </span>
      </TooltipTrigger>
      <TooltipContent>{title}</TooltipContent>
    </Tooltip>
  );
}

export function AgentCard({ agent, isDefault = false, catalogCard = null }: AgentCardProps) {
  const { t } = useI18n();
  const router = useRouter();
  const deleteAgent = useDeleteAgent();
  const [deleteOpen, setDeleteOpen] = useState(false);

  const heartbeatEnabled = agent.heartbeat_enabled ?? false;
  const evolutionEnabled = agent.evolution_enabled ?? false;
  const toolGroupCount = agent.tool_groups?.length ?? 0;
  const trimmedDisplayName = agent.display_name?.trim();
  const agentDisplayName = agent.name === "_default"
    ? t.agents.picker.defaultAgentName
    : trimmedDisplayName && trimmedDisplayName.length > 0 ? trimmedDisplayName : agent.name;
  const memoryOverview = catalogCard?.capability_summary ?? catalogCard?.persona_summary ?? t.agents.noMemoryOverview;

  function handleChat() {
    if (isDefault) {
      router.push("/workspace/chats/new");
      return;
    }
    router.push(`/workspace/agents/${encodeURIComponent(agent.name)}/chats/new`);
  }

  function handleMemory() {
    router.push(`/workspace/agents/${encodeURIComponent(agent.name)}/settings?section=memory`);
  }

  function handleSettings() {
    router.push(`/workspace/agents/${encodeURIComponent(agent.name)}/settings`);
  }

  function handleBootstrap() {
    router.push("/workspace/agents/bootstrap");
  }

  async function handleDelete() {
    try {
      await deleteAgent.mutateAsync(agent.name);
      toast.success(t.agents.deleteSuccess);
      setDeleteOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <>
      <Card className="group relative flex flex-col overflow-hidden rounded-3xl border-border/80 bg-card/95 shadow-[0_14px_30px_-26px_rgba(35,30,24,0.5)] transition-all hover:-translate-y-0.5 hover:border-border hover:shadow-[0_20px_40px_-28px_rgba(35,30,24,0.62)]">
        <svg
          viewBox="0 0 160 160"
          fill="none"
          className="text-muted-foreground/60 pointer-events-none absolute -top-8 -right-8 h-44 w-44"
          aria-hidden="true"
        >
          <path d="M22 73c26-32 87-39 112-8" stroke="currentColor" strokeWidth="1.2" />
          <path d="M18 91c31-22 85-18 124 6" stroke="currentColor" strokeWidth="1.2" />
          <circle cx="118" cy="44" r="20" stroke="currentColor" strokeWidth="1" />
        </svg>

        <CardHeader className="relative p-5 pb-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3">
              <AgentAvatarEditor
                agentName={agent.name}
                isDefault={isDefault}
                avatarUrl={agent.avatar_url}
                fallbackLabel={agentDisplayName}
              />
              <div className="min-w-0">
                <CardTitle className="truncate text-[17px] leading-tight">{agentDisplayName}</CardTitle>
                <div className="mt-1.5 flex min-h-5 items-center gap-2">
                  {isDefault ? (
                    <span className="rounded-full border border-border/80 bg-muted/60 px-2 py-0.5 text-[11px] text-muted-foreground">
                      {t.agents.defaultBadge}
                    </span>
                  ) : null}
                  {agent.model ? (
                    <span className="text-muted-foreground truncate text-xs">{agent.model}</span>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
              <SignalIndicator
                icon={ActivityIcon}
                active={heartbeatEnabled}
                title={heartbeatEnabled ? t.agents.heartbeatOn : t.agents.heartbeatOff}
              />
              <SignalIndicator
                icon={OrbitIcon}
                active={evolutionEnabled}
                title={evolutionEnabled ? t.agents.evolutionOn : t.agents.evolutionOff}
              />
              <SignalIndicator
                icon={WrenchIcon}
                active={toolGroupCount > 0}
                tone="warn"
                title={toolGroupCount > 0
                  ? t.agents.status.toolGroupsConfigured.replace("{count}", String(toolGroupCount))
                  : t.agents.status.toolGroupsEmpty}
              />
            </div>
          </div>

          <CardDescription className="mt-3 line-clamp-2 text-[13.5px] leading-6">
            {agent.description || t.agents.picker.noDescription}
          </CardDescription>
        </CardHeader>

        <CardContent className="px-5 pt-0 pb-3">
          <div className="rounded-xl border border-dashed border-border/90 bg-muted/25 px-3 py-2">
            <p className="text-foreground text-xs font-medium">{t.agents.memoryOverview}</p>
            <p className="text-muted-foreground mt-1 line-clamp-2 text-xs leading-5">{memoryOverview}</p>
          </div>
        </CardContent>

        <CardFooter className="mt-auto flex items-center gap-2 px-5 pb-5 pt-1">
          <Button size="sm" className="h-8 flex-1 rounded-xl" onClick={handleChat}>
            <MessageSquareIcon className="mr-1.5 size-3.5" />
            {t.agents.chat}
          </Button>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="icon" variant="outline" className="size-8 rounded-xl" onClick={handleMemory}>
                <BrainIcon className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t.agents.viewMemory}</TooltipContent>
          </Tooltip>

          {isDefault ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant="outline"
                  className="size-8 rounded-xl"
                  onClick={handleBootstrap}
                >
                  <SparklesIcon className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t.agents.bootstrap.tooltip}</TooltipContent>
            </Tooltip>
          ) : null}

          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="icon" variant="outline" className="size-8 rounded-xl" onClick={handleSettings}>
                <SettingsIcon className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t.agents.picker.settingsTooltip}</TooltipContent>
          </Tooltip>

          {isDefault ? null : (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant="outline"
                  className="text-destructive size-8 rounded-xl"
                  onClick={() => setDeleteOpen(true)}
                >
                  <Trash2Icon className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t.agents.delete}</TooltipContent>
            </Tooltip>
          )}
        </CardFooter>
      </Card>

      <Dialog open={!isDefault && deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.agents.delete}</DialogTitle>
            <DialogDescription>{t.agents.deleteConfirm}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)} disabled={deleteAgent.isPending}>
              {t.common.cancel}
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleteAgent.isPending}>
              {deleteAgent.isPending ? t.common.loading : t.common.delete}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
