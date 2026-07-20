import type { FarmI18nClientSnapshot } from "./types";

type SnapshotResolver = () => FarmI18nClientSnapshot | undefined;

const FARM_I18N_SNAPSHOT_RESOLVER = Symbol.for("farm.i18n.snapshotResolver");
type GlobalWithI18nResolver = typeof globalThis & {
  [FARM_I18N_SNAPSHOT_RESOLVER]?: SnapshotResolver;
};

export function _setFarmI18nSnapshotResolver(resolver: SnapshotResolver | undefined): void {
  (globalThis as GlobalWithI18nResolver)[FARM_I18N_SNAPSHOT_RESOLVER] = resolver;
}

export function getActiveFarmI18nSnapshot(): FarmI18nClientSnapshot | undefined {
  if (typeof window !== "undefined" && window.__FARM_I18N__) {
    return window.__FARM_I18N__;
  }
  return (globalThis as GlobalWithI18nResolver)[FARM_I18N_SNAPSHOT_RESOLVER]?.();
}
