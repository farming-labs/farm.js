/**
 * Auto-generated env types from farm.config.
 * Regenerated on dev start, build, and farm generate.
 */
import type FarmConfig from "../farm.config";
import type { InferEnv } from "@farmjs/core/env";

type FarmConfigEnv = typeof FarmConfig extends { env?: infer TEnv } ? NonNullable<TEnv> : never;
type FarmResolvedEnv = [FarmConfigEnv] extends [never]
  ? { server: {}; public: {} }
  : InferEnv<FarmConfigEnv>;

declare module "@farmjs/core/env" {
  interface FarmEnvTypes {
    server: FarmResolvedEnv["server"];
    public: FarmResolvedEnv["public"];
  }
}

declare module "@farmjs/core" {
  interface FarmEnvTypes {
    server: FarmResolvedEnv["server"];
    public: FarmResolvedEnv["public"];
  }
}

export {};
