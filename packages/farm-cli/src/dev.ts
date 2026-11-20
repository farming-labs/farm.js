import type { FarmConfig } from "@farm.js/core";

export async function startDevServer(
  config: FarmConfig = {},
  port?: number,
  host?: string | boolean,
) {
  const { startDevServer: startFarmDevServer } = await import("@farm.js/core/server");
  return startFarmDevServer(config, port, {
    host,
    // Core calls this only for an app with `experimental.serverComponents`. Loading it lazily keeps
    // every other `farm dev` from loading the CLI's CommonJS copy of core beside the server's own.
    ensureServerComponentsPackages: async (userConfig: unknown, root: string) => {
      const { ensureFarmRscPackages } = await import("./rsc-packages");
      return ensureFarmRscPackages(userConfig as Record<string, any>, root);
    },
  });
}
