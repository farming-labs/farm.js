import path from "node:path";
import {
  loadConfig,
  managedSqliteName,
  resolveManagedStorageMount,
  requestSqliteResource,
} from "@farm.js/core/internal/cli-runtime";

export async function reconcileFarmStorage(root: string, apply: boolean) {
  const config = await loadConfig(path.resolve(root), undefined, "production");
  if (!config) throw new Error("Create a farm.config.ts before planning managed storage.");
  const mounts = config.storage && "mounts" in config.storage ? config.storage.mounts : undefined;
  const names = new Set<string>();
  for (const [base, mount] of Object.entries(mounts ?? {})) {
    const hosted = resolveManagedStorageMount(mount);
    if (hosted) names.add(managedSqliteName(base, hosted.managed));
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
