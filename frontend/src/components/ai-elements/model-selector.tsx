import { CheckIcon } from "lucide-react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { ComponentProps, ReactNode } from "react";

export type ModelSelectorProps = ComponentProps<typeof Popover>;

export const ModelSelector = (props: ModelSelectorProps) => (
  <Popover {...props} />
);

export type ModelSelectorTriggerProps = ComponentProps<typeof PopoverTrigger>;

export const ModelSelectorTrigger = (props: ModelSelectorTriggerProps) => (
  <PopoverTrigger {...props} />
);

export type ModelSelectorContentProps = ComponentProps<typeof PopoverContent> & {
  title?: ReactNode;
  align?: "start" | "center" | "end";
};

export const ModelSelectorContent = ({
  className,
  children,
  title = "Model Selector",
  align = "center",
  sideOffset = 8,
  ...props
}: ModelSelectorContentProps) => (
  <PopoverContent
    className={cn(
      "bg-popover/95 text-popover-foreground w-72 overflow-hidden rounded-xl border-0 p-0 shadow-lg backdrop-blur-sm",
      className
    )}
    align={align}
    sideOffset={sideOffset}
    {...props}
  >
    <Command
      className={cn(
        "border-0 bg-transparent",
        "[&_[data-slot=command-input-wrapper]]:h-auto",
        "[&_[data-slot=command-input-wrapper]]:border-0",
        "[&_[data-slot=command-input-wrapper]]:gap-0",
        "[&_[data-slot=command-input-wrapper]]:px-3",
        "[&_[data-slot=command-input-wrapper]]:py-2",
        "[&_[data-slot=command-input-wrapper]_svg]:hidden",
        "[&_[data-slot=command-input]]:bg-background",
        "[&_[data-slot=command-input]]:h-10",
        "[&_[data-slot=command-input]]:rounded-md",
        "[&_[data-slot=command-input]]:border",
        "[&_[data-slot=command-input]]:border-border",
        "[&_[data-slot=command-input]]:px-3",
        "[&_[data-slot=command-input]]:py-2",
        "[&_[data-slot=command-input]]:pl-3",
      )}
    >
      {children}
    </Command>
  </PopoverContent>
);

export type ModelSelectorDialogProps = ComponentProps<typeof Command>;

export const ModelSelectorDialog = (props: ModelSelectorDialogProps) => (
  <Command {...props} />
);

export type ModelSelectorInputProps = ComponentProps<typeof CommandInput>;

export const ModelSelectorInput = ({
  className,
  ...props
}: ModelSelectorInputProps) => (
  <CommandInput
    className={cn(
      "text-foreground placeholder:text-muted-foreground text-sm",
      "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden",
      className
    )}
    {...props}
  />
);

export type ModelSelectorListProps = ComponentProps<typeof CommandList>;

export const ModelSelectorList = (props: ModelSelectorListProps) => (
  <CommandList
    className="max-h-[300px] overflow-y-auto p-1"
    {...props}
  />
);

export type ModelSelectorEmptyProps = ComponentProps<typeof CommandEmpty>;

export const ModelSelectorEmpty = (props: ModelSelectorEmptyProps) => (
  <CommandEmpty
    className="text-muted-foreground px-3 py-2 text-xs"
    {...props}
  />
);

export type ModelSelectorGroupProps = ComponentProps<typeof CommandGroup>;

export const ModelSelectorGroup = (props: ModelSelectorGroupProps) => (
  <CommandGroup className="p-0" {...props} />
);

export type ModelSelectorItemProps = ComponentProps<typeof CommandItem>;

export const ModelSelectorItem = ({
  className,
  children,
  ...props
}: ModelSelectorItemProps) => (
  <CommandItem
    className={cn(
      "relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm",
      "outline-hidden select-none",
      "hover:bg-accent/60 data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground",
      "data-[disabled=true]:opacity-50 data-[disabled=true]:pointer-events-none",
      className
    )}
    {...props}
  >
    {children}
  </CommandItem>
);

export type ModelSelectorShortcutProps = ComponentProps<"span">;

export const ModelSelectorShortcut = ({
  className,
  ...props
}: ModelSelectorShortcutProps) => (
  <span
    className={cn(
      "text-muted-foreground ml-auto text-xs",
      className
    )}
    {...props}
  />
);

export type ModelSelectorSeparatorProps = ComponentProps<
  typeof CommandSeparator
>;

export const ModelSelectorSeparator = (props: ModelSelectorSeparatorProps) => (
  <CommandSeparator className="bg-border my-1 h-px" {...props} />
);

// Group title component
export const ModelSelectorGroupTitle = ({
  className,
  children,
  ...props
}: ComponentProps<"div">) => (
  <div
    className={cn(
      "px-2 py-1 text-xs font-medium",
      "text-muted-foreground",
      className
    )}
    {...props}
  >
    {children}
  </div>
);

export type ModelSelectorLogoProps = Omit<
  ComponentProps<"img">,
  "src" | "alt"
> & {
  provider: string;
};

export const ModelSelectorLogo = ({
  provider,
  className,
  ...props
}: ModelSelectorLogoProps) => (
  <img
    {...props}
    alt={`${provider} logo`}
    className={cn(
      "size-5 shrink-0 rounded-md",
      "bg-white dark:bg-zinc-800",
      "p-0.5",
      className
    )}
    height={20}
    src={`https://models.dev/logos/${provider}.svg`}
    width={20}
  />
);

export type ModelSelectorLogoGroupProps = ComponentProps<"div">;

export const ModelSelectorLogoGroup = ({
  className,
  ...props
}: ModelSelectorLogoGroupProps) => (
  <div
    className={cn(
      "flex shrink-0 items-center -space-x-1.5",
      className,
    )}
    {...props}
  />
);

export type ModelSelectorNameProps = ComponentProps<"span">;

export const ModelSelectorName = ({
  className,
  ...props
}: ModelSelectorNameProps) => (
  <span
    className={cn(
      "flex-1 truncate text-sm font-medium",
      "text-foreground",
      className
    )}
    {...props}
  />
);

// Selected-state indicator
export const ModelSelectorCheck = ({
  className,
  ...props
}: ComponentProps<"span">) => (
  <span
    className={cn(
      "ml-auto flex items-center justify-center",
      "text-foreground",
      className
    )}
    {...props}
  >
    <CheckIcon className="size-4" />
  </span>
);
