"use client"

import * as React from "react"
import * as SwitchPrimitive from "@radix-ui/react-switch"

import { cn } from "@/lib/utils"

function Switch({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer inline-flex h-6 w-10 shrink-0 items-center rounded-full border border-border/70 bg-muted/75 p-0.5 shadow-[inset_0_1px_2px_hsl(var(--foreground)/0.08)] transition-[background-color,border-color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/35 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-primary/30 data-[state=checked]:bg-primary data-[state=checked]:shadow-[inset_0_0_0_1px_hsl(var(--background)/0.08),0_10px_24px_-18px_hsl(var(--foreground)/0.55)] dark:bg-input/70 dark:data-[state=checked]:border-primary/40",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "pointer-events-none block size-5 rounded-full bg-background shadow-[0_1px_2px_hsl(var(--foreground)/0.12),0_8px_18px_-12px_hsl(var(--foreground)/0.45)] ring-0 transition-transform duration-200 data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0 dark:bg-card dark:data-[state=checked]:bg-primary-foreground"
        )}
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
