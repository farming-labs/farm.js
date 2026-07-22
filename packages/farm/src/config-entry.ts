import type { FarmUserConfig } from "./config";

/** Define a Farm application config while preserving literal types. */
export function defineConfig<const TConfig extends FarmUserConfig>(config: TConfig): TConfig {
  return config;
}

/** @deprecated Use {@link defineConfig}. */
export const defineFarmConfig = defineConfig;

export type { FarmUserConfig };
