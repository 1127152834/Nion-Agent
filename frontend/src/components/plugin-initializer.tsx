"use client";

import { useEffect } from "react";

import { initializeBuiltInPlugins } from "@/plugins";

/**
 * Client component that initializes workbench plugins
 * Should be included in the app layout
 */
export function PluginInitializer() {
  useEffect(() => {
    initializeBuiltInPlugins();
  }, []);

  return null;
}
