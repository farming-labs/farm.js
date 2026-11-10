import fs from "node:fs/promises";
import path from "node:path";
import type { Plugin } from "vite";

/** Where an RSC build keeps client source maps, beside (not inside) the public client output. */
export const RSC_CLIENT_SOURCEMAPS_DIR = "client-sourcemaps";

type BundleOutput = { type: string; source?: string | Uint8Array };

/**
 * Keep the client environment's source maps out of the public output, as core
 * client builds do. A client map carries the original source of every module
 * in a chunk, including code stripped from the client JS, such as
 * `createServerOnlyFn` bodies. Any enabled `build.sourcemap` becomes
 * `"hidden"` (the JS names no map), and the maps are moved beside the client
 * output.
 */
export function rscPrivateClientSourcemaps(environmentName = "client"): Plugin {
  let maps: Array<[fileName: string, source: string | Uint8Array]> = [];
  let mapsDir: string | undefined;
  const isClient = (environment: { name?: string } | undefined) =>
    environment?.name === environmentName;

  return {
    name: "@farm.js/plugin/rsc:private-client-sourcemaps",
    enforce: "post",
    apply: "build",
    configEnvironment(name, config) {
      if (name !== environmentName || !config.build?.sourcemap) return;
      return { build: { sourcemap: "hidden" } };
    },
    generateBundle(outputOptions, bundle) {
      if (!isClient(this.environment)) return;
      maps = [];
      mapsDir = outputOptions.dir
        ? path.join(path.dirname(outputOptions.dir), RSC_CLIENT_SOURCEMAPS_DIR)
        : undefined;
      for (const [fileName, output] of Object.entries(bundle as Record<string, BundleOutput>)) {
        if (output.type !== "asset" || !fileName.endsWith(".map")) continue;
        maps.push([fileName, output.source ?? ""]);
        delete bundle[fileName];
      }
    },
    async writeBundle() {
      if (!isClient(this.environment) || !mapsDir) return;
      await fs.rm(mapsDir, { recursive: true, force: true });
      for (const [fileName, source] of maps) {
        const target = path.join(mapsDir, fileName);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, source);
      }
      maps = [];
    },
  };
}
