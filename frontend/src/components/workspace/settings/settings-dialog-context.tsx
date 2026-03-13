"use client";

import { createContext, useContext } from "react";

type SettingsDialogContextValue = {
  activeSection: string;
  goToSection: (sectionId: string) => void;
};

const SettingsDialogContext = createContext<SettingsDialogContextValue | null>(null);

export function SettingsDialogProvider({
  value,
  children,
}: {
  value: SettingsDialogContextValue;
  children: React.ReactNode;
}) {
  return (
    <SettingsDialogContext.Provider value={value}>
      {children}
    </SettingsDialogContext.Provider>
  );
}

export function useSettingsDialog() {
  const ctx = useContext(SettingsDialogContext);
  if (!ctx) {
    return null;
  }
  return ctx;
}

