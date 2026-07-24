import type { FarmConfig } from "@farmjs/core";

export async function startDevServer(config: FarmConfig = {}, port = 3000) {
  const { startDevServer: startFarmDevServer } = await import("@farmjs/core/server");
  return startFarmDevServer(config, port);
}
