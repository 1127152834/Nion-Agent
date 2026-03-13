"use client";

import React, { useEffect } from "react";

import { initializeBuiltInPlugins } from "@/plugins";

/**
 * Client component that initializes workbench plugins
 * Should be included in the app layout
 */
export function PluginInitializer() {
  useEffect(() => {
    // Expose React to global scope for plugins
    if (typeof window !== "undefined") {
      (window as Window & { React?: typeof React }).React = React;
    }

    void initializeBuiltInPlugins();
  }, []);

  return null;
}
