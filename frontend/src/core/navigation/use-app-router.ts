"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo } from "react";

import { beginNavigation } from "./state";
import { useNavigationLoading } from "./use-navigation-loading";

function normalizeCurrentHref(pathname: string, search: string) {
  return search.length > 0 ? `${pathname}?${search}` : pathname;
}

function isSameInternalHref(targetHref: string, currentHref: string) {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    const target = new URL(targetHref, window.location.origin);
    if (target.origin !== window.location.origin) {
      return false;
    }
    const normalizedTarget = target.search.length > 0
      ? `${target.pathname}${target.search}`
      : target.pathname;
    return normalizedTarget === currentHref;
  } catch {
    return targetHref === currentHref;
  }
}

export function useAppRouter() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { isNavigating, activeCount } = useNavigationLoading();

  const currentHref = normalizeCurrentHref(pathname, searchParams.toString());

  return useMemo(() => {
    const push: typeof router.push = (href, options) => {
      if (isSameInternalHref(String(href), currentHref)) {
        return;
      }
      const finish = beginNavigation();
      try {
        router.push(href, options);
      } catch (error) {
        finish();
        throw error;
      }
    };

    const replace: typeof router.replace = (href, options) => {
      if (isSameInternalHref(String(href), currentHref)) {
        return;
      }
      const finish = beginNavigation();
      try {
        router.replace(href, options);
      } catch (error) {
        finish();
        throw error;
      }
    };

    const back: typeof router.back = () => {
      const finish = beginNavigation();
      try {
        router.back();
      } catch (error) {
        finish();
        throw error;
      }
    };

    const forward: typeof router.forward = () => {
      const finish = beginNavigation();
      try {
        router.forward();
      } catch (error) {
        finish();
        throw error;
      }
    };

    const refresh: typeof router.refresh = () => {
      const finish = beginNavigation();
      try {
        router.refresh();
      } catch (error) {
        finish();
        throw error;
      }
    };

    return {
      ...router,
      push,
      replace,
      back,
      forward,
      refresh,
      isNavigating,
      navigationActiveCount: activeCount,
    };
  }, [activeCount, currentHref, isNavigating, router]);
}
