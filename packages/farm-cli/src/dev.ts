import type { FarmConfig } from "@farm.js/core";

export async function startDevServer(config: FarmConfig = {}, port?: number) {
  const { startDevServer: startFarmDevServer } = await import("@farm.js/core/server");
  return startFarmDevServer(config, port);
}
