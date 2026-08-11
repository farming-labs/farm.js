"use client";

import { useSyncExternalStore } from "react";
import { getFarmThemeServerSnapshot } from "./bridge";
import { getTheme, setTheme, subscribeTheme, toggleTheme } from "./runtime";
import type { FarmThemePreference, FarmThemeSnapshot, FarmResolvedTheme } from "./types";

export { getTheme, setTheme, toggleTheme } from "./runtime";

function getHydrationSnapshot(): FarmThemeSnapshot {
  if (typeof window !== "undefined" && window.__FARM_THEME__?.serverSnapshot) {
    return window.__FARM_THEME__.serverSnapshot;
  }
  return getFarmThemeServerSnapshot();
}

export interface UseThemeResult extends FarmThemeSnapshot {
  setTheme(theme: FarmThemePreference): void;
  toggleTheme(): FarmResolvedTheme;
}

export function useTheme(): UseThemeResult {
  const snapshot = useSyncExternalStore(subscribeTheme, getTheme, getHydrationSnapshot);
  return {
    ...snapshot,
    setTheme,
    toggleTheme,
  };
}
