"use client";

import { useEffect, useState } from "react";

import { isElectron } from "./detector";

/**
 * 客户端环境探测，避免 SSR/CSR 首帧不一致导致 hydration 警告。
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

