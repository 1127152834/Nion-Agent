"use client";

import { ArrowRightIcon, CompassIcon, RssIcon } from "lucide-react";
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

  return (
    <div className={cn("border-b px-4 py-3", className)}>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
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
        const description =
          item.key === "discover"
            ? t.rssReader.discoverNavDescription
            : t.rssReader.subscriptionsNavDescription;
        const Icon = item.key === "discover" ? CompassIcon : RssIcon;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "group flex items-center justify-between rounded-xl border px-3 py-2 transition-colors",
              active
                ? "border-primary bg-primary/5"
                : "hover:bg-accent/50 border-border bg-background",
            )}
          >
            <span className="flex items-center gap-3">
              <span
                className={cn(
                  "inline-flex size-8 items-center justify-center rounded-lg border",
                  active
                    ? "border-primary/40 bg-primary/10"
                    : "border-border bg-muted/20",
                )}
              >
                <Icon className="size-4" />
              </span>
              <span className="space-y-0.5">
                <span className="block text-sm font-semibold">{label}</span>
                <span className="text-muted-foreground block text-xs">
                  {description}
                </span>
              </span>
            </span>
            <ArrowRightIcon
              className={cn(
                "text-muted-foreground size-4 transition-transform group-hover:translate-x-0.5",
                active && "text-primary",
              )}
            />
          </Link>
        );
      })}
      </div>
    </div>
  );
}
