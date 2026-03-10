"use client";

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function WorkbenchSlotShell({
  title,
  subtitle,
  actions,
  children,
  className,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("flex h-full min-h-0 flex-col", className)}>
      <header className="bg-muted/30 flex items-start justify-between gap-3 border-b px-3 py-2">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-medium">{title}</h3>
          {subtitle ? (
            <p className="text-muted-foreground mt-0.5 line-clamp-2 text-xs">{subtitle}</p>
          ) : null}
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </header>
      <div className="min-h-0 flex-1">{children}</div>
    </section>
  );
}
