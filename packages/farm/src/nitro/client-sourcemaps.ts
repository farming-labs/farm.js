import fs from "node:fs/promises";
import path from "node:path";

/** Where a production build keeps client source maps, beside (not inside) the public client output. */
export const FARM_CLIENT_SOURCEMAPS_DIR = "client-sourcemaps";

/**
 * The client build's `sourcemap` for the app's `vite.build.sourcemap`.
 *
 * A client map carries the original source of every module in a chunk,
 * including code Farm strips from the client JS, such as `createServerOnlyFn`
 * bodies and `generateMetadata`. Published next to the chunk it would hand that
 * code to anyone who asks. Any enabled value therefore becomes `"hidden"`: the
 * JS names no map, and the maps are moved out of the public output.
 */
export function resolveFarmClientSourcemap(sourcemap: unknown): "hidden" | false {
  return sourcemap ? "hidden" : false;
}

type BundleOutput = { type: string; source?: string | Uint8Array };

/** Move the client build's `.map` files from the public output to `outDir`. */
export function createFarmPrivateClientSourcemapsPlugin(options: { outDir: string }) {
  let maps: Array<[fileName: string, source: string | Uint8Array]> = [];
  return {
    name: "farm-private-client-sourcemaps",
    enforce: "post" as const,
    generateBundle(_output: unknown, bundle: Record<string, BundleOutput>) {
      maps = [];
      for (const [fileName, output] of Object.entries(bundle)) {
        if (output.type !== "asset" || !fileName.endsWith(".map")) continue;
        maps.push([fileName, output.source ?? ""]);
        delete bundle[fileName];
      }
    },
    async writeBundle() {
      await fs.rm(options.outDir, { recursive: true, force: true });
      for (const [fileName, source] of maps) {
        const target = path.join(options.outDir, fileName);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, source);
      }
    },
  };
}
