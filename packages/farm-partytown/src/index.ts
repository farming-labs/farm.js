import { definePlugin } from "@farm.js/core/plugin";
import {
  injectPartytownBootstrap,
  normalizeBasePath,
  partytownAssetUrl,
  PARTYTOWN_BOOTSTRAP,
  readPartytownDevAsset,
  writePartytownBuildArtifacts,
} from "./build.js";
import {
  resolvePartytownOptions,
  type PartytownForwardInput,
  type PartytownOptions,
} from "./config.js";

export type { PartytownForwardInput, PartytownOptions };
export type { PartytownForward, PartytownForwardOptions } from "./client.js";

/** Run explicitly marked third-party scripts in a Partytown web worker. */
export function partytown(options: PartytownOptions = {}) {
  const resolved = resolvePartytownOptions(options);
  let configuredBasePath = "/";
  let configuredOutputDir = ".farm/.output";

  return definePlugin({
    name: "farm:partytown",
    enforce: "pre",

    configure(config) {
      configuredBasePath = normalizeBasePath(config.basePath);
      configuredOutputDir = `${config.root ?? "."}/.farm/.output`;
      const vitePlugin = createPartytownDevPlugin(configuredBasePath, resolved);
      return {
        ...config,
        vite: {
          ...config.vite,
          plugins: [vitePlugin, ...(config.vite?.plugins ?? [])],
        },
      };
    },

    render: {
      html(html, _render, context) {
        const basePath = normalizeBasePath(context.config.basePath ?? configuredBasePath);
        return injectPartytownBootstrap(html, partytownAssetUrl(PARTYTOWN_BOOTSTRAP, basePath));
      },
    },

    build: {
      configure(nitroConfig) {
        let copied = false;
        const hooks = nitroConfig.hooks ?? {};
        const previousPrerenderDone = hooks["prerender:done"];
        const previousRollupBefore = hooks["rollup:before"];
        const copy = async () => {
          if (copied) return;
          const built = await writePartytownBuildArtifacts({
            outputDir: nitroConfig.output?.dir ?? configuredOutputDir,
            publicDir: nitroConfig.output?.publicDir,
            preset: nitroConfig.preset ?? "node-server",
            basePath: configuredBasePath,
            options: resolved,
          });
          copied = true;
          console.info(`[farm:partytown] Copied worker runtime to ${built.bootstrapUrl}`);
        };

        return {
          ...nitroConfig,
          hooks: {
            ...hooks,
            "prerender:done": async (...args: unknown[]) => {
              await callConfiguredHooks(previousPrerenderDone, args);
              await copy();
            },
            "rollup:before": async (...args: unknown[]) => {
              await callConfiguredHooks(previousRollupBefore, args);
              if (isNitroPrerenderBuild(args[0])) return;
              await copy();
            },
          },
        };
      },
    },
  });
}

function createPartytownDevPlugin(
  basePath: string,
  options: ReturnType<typeof resolvePartytownOptions>,
) {
  return {
    name: "farm:partytown-assets",
    enforce: "pre" as const,
    configureServer(server: {
      middlewares: {
        use: (
          middleware: (
            request: { method?: string; url?: string },
            response: {
              statusCode: number;
              setHeader(name: string, value: string): void;
              end(body?: Buffer | string): void;
            },
            next: (error?: unknown) => void,
          ) => void,
        ) => void;
      };
    }) {
      server.middlewares.use(async (request, response, next) => {
        if (request.method !== "GET" && request.method !== "HEAD") return next();
        const pathname = new URL(request.url ?? "/", "http://farm.local").pathname;
        try {
          const asset = await readPartytownDevAsset(pathname, basePath, options);
          if (!asset) return next();
          response.statusCode = 200;
          response.setHeader("Content-Type", asset.contentType);
          response.setHeader("Cache-Control", "no-store");
          response.end(request.method === "HEAD" ? undefined : asset.body);
        } catch (error) {
          next(error);
        }
      });
    },
  };
}

function isNitroPrerenderBuild(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const options = (value as { options?: { preset?: unknown } }).options;
  return options?.preset === "nitro-prerender";
}

async function callConfiguredHooks(value: unknown, args: unknown[]): Promise<void> {
  const hooks = Array.isArray(value) ? value : [value];
  for (const hook of hooks) {
    if (typeof hook === "function") await hook(...args);
  }
}
