"use client";

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function NewChatStage({
  hero,
  controls,
  composer,
  footer,
  className,
}: {
  hero: ReactNode;
  controls?: ReactNode;
  composer?: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "relative mx-auto flex w-full max-w-[960px] flex-col items-center px-4 sm:px-8",
        className,
      )}
    >
      <div className="pointer-events-none absolute inset-x-[14%] top-10 h-28 rounded-full bg-[radial-gradient(circle_at_center,rgba(152,209,176,0.22),rgba(152,209,176,0.08)_32%,transparent_72%)] blur-3xl" />
      <div className="pointer-events-none absolute inset-x-[24%] top-2 h-px bg-gradient-to-r from-transparent via-foreground/10 to-transparent" />
      <div className="pointer-events-none absolute inset-x-[30%] top-30 h-20 rounded-full bg-[radial-gradient(circle_at_center,rgba(215,188,145,0.18),transparent_74%)] blur-2xl" />

      <div className="relative z-10 flex w-full flex-col items-center gap-8 sm:gap-10">
        <div className="w-full max-w-[720px]">{hero}</div>
        {controls ? (
          <div className="flex w-full justify-center pt-1 sm:pt-2">{controls}</div>
        ) : null}
        {composer ? <div className="w-full max-w-[840px] pt-1 sm:pt-2">{composer}</div> : null}
        {footer ? <div className="pt-6 text-center sm:pt-8">{footer}</div> : null}
      </div>
    </section>
  );
}
