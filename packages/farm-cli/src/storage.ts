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
  const mounts = config.storage && "mounts" in config.storage ? (config.storage.mounts ?? {}) : {};
  const byResource = new Map<string, { mount: string; driver?: string }[]>();
  for (const base of Object.keys(mounts).sort()) {
    const mount = mounts[base];
    const hosted = resolveManagedStorageMount(mount);
    if (!hosted) continue;
    const name = managedSqliteName(base, hosted.managed);
    const aliases = byResource.get(name) ?? [];
    aliases.push({ mount: base, driver: hosted.declaredDriver });
    byResource.set(name, aliases);
  }
  const resources = [...byResource.keys()].sort();
  if (apply) {
    for (const name of resources) {
      const aliases = byResource.get(name)!;
      // Older framework descriptors carry no driver identity. Keep the server's metadata in that case.
      const known = aliases.filter(
        (entry): entry is { mount: string; driver: string } => typeof entry.driver === "string",
      );
      const response = await requestSqliteResource(
        name,
        "provision",
        known.length === aliases.length ? known : undefined,
      );
      if (response?.name !== name)
        throw new Error("Farm did not acknowledge the database. Retry farm storage apply.");
    }
  }
  return resources;
}
