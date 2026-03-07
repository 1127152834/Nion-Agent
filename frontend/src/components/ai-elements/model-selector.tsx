import { SearchIcon, CheckIcon } from "lucide-react";
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
      "p-0 overflow-hidden",
      className
    )}
    align={align}
    sideOffset={sideOffset}
    {...props}
  >
    <Command className="border-0 bg-transparent">
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
  <div className="relative flex items-center border-b border-zinc-100 dark:border-zinc-800">
    <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-zinc-400" />
    <CommandInput
      className={cn(
        // 简洁搜索框
        "h-10 pl-9 pr-3",
        "bg-transparent",
        "text-sm text-zinc-900 dark:text-zinc-100",
        "placeholder:text-zinc-400",
        "border-0 outline-none ring-0",
        "focus:ring-0 focus:outline-none",
        "rounded-none",
        className
      )}
      {...props}
    />
  </div>
);

export type ModelSelectorListProps = ComponentProps<typeof CommandList>;

export const ModelSelectorList = (props: ModelSelectorListProps) => (
  <CommandList
    className="max-h-[300px] overflow-y-auto"
    {...props}
  />
);

export type ModelSelectorEmptyProps = ComponentProps<typeof CommandEmpty>;

export const ModelSelectorEmpty = (props: ModelSelectorEmptyProps) => (
  <CommandEmpty
    className="py-8 text-center text-sm text-zinc-500 dark:text-zinc-400"
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
      // 简洁列表项
      "relative flex items-center gap-3",
      "px-3 py-2",
      "cursor-pointer select-none",
      "text-sm text-zinc-700 dark:text-zinc-300",
      // 悬停状态
      "hover:bg-zinc-100 dark:hover:bg-zinc-800",
      // 选中状态
      "data-[selected=true]:bg-zinc-100 dark:data-[selected=true]:bg-zinc-800",
      "data-[selected=true]:text-zinc-900 dark:data-[selected=true]:text-zinc-100",
      // 聚焦状态
      "focus:bg-zinc-100 dark:focus:bg-zinc-800",
      "focus:outline-none",
      // 禁用状态
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
      "ml-auto text-xs text-zinc-400 dark:text-zinc-500",
      className
    )}
    {...props}
  />
);

export type ModelSelectorSeparatorProps = ComponentProps<
  typeof CommandSeparator
>;

export const ModelSelectorSeparator = (props: ModelSelectorSeparatorProps) => (
  <CommandSeparator className="my-1 h-px bg-zinc-100 dark:bg-zinc-800" {...props} />
);

// 分组标题组件
export const ModelSelectorGroupTitle = ({
  className,
  children,
  ...props
}: ComponentProps<"div">) => (
  <div
    className={cn(
      "px-3 py-1.5 text-xs font-medium",
      "text-zinc-500 dark:text-zinc-400",
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
      "text-zinc-900 dark:text-zinc-100",
      className
    )}
    {...props}
  />
);

// 选中指示器
export const ModelSelectorCheck = ({
  className,
  ...props
}: ComponentProps<"span">) => (
  <span
    className={cn(
      "ml-auto flex items-center justify-center",
      "text-zinc-900 dark:text-zinc-100",
      className
    )}
    {...props}
  >
    <CheckIcon className="size-4" />
  </span>
);
