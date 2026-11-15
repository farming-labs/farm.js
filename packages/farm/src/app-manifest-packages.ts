import fs from "node:fs";
import path from "node:path";

const FARM_PACKAGE = /^@(?:farm\.js|farming-labs)\/[a-z0-9._-]+$/;

/**
 * Installed versions of the app's `@farm.js/*` and `@farming-labs/*` dependencies, for the
 * app manifest. Read when the build or dev server starts; never ranges or file paths.
 */
export function resolveFarmAppPackages(root: string): Record<string, string> {
  let manifest: { dependencies?: object; devDependencies?: object };
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  } catch {
    return {};
  }
  const names = new Set(
    [
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.devDependencies ?? {}),
    ].filter((name) => FARM_PACKAGE.test(name)),
  );
  const versions: Record<string, string> = {};
  for (const name of [...names].sort()) {
    // Workspaces hoist dependencies, so look in each node_modules up from the app.
    for (let dir = root; ; ) {
      try {
        const { version } = JSON.parse(
          fs.readFileSync(path.join(dir, "node_modules", name, "package.json"), "utf8"),
        );
        if (typeof version === "string" && /^[0-9A-Za-z.+-]{1,64}$/.test(version))
          versions[name] = version;
        break;
      } catch {
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
      }
    }
  }
  return versions;
}
