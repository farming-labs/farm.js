/**
 * Auto-generated env types from farm.config.
 * Regenerated on dev start, build, and farm generate.
 */
import type FarmConfig from "../farm.config";
import type { InferEnv } from "@farm.js/core/env";

type FarmConfigEnv = typeof FarmConfig extends { env?: infer TEnv } ? NonNullable<TEnv> : never;
type FarmResolvedEnv = [FarmConfigEnv] extends [never]
  ? { server: {}; public: {} }
  : InferEnv<FarmConfigEnv>;

declare module "@farm.js/core/env" {
  interface FarmEnvTypes {
    server: FarmResolvedEnv["server"];
    public: FarmResolvedEnv["public"];
  }
}

declare module "@farm.js/core" {
  interface FarmEnvTypes {
    server: FarmResolvedEnv["server"];
    public: FarmResolvedEnv["public"];
  }
}

export {};
