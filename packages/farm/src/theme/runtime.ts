"use client";

import type {
  FarmResolvedTheme,
  FarmThemePreference,
  FarmThemeRuntime,
  FarmThemeSnapshot,
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

export function getTheme(): FarmThemeSnapshot {
  const next =
    typeof window === "undefined" ? FALLBACK_CLIENT_SNAPSHOT : window.__FARM_THEME__?.snapshot;
  if (!next) return cachedClientSnapshot;
  if (!snapshotsMatch(cachedClientSnapshot, next)) cachedClientSnapshot = next;
  return cachedClientSnapshot;
}

export function setTheme(theme: FarmThemePreference): void {
  const runtime = typeof window === "undefined" ? undefined : window.__FARM_THEME__;
  if (!runtime) {
    throw new Error("The FARMJS theme runtime is not enabled. Add `theme` to farm.config.ts.");
  }
  runtime.setTheme(theme);
}

export function toggleTheme(): FarmResolvedTheme {
  const next = getTheme().resolvedTheme === "dark" ? "light" : "dark";
  setTheme(next);
  return next;
}

export function subscribeTheme(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handleThemeChange = () => {
    getTheme();
    listener();
  };
  window.addEventListener("farm:themechange", handleThemeChange);
  return () => window.removeEventListener("farm:themechange", handleThemeChange);
}
