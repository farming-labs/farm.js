import path from "node:path";
import {
  loadConfig,
  managedSqliteName,
  resolveManagedStorageMount,
  requestSqliteResource,
} from "@farm.js/core/internal/cli-runtime";

type Alias = { mount: string; driver?: string; type?: "kv" | "sql" };

/** The driver Infra shows for a mount. A typed farmStorage() mount reports what it holds. */
function declaredDriver(hosted: { declaredDriver?: string; type?: "kv" | "sql" }) {
  return hosted.declaredDriver === "farm" && hosted.type
    ? `farm-${hosted.type}`
    : hosted.declaredDriver;
}

export async function reconcileFarmStorage(root: string, apply: boolean) {
  const config = await loadConfig(path.resolve(root), undefined, "production");
  if (!config) throw new Error("Create a farm.config.ts before planning managed storage.");
  const mounts = config.storage && "mounts" in config.storage ? (config.storage.mounts ?? {}) : {};
  const byResource = new Map<string, Alias[]>();
  const untyped: string[] = [];
  for (const base of Object.keys(mounts).sort()) {
    const mount = mounts[base];
    const hosted = resolveManagedStorageMount(mount);
    if (!hosted) continue;
    const name = managedSqliteName(base, hosted.managed);
    const aliases = byResource.get(name) ?? [];
    aliases.push({ mount: base, driver: declaredDriver(hosted), type: hosted.type });
    byResource.set(name, aliases);
    if (!hosted.type) untyped.push(base);
  }
  for (const [name, aliases] of byResource) {
    const kv = aliases.filter((entry) => entry.type === "kv").map((entry) => `\`${entry.mount}\``);
    const sql = aliases
      .filter((entry) => entry.type === "sql")
      .map((entry) => `\`${entry.mount}\``);
    if (kv.length && sql.length)
      throw new Error(
        `The key-value mount ${kv.join(", ")} and the SQL mount ${sql.join(", ")} share the database "${name}". ` +
          "Give one of them its own `namespace` so each database holds one kind of data.",
      );
  }
  if (untyped.length)
    console.warn(
      `farmStorage() without \`type\` is deprecated (${untyped.map((mount) => `\`${mount}\``).join(", ")}). ` +
        'Set `type: "kv"` or `type: "sql"` so each mount holds one kind of data.',
    );
  const resources = [...byResource.keys()].sort();
  if (apply) {
    for (const name of resources) {
      const aliases = byResource.get(name)!;
      // Older framework descriptors carry no driver identity. Keep the server's metadata in that case.
      const known = aliases
        .filter((entry): entry is Alias & { driver: string } => typeof entry.driver === "string")
        .map(({ mount, driver }) => ({ mount, driver }));
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
