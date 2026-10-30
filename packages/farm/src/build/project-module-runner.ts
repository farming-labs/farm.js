import type { DevEnvironment, EnvironmentOptions } from "vite";

/**
 * The SSR environment of the build's project module server, which loads route modules for the
 * route runtime manifest and SSG while the production bundles build.
 *
 * Its module runner runs in this process and talks to the server over an in-process channel, so
 * a request cannot be lost. Vite's default 60 s RPC timeout can only fire when the event loop is
 * busy for that long, which the concurrent production build does on a small machine (Tailwind
 * scanning a large site on a 2-core CI runner kept a route module waiting past it, failing the
 * build). Everything else matches Vite's default server module runner.
 */
export async function createFarmProjectModuleSsrEnvironment(): Promise<EnvironmentOptions> {
  const vite = await import("vite");
  const { ModuleRunner, createNodeImportMeta } = await import("vite/module-runner");
  return {
    dev: {
      createEnvironment(name, config) {
        return vite.createRunnableDevEnvironment(name, config, {
          runner: (environment: DevEnvironment) =>
            new ModuleRunner({
              transport: {
                ...vite.createServerModuleRunnerTransport({ channel: environment.hot }),
                timeout: 0,
              },
              hmr: false,
              createImportMeta: createNodeImportMeta,
              sourcemapInterceptor: "node",
            }),
        });
      },
    },
  };
}
