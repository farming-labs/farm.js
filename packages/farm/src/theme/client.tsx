"use client";

import { useSyncExternalStore } from "react";
import { getFarmThemeServerSnapshot } from "./bridge";
import type {
  FarmThemePreference,
  FarmThemeRuntime,
  FarmThemeSnapshot,
  FarmResolvedTheme,
} from "./types";

declare global {
  interface Window {
    __FARM_THEME__?: FarmThemeRuntime;
  }
}

const FALLBACK_CLIENT_SNAPSHOT: FarmThemeSnapshot = Object.freeze({
  theme: "system",
  resolvedTheme: "light",
  mounted: true,
});

let cachedClientSnapshot = FALLBACK_CLIENT_SNAPSHOT;

function snapshotsMatch(left: FarmThemeSnapshot, right: FarmThemeSnapshot): boolean {
  return (
    left.theme === right.theme &&
    left.resolvedTheme === right.resolvedTheme &&
    left.mounted === right.mounted
  );
}

function getClientSnapshot(): FarmThemeSnapshot {
  const next =
    typeof window === "undefined" ? FALLBACK_CLIENT_SNAPSHOT : window.__FARM_THEME__?.snapshot;
  if (!next) return cachedClientSnapshot;
  if (!snapshotsMatch(cachedClientSnapshot, next)) cachedClientSnapshot = next;
  return cachedClientSnapshot;
}

function getHydrationSnapshot(): FarmThemeSnapshot {
  if (typeof window !== "undefined" && window.__FARM_THEME__?.serverSnapshot) {
    return window.__FARM_THEME__.serverSnapshot;
  }
  return getFarmThemeServerSnapshot();
}

function subscribe(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handleThemeChange = () => {
    getClientSnapshot();
    listener();
  };
  window.addEventListener("farm:themechange", handleThemeChange);
  return () => window.removeEventListener("farm:themechange", handleThemeChange);
}

export function getTheme(): FarmThemeSnapshot {
  return getClientSnapshot();
}

export function setTheme(theme: FarmThemePreference): void {
  const runtime = typeof window === "undefined" ? undefined : window.__FARM_THEME__;
  if (!runtime) {
    throw new Error("The FARMJS theme runtime is not enabled. Add `theme` to farm.config.ts.");
  }
  runtime.setTheme(theme);
}

export function toggleTheme(): FarmResolvedTheme {
  const next = getClientSnapshot().resolvedTheme === "dark" ? "light" : "dark";
  setTheme(next);
  return next;
}

export interface UseThemeResult extends FarmThemeSnapshot {
  setTheme(theme: FarmThemePreference): void;
  toggleTheme(): FarmResolvedTheme;
}

export function useTheme(): UseThemeResult {
  const snapshot = useSyncExternalStore(subscribe, getClientSnapshot, getHydrationSnapshot);
  return {
    ...snapshot,
    setTheme,
    toggleTheme,
  };
}
