import { definePlugin } from "@farm.js/core/plugin";
import { normalizeBasePath, withBasePath, writeSearchIndex } from "./build.js";
import { resolveSearchOptions, type SearchOptions } from "./config.js";
import type { FarmSearchPublicConfig } from "./types.js";

export type { ResolvedSearchOptions, SearchOptions } from "./config.js";
export type {
  FarmSearchClient,
  SearchClientOptions,
  SearchFilterCounts,
  SearchFilterExpression,
  SearchFilterPrimitive,
  SearchFilters,
  SearchQueryOptions,
  SearchResponse,
  SearchResult,
  SearchSort,
  SearchSubResult,
  SearchTimings,
} from "./types.js";

/** Build a static Pagefind index from Farm's emitted HTML pages. */
export function search(options: SearchOptions = {}) {
  const resolved = resolveSearchOptions(options);
  let configuredBasePath = "/";
  let generated = false;
  const publicConfig: FarmSearchPublicConfig = {
    available: false,
    bundlePath: `/${resolved.output}/`,
    excerptLength: resolved.excerptLength,
    ...(resolved.highlightParam ? { highlightParam: resolved.highlightParam } : {}),
  };

  return definePlugin({
    name: "farm:search",
    enforce: "post",

    configure(config) {
      if (
        (config.plugins ?? []).filter((candidate) => candidate.name === "farm:search").length > 1
      ) {
        throw new Error("[farm:search] Configure search in one search() plugin instance");
      }
      configuredBasePath = normalizeBasePath(config.basePath);
      publicConfig.bundlePath = `${withBasePath(`/${resolved.output}`, configuredBasePath)}/`;
    },

    build: {
      before() {
        generated = false;
      },

      configure(nitroConfig) {
        const hooks = nitroConfig.hooks ?? {};
        const previousPrerenderDone = hooks["prerender:done"];
        const generate = async () => {
          if (generated) return;
          const result = await writeSearchIndex({
            outputDir: nitroConfig.output?.dir ?? ".farm/.output",
            publicDir: nitroConfig.output?.publicDir,
            preset: nitroConfig.preset ?? "node-server",
            basePath: configuredBasePath,
            options: resolved,
          });
          generated = true;
          console.info(
            `[farm:search] Indexed ${result.indexedRoutes.length} static page${
              result.indexedRoutes.length === 1 ? "" : "s"
            } at ${result.bundlePath}`,
          );
        };

        return {
          ...nitroConfig,
          hooks: {
            ...hooks,
            "prerender:done": async (...args: unknown[]) => {
              await callConfiguredHooks(previousPrerenderDone, args);
              await generate();
            },
          },
        };
      },

      async after(result) {
        if (!result.success || generated) return;
        const built = await writeSearchIndex({
          outputDir: result.outputDir ?? `${result.root}/.farm/.output`,
          preset: result.preset,
          basePath: configuredBasePath,
          options: resolved,
        });
        generated = true;
        console.info(
          `[farm:search] Indexed ${built.indexedRoutes.length} static page${
            built.indexedRoutes.length === 1 ? "" : "s"
          } at ${built.bundlePath}`,
        );
      },
    },

    client: {
      public: publicConfig,
      async setup({ public: config, isProd }) {
        const runtime = await import("@farm.js/search/client");
        runtime.configureFarmSearch({ ...config, available: isProd });
      },
    },
  });
}

async function callConfiguredHooks(value: unknown, args: unknown[]): Promise<void> {
  const hooks = Array.isArray(value) ? value : [value];
  for (const hook of hooks) {
    if (typeof hook === "function") await hook(...args);
  }
}
