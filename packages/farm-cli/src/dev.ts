import type { FarmConfig } from "@farm.js/core";
import { ensureFarmRscPackages } from "./rsc-packages";

export async function startDevServer(
  config: FarmConfig = {},
  port?: number,
  host?: string | boolean,
) {
  const { startDevServer: startFarmDevServer } = await import("@farm.js/core/server");
  return startFarmDevServer(config, port, {
    host,
    ensureServerComponentsPackages: (userConfig: unknown, root: string) =>
      ensureFarmRscPackages(userConfig as Record<string, any>, root),
  });
}
