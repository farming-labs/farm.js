import path from "node:path";
import {
  loadConfig,
  managedSqliteName,
  requestSqliteResource,
} from "@farm.js/core/internal/cli-runtime";

export async function reconcileFarmStorage(root: string, apply: boolean) {
  const config = await loadConfig(path.resolve(root), undefined, "production");
  if (!config) throw new Error("Create a farm.config.ts before planning managed storage.");
  const mounts = config.storage && "mounts" in config.storage ? config.storage.mounts : undefined;
  const names = new Set<string>();
  for (const [base, mount] of Object.entries(mounts ?? {})) {
    if (typeof mount !== "object" || mount === null || !("driver" in mount)) continue;
    if (mount.driver === "farm-managed-sqlite")
      names.add(managedSqliteName(base, "managed" in mount ? mount.managed : undefined));
  }
  const resources = [...names].sort();
  if (apply) {
    for (const name of resources) {
      const response = await requestSqliteResource(name, "provision");
      if (response?.name !== name)
        throw new Error("Farm did not acknowledge the database. Retry farm storage apply.");
    }
  }
  return resources;
}
