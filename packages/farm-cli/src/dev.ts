import type { FarmConfig } from "@farm.js/core";

export async function startDevServer(
  config: FarmConfig = {},
  port?: number,
  host?: string | boolean,
) {
  const { startDevServer: startFarmDevServer } = await import("@farm.js/core/server");
  return startFarmDevServer(config, port, host);
}
