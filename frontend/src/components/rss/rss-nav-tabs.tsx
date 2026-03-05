"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/core/i18n/hooks";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/workspace/rss/discover", key: "discover" },
  { href: "/workspace/rss/entries", key: "entries" },
] as const;

export function RSSNavTabs({ className }: { className?: string }) {
  const pathname = usePathname();
  const { t } = useI18n();

  return (
    <div className={cn("flex items-center gap-2 border-b px-4 py-2", className)}>
      {NAV_ITEMS.map((item) => {
        const active = pathname.startsWith(item.href);
        const label =
          item.key === "discover"
            ? t.rssReader.discoverTitle
            : t.rssReader.entries;
        return (
          <Button
            key={item.href}
            asChild
            size="sm"
            variant={active ? "default" : "ghost"}
            className="rounded-full"
          >
            <Link href={item.href}>{label}</Link>
          </Button>
        );
      })}
    </div>
  );
}
