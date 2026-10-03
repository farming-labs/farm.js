import type { FarmMCPConfig } from "@farm.js/core";
import { apiMcp, type APIMCPOptions } from "./index.js";

/** @internal Loaded by Farm when the top-level `mcp` config is enabled. */
export function createFarmMCPPlugin(config: FarmMCPConfig) {
  const { enabled: _enabled, ...options } = config;
  return apiMcp(options as APIMCPOptions);
}
