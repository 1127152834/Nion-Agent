"use client";

import NProgress from "nprogress";

export const NAVIGATION_PROGRESS_DELAY_MS = 120;
export const NAVIGATION_PROGRESS_MIN_VISIBLE_MS = 250;
export const NAVIGATION_PROGRESS_TIMEOUT_MS = 12_000;

type NavigationSnapshot = {
  activeCount: number;
  isNavigating: boolean;
};

type Listener = () => void;

const listeners = new Set<Listener>();
const activeTokens = new Set<number>();
const SERVER_NAVIGATION_SNAPSHOT: NavigationSnapshot = {
  activeCount: 0,
  isNavigating: false,
};

let nextToken = 1;
let nProgressConfigured = false;
let progressVisible = false;
let progressVisibleAt = 0;
let snapshot: NavigationSnapshot = SERVER_NAVIGATION_SNAPSHOT;

let showTimer: ReturnType<typeof setTimeout> | null = null;
let minVisibleTimer: ReturnType<typeof setTimeout> | null = null;
let timeoutTimer: ReturnType<typeof setTimeout> | null = null;

function emit() {
  listeners.forEach((listener) => {
    listener();
  });
}

function configureNProgress() {
  if (nProgressConfigured || typeof window === "undefined") {
    return;
  }
  NProgress.configure({
    showSpinner: false,
    minimum: 0.08,
    trickle: true,
    trickleRate: 0.08,
    trickleSpeed: 180,
    speed: 240,
    easing: "ease",
  });
  nProgressConfigured = true;
}

function clearTimer(timer: ReturnType<typeof setTimeout> | null) {
  if (!timer) {
    return;
  }
  clearTimeout(timer);
}

function resetShowTimer() {
  clearTimer(showTimer);
  showTimer = null;
}

function resetMinVisibleTimer() {
  clearTimer(minVisibleTimer);
  minVisibleTimer = null;
}

function resetTimeoutTimer() {
  clearTimer(timeoutTimer);
  timeoutTimer = null;
}

function showProgress() {
  if (progressVisible) {
    return;
  }
  configureNProgress();
  if (typeof window === "undefined") {
    return;
  }
  progressVisible = true;
  progressVisibleAt = Date.now();
  NProgress.start();
}

function hideProgress() {
  if (!progressVisible) {
    resetShowTimer();
    resetMinVisibleTimer();
    resetTimeoutTimer();
    return;
  }

  progressVisible = false;
  progressVisibleAt = 0;
  resetShowTimer();
  resetMinVisibleTimer();
  resetTimeoutTimer();

  if (typeof window !== "undefined") {
    NProgress.done(true);
  }
}

function scheduleShowProgress() {
  if (progressVisible || showTimer) {
    return;
  }

  showTimer = setTimeout(() => {
    showTimer = null;
    if (activeTokens.size === 0) {
      return;
    }
    showProgress();

    timeoutTimer = setTimeout(() => {
      forceCompleteNavigation();
    }, NAVIGATION_PROGRESS_TIMEOUT_MS);
  }, NAVIGATION_PROGRESS_DELAY_MS);
}

function scheduleHideProgress() {
  resetTimeoutTimer();

  if (!progressVisible) {
    resetShowTimer();
    return;
  }

  const elapsedMs = Date.now() - progressVisibleAt;
  if (elapsedMs >= NAVIGATION_PROGRESS_MIN_VISIBLE_MS) {
    hideProgress();
    return;
  }

  resetMinVisibleTimer();
  minVisibleTimer = setTimeout(() => {
    minVisibleTimer = null;
    if (activeTokens.size === 0) {
      hideProgress();
    }
  }, NAVIGATION_PROGRESS_MIN_VISIBLE_MS - elapsedMs);
}

function updateActivity() {
  emit();
  if (activeTokens.size > 0) {
    scheduleShowProgress();
    return;
  }
  scheduleHideProgress();
}

export function beginNavigation() {
  const token = nextToken;
  nextToken += 1;
  activeTokens.add(token);
  updateActivity();

  let finished = false;
  return () => {
    if (finished) {
      return;
    }
    finished = true;
    if (activeTokens.delete(token)) {
      updateActivity();
    }
  };
}

export function forceCompleteNavigation() {
  if (activeTokens.size === 0 && !progressVisible && !showTimer) {
    return;
  }
  activeTokens.clear();
  hideProgress();
  emit();
}

export function subscribeNavigationLoading(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getNavigationSnapshot(): NavigationSnapshot {
  const activeCount = activeTokens.size;
  if (snapshot.activeCount !== activeCount) {
    snapshot = {
      activeCount,
      isNavigating: activeCount > 0,
    };
  }
  return snapshot;
}

export function getNavigationServerSnapshot(): NavigationSnapshot {
  return SERVER_NAVIGATION_SNAPSHOT;
}
