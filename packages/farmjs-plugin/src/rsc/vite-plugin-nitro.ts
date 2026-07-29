/**
 * Vite plugin to run Nitro after RSC build (single "vite build", no post script).
 * Implements the Nitro RSC deployment pipeline:
 * - Step 1: Force per-environment output dirs to .nitro/vite/dist/${name} so Nitro can locate artifacts.
 * - Step 2: Capture the server (RSC) Rollup bundle in writeBundle.
 * - Step 3: Find the SSR entry chunk from the bundle.
 * - Step 4: Compute renderer path and pass to Nitro with client publicDir.
 *
 * @example
 * ```ts
 * import nitro from '@farm.js/plugin/rsc/vite-plugin-nitro'
 * export default defineConfig({
 *   plugins: [rsc(), react(), nitro({ server: { environmentName: 'rsc' }, config: { preset: 'vercel' } })],
 * })
 * ```
 */

import type { Plugin } from "vite";
import path from "path";
import type { ResolvedConfig } from "vite";
import { buildRscNitro } from "./nitro-build.js";
import { waitForRscOutputs } from "./nitro-build.js";
import { resolveRscBuildOutputPath } from "./build-paths.js";

/** Rollup output chunk (from writeBundle); we only use entry chunks. */
interface OutputChunkLike {
  type: string;
  fileName: string;
  isEntry?: boolean;
  name?: string;
}

export interface NitroPluginOptions {
  server?: {
    environmentName?: string;
    /** Entry name in rollupOptions.input (default: 'index'). */
    entryName?: string;
  };
  config?: {
    preset?: string;
  };
  /** Base output dir when not using .nitro/vite/dist (fallback). */
  outDir?: string;
}

let nitroRunScheduled = false;
/** Stored RSC (server) bundle from writeBundle so we can find the entry chunk. */
let serverBundle: Record<
  string,
  { type: string; fileName?: string; isEntry?: boolean; name?: string }
> | null = null;

const NITRO_VITE_DIST = ".nitro/vite/dist";

