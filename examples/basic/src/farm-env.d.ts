/**
 * Auto-generated env types from Farm layers and farm.config.
 * Regenerated on dev start, build, and farm generate.
 */
import type FarmConfig0 from "../layers/recent-features/farm.config";
import type FarmConfig1 from "../farm.config";
import type { InferEnv } from "@farmjs/core/env";

type MergeFarmEnv<TBase, TOverride> = {
  server: Omit<TBase extends { server: infer T } ? T : {}, keyof (TOverride extends { server: infer T } ? T : {})> &
    (TOverride extends { server: infer T } ? T : {});
  public: Omit<TBase extends { public: infer T } ? T : {}, keyof (TOverride extends { public: infer T } ? T : {})> &
    (TOverride extends { public: infer T } ? T : {});
};

type FarmConfigEnv0 = typeof FarmConfig0 extends { env?: infer TEnv }
  ? NonNullable<TEnv>
  : never;
type FarmResolvedEnv0 = [FarmConfigEnv0] extends [never]
  ? { server: {}; public: {} }
  : InferEnv<FarmConfigEnv0>;

type FarmConfigEnv1 = typeof FarmConfig1 extends { env?: infer TEnv }
  ? NonNullable<TEnv>
  : never;
type FarmResolvedEnv1 = [FarmConfigEnv1] extends [never]
  ? { server: {}; public: {} }
  : InferEnv<FarmConfigEnv1>;
type FarmMergedEnv1 = MergeFarmEnv<FarmResolvedEnv0, FarmResolvedEnv1>;

type FarmResolvedEnv = FarmMergedEnv1;

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
