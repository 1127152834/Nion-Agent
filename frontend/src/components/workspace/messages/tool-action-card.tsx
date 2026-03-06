"use client";

import { ArrowUpRightIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ToolAction = {
  kind?: string;
  label: string;
  href?: string;
};

export type ToolActionCardPayload = {
  type: string;
  status?: string;
  title: string;
  description?: string;
  actions?: ToolAction[];
};

function statusClass(status: string | undefined): string {
  if (status === "success") return "border-emerald-200 bg-emerald-50";
  if (status === "warning") return "border-amber-200 bg-amber-50";
  if (status === "error") return "border-red-200 bg-red-50";
  return "border-muted bg-background";
}

export function ToolActionCard({ card }: { card: ToolActionCardPayload }) {
  return (
    <div className={cn("rounded-md border p-3 text-sm", statusClass(card.status))}>
      <div className="font-medium">{card.title}</div>
      {card.description ? (
        <div className="text-muted-foreground mt-1 whitespace-pre-wrap text-xs">
          {card.description}
        </div>
      ) : null}
      {card.actions && card.actions.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {card.actions.map((action, index) => {
            if (action.kind === "link" && action.href) {
              return (
                <Button key={`${action.label}-${index}`} size="sm" asChild>
                  <a href={action.href}>
                    {action.label}
                    <ArrowUpRightIcon className="ml-1 size-3.5" />
                  </a>
                </Button>
              );
            }
            return (
              <Button
                key={`${action.label}-${index}`}
                size="sm"
                variant="outline"
                disabled
              >
                {action.label}
              </Button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