export default function nitro(options: NitroPluginOptions = {}): Plugin {
  const serverEnvName = options.server?.environmentName ?? "rsc";
  const serverEntryName = options.server?.entryName ?? "index";

  let resolvedRoot: string = process.cwd();
  let rscOutDir: string = path.join(NITRO_VITE_DIST, "rsc");
  let ssrOutDir: string = path.join(NITRO_VITE_DIST, "ssr");
  let clientOutDir: string = path.join(NITRO_VITE_DIST, "client");
  let baseOutDir: string = NITRO_VITE_DIST;

  return {
    name: "vite-plugin-nitro",
    apply: "build",

    // Step 1: Force per-environment output dirs so Nitro can locate artifacts.
    config() {
      return {
        environments: {
          rsc: { build: { outDir: path.join(NITRO_VITE_DIST, "rsc") } },
          ssr: { build: { outDir: path.join(NITRO_VITE_DIST, "ssr") } },
          client: { build: { outDir: path.join(NITRO_VITE_DIST, "client") } },
        },
      };
    },

    configResolved(config: ResolvedConfig) {
      resolvedRoot = path.resolve(config.root ?? process.cwd());
      const envs = (config as any).environments;
      if (envs?.rsc?.build?.outDir && envs?.ssr?.build?.outDir && envs?.client?.build?.outDir) {
        rscOutDir = envs.rsc.build.outDir;
        ssrOutDir = envs.ssr.build.outDir;
        clientOutDir = envs.client.build.outDir;
        const dir = path.dirname(rscOutDir);
        baseOutDir = path.isAbsolute(dir) ? path.relative(resolvedRoot, dir) || "." : dir;
      } else {
        baseOutDir = options.outDir ?? "dist";
        rscOutDir = path.join(baseOutDir, "rsc");
        ssrOutDir = path.join(baseOutDir, "ssr");
        clientOutDir = path.join(baseOutDir, "client");
      }
    },

    // Step 2: Capture the server (RSC) Rollup bundle when that environment writes.
    writeBundle(
      this: { environment?: { name?: string } },
      _options: unknown,
      bundle: Record<string, { type: string; fileName?: string; isEntry?: boolean; name?: string }>,
    ) {
      if ((this as any).environment?.name === serverEnvName) {
        serverBundle = bundle;
        (globalThis as any).__FARM_NITRO_SERVER_BUNDLE = bundle;
        (globalThis as any).__FARM_NITRO_PATHS = {
          root: resolvedRoot,
          rscOutDir,
          ssrOutDir,
          clientOutDir,
          serverEntryName,
          preset: options.config?.preset ?? process.env.NITRO_PRESET ?? "vercel",
        };
      }
    },

    // Run Nitro once all env outputs exist (after step 5). buildEnd runs after each env; only run when all exist.
    async buildEnd(this: { environment?: { name?: string } }) {
      if (nitroRunScheduled) return;
      const root = path.resolve(resolvedRoot);
      const { existsSync } = await import("fs");
      await new Promise((r) => setTimeout(r, 800));
      const baseOutDir = rscOutDir.includes(".nitro/vite/dist")
        ? NITRO_VITE_DIST
        : path.isAbsolute(path.dirname(rscOutDir))
          ? path.relative(root, path.dirname(rscOutDir)) || "."
          : path.dirname(rscOutDir);
      const rscOk = existsSync(resolveRscBuildOutputPath(root, baseOutDir, "rsc", "index.js"));
      const ssrOk = existsSync(resolveRscBuildOutputPath(root, baseOutDir, "ssr", "index.js"));
      const clientOk = existsSync(resolveRscBuildOutputPath(root, baseOutDir, "client", "assets"));
      if (!rscOk || !ssrOk || !clientOk) return;
      nitroRunScheduled = true;

      const preset = options.config?.preset ?? process.env.NITRO_PRESET ?? "vercel";

      const run = async () => {
        await waitForRscOutputs(root, baseOutDir, { timeoutMs: 20_000 }).catch(() => {
          // Outputs already verified; proceed (nitro-build stubs manifest if missing)
        });

        let rendererPath = resolveRscBuildOutputPath(root, rscOutDir, "index.js");
        if (serverBundle) {
          const serverEntryChunks: OutputChunkLike[] = [];
          for (const chunk of Object.values(serverBundle)) {
            if (chunk.type === "chunk" && chunk.isEntry && chunk.fileName) {
              serverEntryChunks.push(chunk as OutputChunkLike);
            }
          }
          const selected = serverEntryName
            ? serverEntryChunks.find((c) => (c.name ?? c.fileName) === serverEntryName)
            : serverEntryChunks[0];
          if (selected?.fileName) {
            rendererPath = resolveRscBuildOutputPath(root, rscOutDir, selected.fileName);
          }
        }

        await buildRscNitro({
          root,
          rendererPath,
          publicDir: resolveRscBuildOutputPath(root, clientOutDir),
          ssrPath: resolveRscBuildOutputPath(root, ssrOutDir, "index.js"),
          assetsDir: undefined,
          preset,
        });
        (globalThis as any).__FARM_NITRO_PLUGIN_RAN = true;
      };

      await run();
    },
  };
}

/** Called by RSC plugin buildApp (post) to run Nitro with the captured bundle. */
export async function runNitroFromBuildApp(): Promise<void> {
  const paths = (globalThis as any).__FARM_NITRO_PATHS as
    | {
        root: string;
        rscOutDir: string;
        ssrOutDir: string;
        clientOutDir: string;
        serverEntryName: string;
        preset: string;
      }
    | undefined;
  const bundle = (globalThis as any).__FARM_NITRO_SERVER_BUNDLE as Record<
    string,
    { type: string; fileName?: string; isEntry?: boolean; name?: string }
  > | null;
  if (!paths) return;

  const root = paths.root;
  const preset = paths.preset;
  const baseOutDir = path.dirname(paths.rscOutDir);

  await waitForRscOutputs(root, baseOutDir, { timeoutMs: 25_000 });

  let rendererPath = resolveRscBuildOutputPath(root, paths.rscOutDir, "index.js");
  if (bundle) {
    const serverEntryChunks: OutputChunkLike[] = [];
    for (const chunk of Object.values(bundle)) {
      if (chunk.type === "chunk" && chunk.isEntry && chunk.fileName) {
        serverEntryChunks.push(chunk as OutputChunkLike);
      }
    }
    const selected = paths.serverEntryName
      ? serverEntryChunks.find((c) => (c.name ?? c.fileName) === paths.serverEntryName)
      : serverEntryChunks[0];
    if (selected?.fileName) {
      rendererPath = resolveRscBuildOutputPath(root, paths.rscOutDir, selected.fileName);
    }
  }

  await buildRscNitro({
    root,
    rendererPath,
    publicDir: resolveRscBuildOutputPath(root, paths.clientOutDir),
    ssrPath: resolveRscBuildOutputPath(root, paths.ssrOutDir, "index.js"),
    assetsDir: undefined,
    preset,
  });
}
