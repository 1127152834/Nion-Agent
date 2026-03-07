"use client";

import { CompassIcon, RssIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { useI18n } from "@/core/i18n/hooks";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/workspace/rss/discover", key: "discover" },
  { href: "/workspace/rss/subscriptions", key: "subscriptions" },
] as const;

export function RSSNavTabs({ className }: { className?: string }) {
  const pathname = usePathname();
  const { t } = useI18n();

  const activeKey = pathname.startsWith("/workspace/rss/discover")
    ? "discover"
    : "subscriptions";

  const activeDescription =
    activeKey === "discover"
      ? t.rssReader.discoverNavDescription
      : t.rssReader.subscriptionsNavDescription;

  return (
    <div className={cn("border-b px-4 py-3", className)}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="bg-background/75 inline-flex items-center rounded-2xl border p-1 shadow-xs backdrop-blur">
          {NAV_ITEMS.map((item) => {
            const active =
              item.key === "discover"
                ? pathname.startsWith("/workspace/rss/discover")
                : pathname.startsWith("/workspace/rss/subscriptions") ||
                  pathname.startsWith("/workspace/rss/entries");
            const label =
              item.key === "discover"
                ? t.rssReader.discoverTitle
                : t.rssReader.subscriptionsNavTitle;
            const Icon = item.key === "discover" ? CompassIcon : RssIcon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "inline-flex h-9 items-center gap-2 rounded-xl px-3 text-sm font-medium transition",
                  active
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                )}
              >
                <Icon className="size-4" />
                {label}
              </Link>
            );
          })}
        </div>

        <p className="text-muted-foreground text-xs">{activeDescription}</p>
      </div>
    </div>
  );
}
