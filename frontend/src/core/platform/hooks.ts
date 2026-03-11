"use client";

import { useEffect, useState } from "react";

import { isElectron } from "./detector";

/**
 * Client-side runtime probe to avoid SSR/CSR hydration mismatch warnings.
 */
export function useDesktopRuntime() {
  const [mounted, setMounted] = useState(false);
  const [desktopRuntime, setDesktopRuntime] = useState(false);

  useEffect(() => {
    setMounted(true);
    setDesktopRuntime(isElectron());
  }, []);

  return {
    mounted,
    isDesktopRuntime: mounted && desktopRuntime,
  };
}
