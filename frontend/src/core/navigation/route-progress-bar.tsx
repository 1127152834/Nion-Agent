"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect } from "react";

import { forceCompleteNavigation } from "./state";
import { useNavigationLoading } from "./use-navigation-loading";

export function RouteProgressBar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const { isNavigating } = useNavigationLoading();

  useEffect(() => {
    forceCompleteNavigation();
  }, [pathname, search]);

  return (
    <span className="sr-only" aria-live="polite">
      {isNavigating ? "Navigating" : "Navigation complete"}
    </span>
  );
}
