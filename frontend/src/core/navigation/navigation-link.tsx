"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";

import { useAppRouter } from "./use-app-router";

function isModifiedNavigationEvent(event: MouseEvent<HTMLAnchorElement>) {
  return event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
}

type NavigationLinkMatch = "exact" | "prefix";

function isTargetPath(pathname: string, href: string, match: NavigationLinkMatch) {
  if (match === "prefix") {
    return pathname === href || pathname.startsWith(`${href}/`);
  }
  return pathname === href;
}

export function useNavigationLink(
  href: string,
  options?: {
    match?: NavigationLinkMatch;
  },
) {
  const pathname = usePathname();
  const router = useAppRouter();
  const [isNavigating, setIsNavigating] = useState(false);
  const previousPathnameRef = useRef(pathname);

  const match = options?.match ?? "exact";
  const active = isTargetPath(pathname, href, match);

  useEffect(() => {
    if (previousPathnameRef.current !== pathname) {
      setIsNavigating(false);
    }
    previousPathnameRef.current = pathname;
  }, [pathname]);

  const onClick = useCallback(
    (event: MouseEvent<HTMLAnchorElement>) => {
      if (event.defaultPrevented || isModifiedNavigationEvent(event)) {
        return;
      }
      if (active || isNavigating) {
        event.preventDefault();
        return;
      }

      event.preventDefault();
      setIsNavigating(true);
      router.push(href);
    },
    [active, href, isNavigating, router],
  );

  return {
    isNavigating,
    linkProps: {
      href,
      onClick,
      prefetch: true,
      "aria-busy": isNavigating || undefined,
      "aria-disabled": isNavigating || undefined,
    },
  };
}

export function NavigationLink({
  href,
  children,
  className,
  match,
}: {
  href: string;
  children: ReactNode;
  className?: string;
  match?: NavigationLinkMatch;
}) {
  const navigationLink = useNavigationLink(href, { match });
  const props = useMemo(() => navigationLink.linkProps, [navigationLink.linkProps]);

  return (
    <Link
      className={className}
      {...props}
    >
      {children}
    </Link>
  );
}
