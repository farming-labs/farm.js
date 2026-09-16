/**
 * Environment access that works across the runtimes Farm targets.
 *
 * Serverless and edge runtimes (Cloudflare Workers in particular) expose
 * bindings on `globalThis.__env__` rather than `process.env`, so security
 * checks that read `process.env` directly see an empty value there and can
 * silently take an "unconfigured" code path in a deployed environment.
 */
export function getFarmRuntimeBindings(): Record<string, unknown> | undefined {
  const runtimeBindings = (
    globalThis as typeof globalThis & {
      __env__?: Record<string, unknown>;
    }
  ).__env__;
  return runtimeBindings && typeof runtimeBindings === "object" ? runtimeBindings : undefined;
}

export function readFarmEnvironmentValue(name: string): string | undefined {
  const runtimeValue = getFarmRuntimeBindings()?.[name];
  if (typeof runtimeValue === "string") return runtimeValue;
  return typeof process !== "undefined" ? process.env?.[name] : undefined;
}

/**
 * True when the process looks like a deployed runtime rather than local
 * development: either NODE_ENV is production, or runtime bindings are present
 * (a deployed worker where NODE_ENV is frequently unset).
 */
export function isFarmDeployedRuntime(): boolean {
  if (getFarmRuntimeBindings()) return true;
  return readFarmEnvironmentValue("NODE_ENV") === "production";
}
