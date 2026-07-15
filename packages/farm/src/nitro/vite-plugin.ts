import type { PluginOption, ResolvedConfig } from "vite";
import type { NitroConfig } from "nitro/config";
import type { Rollup } from "vite";
import { build, copyPublicAssets, createNitro, prepare } from "nitro";
import { dirname, resolve } from "pathe";
import { virtualBundlePlugin } from "./virtual-bundle-plugin";

// Store the SSR bundle in memory
let ssrBundle: Rollup.OutputBundle;
let ssrEntryFile: string;

function isFullUrl(str: string): boolean {
  try {
    new URL(str);
    return true;
  } catch {
    return false;
  }
}

export function farmNitroPlugin(nitroConfig?: NitroConfig): Array<PluginOption> {
  let resolvedConfig: ResolvedConfig;

  return [
    {
      name: "farm-nitro-plugin",
      // Step 1: Capture SSR bundle in memory
      generateBundle: {
        handler(_options, bundle) {
          if (this.environment?.name !== "ssr") {
            return;
          }

          // Find the entry point
          let entryFile: string | undefined;
          for (const [_name, file] of Object.entries(bundle)) {
            if (file.type === "chunk" && file.isEntry) {
              if (entryFile !== undefined) {
                this.error(`Multiple entry points found. Only one is allowed.`);
              }
              entryFile = file.fileName;
            }
          }

          if (entryFile === undefined) {
            this.error(`No entry point found for SSR build.`);
          }

          ssrEntryFile = entryFile!;
          ssrBundle = bundle;
        },
      },
      configResolved(config) {
        resolvedConfig = config;
      },
      config(_, env) {
        // Only run during build
        if (env.command !== "build") {
          return;
        }

        return {
          // Configure SSR environment
          environments: {
            ssr: {
              consumer: "server",
              build: {
                ssr: true,
                write: false, // ⭐ Don't write to disk - keep in memory
                copyPublicDir: false,
                commonjsOptions: {
                  include: [/node_modules/],
                },
              },
            },
          },

          // Orchestrate the build
          builder: {
            sharedPlugins: true,
            async buildApp(builder) {
              const client = builder.environments.client;
              const server = builder.environments.ssr;

              if (!client) {
                throw new Error("Client environment not found");
              }

              if (!server) {
                throw new Error("SSR environment not found");
              }

              // Step 2: Build client and server
              await builder.build(client);
              await builder.build(server); // This triggers generateBundle

              // Step 3: Configure Nitro
              const virtualEntry = "#farm/entry";
              const baseURL = !isFullUrl(resolvedConfig.base) ? resolvedConfig.base : undefined;

              const config: NitroConfig = {
                baseURL,
                publicAssets: [
                  {
                    dir: client.config.build.outDir,
                    maxAge: 31536000, // 1 year
                    baseURL: "/",
                  },
                ],
                ...nitroConfig,
                esbuild: {
                  options: {
                    target: server.config.build.target || undefined,
                    ...nitroConfig?.esbuild?.options,
                  },
                },
                // Step 4: Set virtual entry as renderer
                renderer: virtualEntry,
                rollupConfig: {
                  ...nitroConfig?.rollupConfig,
                  // Step 5: Add virtual bundle plugin
                  plugins: [virtualBundlePlugin(ssrBundle) as any],
                },
                // Step 6: Define virtual entry that wraps your handler
                virtual: {
                  ...nitroConfig?.virtual,
                  [virtualEntry]: `
import { defineEventHandler } from 'h3'
import handler from '${ssrEntryFile}'
export default defineEventHandler((event) => handler.fetch(event.req, {
  waitUntil: (promise) => event.waitUntil(promise),
}))
                  `.trim(),
                },
              };

              // Step 7: Build with Nitro
              const nitro = await createNitro(config);
              await prepare(nitro);
              await copyPublicAssets(nitro);
              await build(nitro);
              await nitro.close();
            },
          },
        };
      },
    },
  ];
}
