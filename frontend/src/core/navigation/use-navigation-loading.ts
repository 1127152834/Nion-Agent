"use client";

import { useSyncExternalStore } from "react";

import {
  getNavigationSnapshot,
  getNavigationServerSnapshot,
  subscribeNavigationLoading,
} from "./state";

export function useNavigationLoading() {
  return useSyncExternalStore(
    subscribeNavigationLoading,
    getNavigationSnapshot,
    getNavigationServerSnapshot,
  );
}
