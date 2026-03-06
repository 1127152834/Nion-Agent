"use client";

import { FileTextIcon, RssIcon, RotateCcwIcon, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/core/i18n/hooks";
import type { RSSContextBlock } from "@/core/rss";
import { cn } from "@/lib/utils";

function truncate(value: string, max = 56) {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max)}...`;
}

function labelForBlock(block: RSSContextBlock) {
  switch (block.type) {
    case "mainEntry":
      return block.metadata?.title ?? block.value;
    case "mainFeed":
      return block.metadata?.title ?? block.value;
    case "selectedText":
      return truncate(block.value.replace(/\s+/g, " ").trim() || "选中文本");
    default:
      return block.value;
  }
}

function iconForBlock(block: RSSContextBlock) {
  switch (block.type) {
    case "mainEntry":
      return <FileTextIcon className="size-3.5" />;
    case "mainFeed":
      return <RssIcon className="size-3.5" />;
    case "selectedText":
      return <span className="text-xs font-semibold">“</span>;
    default:
      return null;
  }
}

export function AssistantContextBar({
  blocks,
  onRemoveSelectedText,
  onRestoreSelectedText,
  hasRestorableSelectedText,
  className,
}: {
  blocks: RSSContextBlock[];
  onRemoveSelectedText: () => void;
  onRestoreSelectedText: () => void;
  hasRestorableSelectedText: boolean;
  className?: string;
}) {
  const { t } = useI18n();

  return (
    <div
      className={cn(
        "bg-muted/40 flex items-center gap-2 overflow-x-auto border-b px-3 py-2",
        className,
      )}
    >
      {blocks.map((block) => (
        <div
          key={block.id}
          className={cn(
            "bg-background text-foreground flex max-w-[260px] shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs",
            block.type === "selectedText" && "border-primary/40 bg-primary/5",
          )}
          title={labelForBlock(block)}
        >
          {iconForBlock(block)}
          <span className="truncate">{labelForBlock(block)}</span>
          {block.type === "selectedText" && (
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground inline-flex items-center"
              onClick={onRemoveSelectedText}
              aria-label="移除选中文本上下文"
            >
              <XIcon className="size-3.5" />
            </button>
          )}
        </div>
      ))}

      {hasRestorableSelectedText && (
        <Button
          size="sm"
          variant="ghost"
          className="h-7 shrink-0 px-2 text-xs"
          onClick={onRestoreSelectedText}
        >
          <RotateCcwIcon className="size-3.5" />
          {t.rssReader.assistantRestoreSelection}
        </Button>
      )}
    </div>
  );
}
