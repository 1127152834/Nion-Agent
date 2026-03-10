"use client";

import { useCallback, useState } from "react";

export function useArtifactCenter() {
  const [open, setOpen] = useState(false);

  const toggleOpen = useCallback(() => {
    setOpen((prev) => !prev);
  }, []);

  return {
    open,
    setOpen,
    toggleOpen,
  };
}
