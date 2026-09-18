/**
 * Vite plugin for the Nitro RSC deployment pipeline. It forces per-environment
 * output dirs (`Step 1`), captures the server (RSC) Rollup bundle in `writeBundle`
 * (`Step 2`), and exposes `runNitroFromBuildApp()`, which builds Nitro from the
 * captured outputs once all environments have finished writing.
 *
 * Farm's RSC builder invokes `runNitroFromBuildApp()` after every environment
 * has written its output, so a single `vite build` still produces the
 * deployment bundle.
 *
 * The plugin no longer triggers Nitro itself from a Rollup hook: the previous
 * `buildEnd` trigger fired before its own environment's `prepareOutDir`/`writeBundle`,
 * so on a rebuild it observed the previous build's stale outputs and built Nitro
 * against them (and set `__FARM_NITRO_PLUGIN_RAN`, suppressing the proper run).
 * Removing it keeps Nitro from running against stale artifacts while the post-app
 * hook preserves the one-command build contract.
 *
 * - Step 1: Force per-environment output dirs to `.nitro/vite/dist/${name}` so Nitro can locate artifacts.
 * - Step 2: Capture the server (RSC) Rollup bundle in `writeBundle`.
 *
 * @example
 * ```ts
 * import { defineConfig, nitro } from '@farm.js/plugin/rsc'
 * export default defineConfig({
 *   srcDir: 'src',
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

const NITRO_VITE_DIST = ".nitro/vite/dist";

export default function nitro(options: NitroPluginOptions = {}): Plugin {
  const serverEnvName = options.server?.environmentName ?? "rsc";
  const serverEntryName = options.server?.entryName ?? "index";

  let resolvedRoot: string = process.cwd();
  let rscOutDir: string = path.join(NITRO_VITE_DIST, "rsc");
  let ssrOutDir: string = path.join(NITRO_VITE_DIST, "ssr");
  let clientOutDir: string = path.join(NITRO_VITE_DIST, "client");
  let clientAssetsDir: string = "assets";

  return {
    name: "vite-plugin-nitro",
    apply: "build",

    // Step 1: Force per-environment output dirs so Nitro can locate artifacts.
    config() {
      delete (globalThis as any).__FARM_NITRO_SERVER_BUNDLE;
      delete (globalThis as any).__FARM_NITRO_PATHS;
      delete (globalThis as any).__FARM_NITRO_BUILD_PROMISE;
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
      } else {
        const baseOutDir = options.outDir ?? "dist";
        rscOutDir = path.join(baseOutDir, "rsc");
        ssrOutDir = path.join(baseOutDir, "ssr");
        clientOutDir = path.join(baseOutDir, "client");
      }
      const clientBuildAssetsDir = envs?.client?.build?.assetsDir;
      clientAssetsDir =
        typeof clientBuildAssetsDir === "string" && clientBuildAssetsDir
          ? clientBuildAssetsDir
          : "assets";
    },

    // Step 2: Capture the server (RSC) Rollup bundle when that environment writes.
    writeBundle(
      this: { environment?: { name?: string } },
      _options: unknown,
      bundle: Record<string, { type: string; fileName?: string; isEntry?: boolean; name?: string }>,
    ) {
      if ((this as any).environment?.name === serverEnvName) {
        delete (globalThis as any).__FARM_NITRO_BUILD_PROMISE;
        (globalThis as any).__FARM_NITRO_SERVER_BUNDLE = bundle;
        (globalThis as any).__FARM_NITRO_PATHS = {
          root: resolvedRoot,
          rscOutDir,
          ssrOutDir,
          clientOutDir,
          serverEntryName,
          preset: options.config?.preset ?? process.env.NITRO_PRESET ?? "vercel",
          clientAssetsDir,
        };
      }
    },
  } as Plugin;
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
        clientAssetsDir?: string;
      }
    | undefined;
  const bundle = (globalThis as any).__FARM_NITRO_SERVER_BUNDLE as Record<
    string,
    { type: string; fileName?: string; isEntry?: boolean; name?: string }
  > | null;
  if (!paths) return;

  const existing = (globalThis as any).__FARM_NITRO_BUILD_PROMISE as Promise<void> | undefined;
  if (existing) {
    await existing;
    return;
  }

  const run = runCapturedNitroBuild(paths, bundle);
  (globalThis as any).__FARM_NITRO_BUILD_PROMISE = run;
  try {
    await run;
  } catch (error) {
    if ((globalThis as any).__FARM_NITRO_BUILD_PROMISE === run) {
      delete (globalThis as any).__FARM_NITRO_BUILD_PROMISE;
    }
    throw error;
  }
}

async function runCapturedNitroBuild(
  paths: {
    root: string;
    rscOutDir: string;
    ssrOutDir: string;
    clientOutDir: string;
    serverEntryName: string;
    preset: string;
    clientAssetsDir?: string;
  },
  bundle: Record<
    string,
    { type: string; fileName?: string; isEntry?: boolean; name?: string }
  > | null,
): Promise<void> {
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
    assetsDir: paths.clientAssetsDir ?? "assets",
    preset,
  });
}
