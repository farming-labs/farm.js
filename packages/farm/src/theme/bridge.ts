import type { FarmThemeSnapshot } from "./types";

const FALLBACK_SERVER_SNAPSHOT: FarmThemeSnapshot = Object.freeze({
  theme: "system",
  resolvedTheme: undefined,
  mounted: false,
});

const FARM_THEME_SERVER_SNAPSHOT_RESOLVER = Symbol.for("farm.js.theme.server-snapshot-resolver");

type FarmThemeBridgeGlobal = typeof globalThis & {
  [FARM_THEME_SERVER_SNAPSHOT_RESOLVER]?: () => FarmThemeSnapshot;
};

export function _setFarmThemeServerSnapshotResolver(resolver: () => FarmThemeSnapshot): void {
  (globalThis as FarmThemeBridgeGlobal)[FARM_THEME_SERVER_SNAPSHOT_RESOLVER] = resolver;
}

export function getFarmThemeServerSnapshot(): FarmThemeSnapshot {
  return (
    (globalThis as FarmThemeBridgeGlobal)[FARM_THEME_SERVER_SNAPSHOT_RESOLVER]?.() ??
    FALLBACK_SERVER_SNAPSHOT
  );
}
