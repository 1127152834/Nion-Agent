"use client";

import { BotIcon, BrainIcon, MessageSquareIcon, SettingsIcon, Trash2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useDeleteAgent } from "@/core/agents";
import type { Agent } from "@/core/agents";
import { useI18n } from "@/core/i18n/hooks";
import type { AgentDirectoryCard } from "@/core/memory/types";

interface AgentCardProps {
  agent: Agent;
  isDefault?: boolean;
  catalogCard?: AgentDirectoryCard | null;
}

export function AgentCard({ agent, isDefault = false, catalogCard = null }: AgentCardProps) {
  const { t } = useI18n();
  const router = useRouter();
  const deleteAgent = useDeleteAgent();
  const [deleteOpen, setDeleteOpen] = useState(false);

  const heartbeatEnabled = agent.heartbeat_enabled;
  const evolutionEnabled = agent.evolution_enabled;
  const agentDisplayName = agent.name === "_default" ? t.agents.picker.defaultAgentName : agent.name;

  function handleChat() {
    if (isDefault) {
      router.push("/workspace/chats/new");
      return;
    }
    router.push(`/workspace/agents/${agent.name}/chats/new`);
  }

  function handleMemory() {
    router.push(`/workspace/agents/${encodeURIComponent(agent.name)}/settings?section=memory`);
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

  const cardClassName = isDefault
    ? "group flex h-full flex-col rounded-2xl border-primary/30 bg-gradient-to-br from-primary/10 via-primary/5 to-background transition-all hover:-translate-y-0.5 hover:shadow-md"
    : "group flex h-full flex-col rounded-2xl border transition-all hover:-translate-y-0.5 hover:shadow-md";

  return (
    <>
      <Card className={cardClassName}>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 items-center gap-3">
              <div className="bg-primary/12 text-primary flex h-10 w-10 shrink-0 items-center justify-center rounded-xl">
                <BotIcon className="h-5 w-5" />
              </div>
              <div className="min-w-0 space-y-1">
                <CardTitle className="truncate text-base">{agentDisplayName}</CardTitle>
                <div className="flex flex-wrap gap-1">
                  {isDefault ? (
                    <Badge variant="outline" className="text-[11px]">
                      {t.agents.defaultBadge}
                    </Badge>
                  ) : null}
                  {agent.model ? (
                    <Badge variant="secondary" className="text-[11px]">
                      {agent.model}
                    </Badge>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
          <CardDescription className="line-clamp-2 min-h-10 text-sm leading-5">
            {agent.description || t.agents.picker.noDescription}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-3 pt-0 pb-3">
          <div className="flex flex-wrap gap-1">
            {agent.tool_groups && agent.tool_groups.length > 0 ? (
              <>
                {agent.tool_groups.slice(0, 3).map((group) => (
                  <Badge key={group} variant="outline" className="text-[11px]">
                    {group}
                  </Badge>
                ))}
                {agent.tool_groups.length > 3 ? (
                  <Badge variant="outline" className="text-[11px]">+{agent.tool_groups.length - 3}</Badge>
                ) : null}
              </>
            ) : (
              <span className="text-muted-foreground text-xs">{t.agents.noToolGroups}</span>
            )}
          </div>

          {catalogCard ? (
            <div className="rounded-lg border bg-muted/30 p-2">
              <p className="text-xs font-medium">{t.agents.catalogSummary}</p>
              <p className="text-muted-foreground mt-1 line-clamp-2 text-xs leading-5">
                {catalogCard.capability_summary || catalogCard.persona_summary || t.agents.picker.noDescription}
              </p>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-1">
            {typeof heartbeatEnabled === "boolean" ? (
              <Badge variant={heartbeatEnabled ? "secondary" : "outline"} className="text-[11px]">
                {heartbeatEnabled ? t.agents.heartbeatOn : t.agents.heartbeatOff}
              </Badge>
            ) : null}
            {typeof evolutionEnabled === "boolean" ? (
              <Badge variant={evolutionEnabled ? "secondary" : "outline"} className="text-[11px]">
                {evolutionEnabled ? t.agents.evolutionOn : t.agents.evolutionOff}
              </Badge>
            ) : null}
          </div>
        </CardContent>

        <CardFooter className="mt-auto grid grid-cols-2 gap-2 pt-1">
          <Button size="sm" className="col-span-2" onClick={handleChat}>
            <MessageSquareIcon className="mr-1.5 h-3.5 w-3.5" />
            {t.agents.chat}
          </Button>
          <Button size="sm" variant="outline" onClick={handleMemory}>
            <BrainIcon className="mr-1.5 h-3.5 w-3.5" />
            {t.agents.viewMemory}
          </Button>
          <div className="flex items-center justify-end gap-1">
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8 shrink-0"
              onClick={() => router.push(`/workspace/agents/${agent.name}/settings`)}
              title={t.agents.picker.settingsTooltip}
            >
              <SettingsIcon className="h-3.5 w-3.5" />
            </Button>
            {isDefault ? null : (
              <Button
                size="icon"
                variant="ghost"
                className="text-destructive hover:text-destructive h-8 w-8 shrink-0"
                onClick={() => setDeleteOpen(true)}
                title={t.agents.delete}
              >
                <Trash2Icon className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </CardFooter>
      </Card>

      <Dialog open={!isDefault && deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.agents.delete}</DialogTitle>
            <DialogDescription>{t.agents.deleteConfirm}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteOpen(false)}
              disabled={deleteAgent.isPending}
            >
              {t.common.cancel}
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleteAgent.isPending}
            >
              {deleteAgent.isPending ? t.common.loading : t.common.delete}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
