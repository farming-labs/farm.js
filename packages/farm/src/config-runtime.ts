export { loadConfig, resolveConfig, resolveDeployConfig } from "./config";
export { loadFarmProductionVite } from "./build/production-vite";
export type { FarmProductionViteRuntime } from "./build/production-vite";
export { logger } from "./utils";
export {
  createFarmDesktopContext,
  getFarmDesktopOutputDirs,
  installFarmDesktopSetup,
  resolveFarmDesktopBlock,
  resolveFarmDesktopConfig,
  validateFarmDesktopConfig,
  type FarmDesktopSetupOptions,
  setFarmDesktopDevSession,
  type FarmDesktopDevSession,
} from "./desktop/config";

/** The `mobile` block and its route manifest, loaded only by mobile commands. */
export function loadFarmMobileRuntime(): Promise<typeof import("./mobile/runtime")> {
  return import("./mobile/runtime");
}
