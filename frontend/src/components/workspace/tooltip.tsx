"use client";

import {
  Tooltip as TooltipPrimitive,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export function Tooltip({
  children,
  content,
  contentClassName,
  side,
  align,
  sideOffset,
  delayDuration,
  ...props
}: {
  children: React.ReactNode;
  content?: React.ReactNode;
  contentClassName?: string;
  side?: React.ComponentProps<typeof TooltipContent>["side"];
  align?: React.ComponentProps<typeof TooltipContent>["align"];
  sideOffset?: number;
  delayDuration?: number;
}) {
  return (
    <TooltipPrimitive delayDuration={delayDuration ?? 500} {...props}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent
        side={side}
        align={align}
        sideOffset={sideOffset}
        className={cn(contentClassName)}
      >
        {content}
      </TooltipContent>
    </TooltipPrimitive>
  );
}
