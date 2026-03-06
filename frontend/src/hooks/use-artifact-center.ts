"use client";

import { useCallback, useState } from "react";

export function useArtifactCenter() {
  const [open, setOpen] = useState(false);
  const [selectedArtifact, setSelectedArtifact] = useState<string | null>(null);
  const [workbenchOpen, setWorkbenchOpen] = useState(false);
  const [matchedPluginId, setMatchedPluginId] = useState<string | null>(null);

  const toggleOpen = useCallback(() => {
    setOpen((prev) => !prev);
  }, []);

  const openWorkbench = useCallback((artifactPath: string, pluginId: string | null) => {
    setSelectedArtifact(artifactPath);
    setMatchedPluginId(pluginId);
    setWorkbenchOpen(true);
  }, []);

  const closeWorkbench = useCallback(() => {
    setWorkbenchOpen(false);
    setSelectedArtifact(null);
    setMatchedPluginId(null);
  }, []);

  return {
    open,
    setOpen,
    toggleOpen,
    selectedArtifact,
    workbenchOpen,
    setWorkbenchOpen,
    matchedPluginId,
    openWorkbench,
    closeWorkbench,
  };
}
