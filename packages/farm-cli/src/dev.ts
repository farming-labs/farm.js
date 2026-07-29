import type { FarmConfig } from "@farm.js/core";

export async function startDevServer(config: FarmConfig = {}, port = 3000) {
  const { startDevServer: startFarmDevServer } = await import("@farm.js/core/server");
  return startFarmDevServer(config, port);
}
