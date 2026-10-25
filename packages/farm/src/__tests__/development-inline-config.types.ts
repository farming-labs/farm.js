import type { FarmUserConfig, ResolvedFarmConfig } from "../config";
import type { FarmConfig } from "../types";
import { createServer, startDevServer } from "../server/create-server";

// Compiled by the package type-check, but never starts a server.
function acceptsInlineConfig(
  userConfig: FarmUserConfig,
  runtimeConfig: FarmConfig,
  resolvedConfig: ResolvedFarmConfig,
) {
  void createServer({
    redirects: async () => [{ source: "/old", destination: "/" }],
    headers: () => [{ source: "/", headers: [{ key: "X-Test", value: "inline" }] }],
    rewrites: () => [{ source: "/alias", destination: "/" }],
  });
  void startDevServer({ redirects: () => [{ source: "/old", destination: "/" }] }, 3000);
  void createServer(userConfig);
  void createServer(runtimeConfig);
  void createServer(resolvedConfig);
  void startDevServer(userConfig);
  void startDevServer(runtimeConfig);
  void startDevServer(resolvedConfig);
}

void acceptsInlineConfig;
