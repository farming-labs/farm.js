import { readFarmEnvironmentValue } from "./utils/runtime-env";

export interface EnvSchema<TOutput = unknown> {
  parse(value: unknown): TOutput;
}

export type EnvParser<TOutput = unknown> =
  | EnvSchema<TOutput>
  | ((value: string | undefined, context: { key: string; scope: "server" | "public" }) => TOutput);

export type EnvShape = Record<string, EnvParser<any>>;

export type InferEnvParser<TParser> =
  TParser extends EnvSchema<infer TOutput>
    ? TOutput
    : TParser extends (value: string | undefined, context: any) => infer TOutput
      ? TOutput
      : never;

export type InferEnvShape<TShape> = TShape extends EnvShape
  ? { [K in keyof TShape]: InferEnvParser<TShape[K]> }
  : {};

export interface FarmEnvConfig<
  TServer extends EnvShape = EnvShape,
  TPublic extends EnvShape = EnvShape,
> {
  server?: TServer;
  public?: TPublic;
}

export interface ResolvedFarmEnv<
  TServer extends Record<string, any> = Record<string, unknown>,
  TPublic extends Record<string, any> = Record<string, unknown>,
> {
  server: TServer;
  public: TPublic;
}

export type InferEnv<TConfig> =
  TConfig extends FarmEnvConfig<infer TServer, infer TPublic>
    ? ResolvedFarmEnv<InferEnvShape<TServer>, InferEnvShape<TPublic>>
    : ResolvedFarmEnv;

/**
 * Augmented by generated src/farm.d.ts for project-specific autocomplete.
 */
export interface FarmEnvTypes {}

export type FarmServerEnv = FarmEnvTypes extends { server: infer TServer }
  ? TServer extends Record<string, any>
    ? TServer
    : Record<string, unknown>
  : Record<string, unknown>;

export type FarmPublicEnv = FarmEnvTypes extends { public: infer TPublic }
  ? TPublic extends Record<string, any>
    ? TPublic
    : Record<string, unknown>
  : Record<string, unknown>;

export type FarmTypedEnv = ResolvedFarmEnv<FarmServerEnv, FarmPublicEnv>;

export type FarmEnvRuntimeType = "string" | "number" | "boolean" | "json";

/**
 * The env a server bundle carries. `runtime.server` lists server keys that are
 * read from the server's environment instead of being stored in the bundle,
 * with the type their parsed value had at build time.
 */
export interface BundledFarmEnv extends ResolvedFarmEnv {
  runtime?: { server: Record<string, FarmEnvRuntimeType> };
}

declare const __FARM_PUBLIC_ENV__: Record<string, unknown> | undefined;
declare const __FARM_ENV__: BundledFarmEnv | undefined;

const FARM_ENV_SYMBOL = Symbol.for("farm.env");
// Kept on the env object itself so duplicated module instances share it.
const FARM_ENV_RUNTIME_SYMBOL = Symbol.for("farm.env.runtime");
type RuntimeEnvState = { pending: Record<string, FarmEnvRuntimeType>; warned: Set<string> };
type EnvWithRuntime = ResolvedFarmEnv & { [FARM_ENV_RUNTIME_SYMBOL]?: RuntimeEnvState };
const farmEnvGlobal = globalThis as typeof globalThis & {
  [FARM_ENV_SYMBOL]?: ResolvedFarmEnv;
};
let currentEnv: ResolvedFarmEnv = getInitialEnv();

export function resolveEnv<TConfig extends FarmEnvConfig<any, any> | undefined>(
  config: TConfig,
  source: Record<string, string | undefined> = getProcessEnv(),
): InferEnv<NonNullable<TConfig>> {
  const resolved = {
    server: resolveEnvScope(config?.server, source, "server"),
    public: resolveEnvScope(config?.public, source, "public"),
  } as InferEnv<NonNullable<TConfig>>;

  return resolved;
}

/**
 * Prepare resolved env for a server bundle. Server values that came from the
 * build environment are left out and read from the server's environment when
 * the server uses them, so secrets never land in build output and a restart
 * picks up a rotated value. Values a parser produced without an env var
 * (defaults) stay, and so do values the runtime cannot rebuild from the raw
 * string, because the parser itself does not run in the server bundle.
 */
export function createBundledEnv(
  env: ResolvedFarmEnv | FarmEnvConfig<any, any> | undefined,
  source: Record<string, string | undefined> = getProcessEnv(),
): BundledFarmEnv {
  const resolved = normalizeResolvedEnv((env ?? {}) as ResolvedFarmEnv);
  const server: Record<string, unknown> = {};
  const runtime: Record<string, FarmEnvRuntimeType> = {};
  for (const [key, value] of Object.entries(resolved.server)) {
    const raw = source[key];
    const type = getRuntimeEnvType(value);
    if (raw !== undefined && isSameEnvValue(coerceRuntimeEnvValue(raw, type), value)) {
      runtime[key] = type;
    } else {
      server[key] = value;
    }
  }

  return {
    server,
    public: resolved.public,
    ...(Object.keys(runtime).length > 0 ? { runtime: { server: runtime } } : {}),
  };
}

export function setEnv(env: ResolvedFarmEnv | BundledFarmEnv): void {
  currentEnv = prepareEnv(env);
  if (typeof window === "undefined") {
    farmEnvGlobal[FARM_ENV_SYMBOL] = currentEnv;
  }
}

export function getResolvedEnv<TEnv extends ResolvedFarmEnv = FarmTypedEnv>(): TEnv {
  const env = getCurrentEnv();
  if (typeof window === "undefined") readRuntimeServerEnv(env);
  return env as TEnv;
}

export function getEnv<TServer extends Record<string, any> = FarmServerEnv>(): TServer;
export function getEnv<TKey extends Extract<keyof FarmServerEnv, string>>(
  key: TKey,
): FarmServerEnv[TKey];
export function getEnv(key?: string): unknown {
  const server = getEnvScope("server");
  if (key === undefined) {
    return server;
  }

  return readServerEnvKey(server, key);
}

export function getPublicEnv<TPublic extends Record<string, any> = FarmPublicEnv>(): TPublic;
export function getPublicEnv<TKey extends Extract<keyof FarmPublicEnv, string>>(
  key: TKey,
): FarmPublicEnv[TKey];
export function getPublicEnv(key?: string): unknown {
  if (key === undefined) {
    return getCurrentEnv().public;
  }

  return getCurrentEnv().public[key];
}

export const env = createEnvProxy("server") as FarmServerEnv;
export const serverEnv = env;
export const publicEnv = createEnvProxy("public") as FarmPublicEnv;

function resolveEnvScope(
  shape: EnvShape | undefined,
  source: Record<string, string | undefined>,
  scope: "server" | "public",
): Record<string, unknown> {
  if (!shape) {
    return {};
  }

  const resolved: Record<string, unknown> = {};

  for (const [key, parser] of Object.entries(shape)) {
    try {
      resolved[key] = parseEnvValue(parser, source[key], key, scope);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Invalid ${scope} env "${key}": ${message}`);
    }
  }

  return resolved;
}

function parseEnvValue(
  parser: EnvParser<any>,
  value: string | undefined,
  key: string,
  scope: "server" | "public",
): unknown {
  if (typeof parser === "function") {
    return parser(value, { key, scope });
  }

  if (parser && typeof parser.parse === "function") {
    return parser.parse(value);
  }

  throw new Error("expected a parser function or schema with parse()");
}

function createEnvProxy(scope: "server" | "public"): Record<string, unknown> {
  return new Proxy(
    {},
    {
      get(_target, property) {
        if (typeof property === "symbol") {
          return undefined;
        }

        const env = getEnvScope(scope);
        return scope === "server" ? readServerEnvKey(env, property) : env[property];
      },
      ownKeys() {
        return Reflect.ownKeys(getEnvScope(scope));
      },
      getOwnPropertyDescriptor(_target, property) {
        const env = getEnvScope(scope);
        if (!(property in env)) {
          return undefined;
        }

        return {
          enumerable: true,
          configurable: true,
          value: env[property as keyof typeof env],
        };
      },
      has(_target, property) {
        return property in getEnvScope(scope);
      },
    },
  );
}

function getEnvScope(scope: "server" | "public"): Record<string, unknown> {
  const env = getCurrentEnv();
  if (scope === "server") {
    assertServerEnvAccess();
    readRuntimeServerEnv(env);
  }

  return env[scope] || {};
}

function readServerEnvKey(server: Record<string, unknown>, key: string): unknown {
  const value = server[key];
  if (value === undefined) {
    const state = (getCurrentEnv() as EnvWithRuntime)[FARM_ENV_RUNTIME_SYMBOL];
    if (state && key in state.pending && !state.warned.has(key)) {
      state.warned.add(key);
      console.warn(
        `[Farm] Server env "${key}" was set when this app was built but is not set where the ` +
          `server runs, so it reads as undefined. Farm reads server env at runtime and does ` +
          `not store it in the build output; set "${key}" in the server's environment.`,
      );
    }
  }
  return value;
}

/**
 * Fill server keys that are read at runtime from the server's environment:
 * runtime bindings on `globalThis.__env__` (Cloudflare Workers), then
 * `process.env`.
 */
function readRuntimeServerEnv(env: EnvWithRuntime): void {
  const state = env[FARM_ENV_RUNTIME_SYMBOL];
  if (!state) return;
  for (const [key, type] of Object.entries(state.pending)) {
    const raw = readFarmEnvironmentValue(key);
    if (raw === undefined) continue;
    env.server[key] = coerceRuntimeEnvValue(raw, type);
    delete state.pending[key];
  }
}

function getRuntimeEnvType(value: unknown): FarmEnvRuntimeType {
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  if (value !== null && typeof value === "object" && !(value instanceof Date)) return "json";
  return "string";
}

function coerceRuntimeEnvValue(raw: string, type: FarmEnvRuntimeType): unknown {
  if (type === "number") {
    const value = Number(raw);
    return raw.trim() !== "" && Number.isFinite(value) ? value : raw;
  }
  if (type === "boolean") {
    if (/^(true|1)$/i.test(raw.trim())) return true;
    if (/^(false|0|)$/i.test(raw.trim())) return false;
    return raw;
  }
  if (type === "json") {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  return raw;
}

function isSameEnvValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((item, index) => isSameEnvValue(item, right[index]))
    );
  }
  if (!isPlainObject(left) || !isPlainObject(right)) return false;
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(right, key) && isSameEnvValue(left[key], right[key]),
    )
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function prepareEnv(env: ResolvedFarmEnv | BundledFarmEnv): ResolvedFarmEnv {
  const normalized = normalizeResolvedEnv(env);
  const runtime = (env as BundledFarmEnv).runtime?.server;
  if (!isRecord(runtime) || Object.keys(runtime).length === 0) return normalized;
  const prepared: EnvWithRuntime = { server: { ...normalized.server }, public: normalized.public };
  Object.defineProperty(prepared, FARM_ENV_RUNTIME_SYMBOL, {
    value: {
      pending: { ...(runtime as Record<string, FarmEnvRuntimeType>) },
      warned: new Set<string>(),
    },
    enumerable: false,
  });
  return prepared;
}

function assertServerEnvAccess(): void {
  if (typeof window !== "undefined") {
    throw new Error("Farm server env is not available in the browser. Use publicEnv.");
  }
}

function getInitialEnv(): ResolvedFarmEnv {
  const injectedEnv = getInjectedEnv();
  if (injectedEnv) {
    return injectedEnv;
  }

  if (typeof window === "undefined" && farmEnvGlobal[FARM_ENV_SYMBOL]) {
    return normalizeResolvedEnv(farmEnvGlobal[FARM_ENV_SYMBOL]);
  }

  return {
    server: {},
    public: getInjectedPublicEnv(),
  };
}

function getCurrentEnv(): ResolvedFarmEnv {
  if (typeof window === "undefined" && farmEnvGlobal[FARM_ENV_SYMBOL]) {
    return farmEnvGlobal[FARM_ENV_SYMBOL];
  }

  return currentEnv;
}

function getInjectedEnv(): ResolvedFarmEnv | null {
  try {
    if (typeof __FARM_ENV__ !== "undefined" && __FARM_ENV__) {
      return prepareEnv(__FARM_ENV__);
    }
  } catch {
    // The compile-time global is only defined in Farm server bundles.
  }

  return null;
}

function getInjectedPublicEnv(): Record<string, unknown> {
  try {
    if (typeof __FARM_PUBLIC_ENV__ !== "undefined" && __FARM_PUBLIC_ENV__) {
      return __FARM_PUBLIC_ENV__;
    }
  } catch {
    // The compile-time global is only defined in Farm browser bundles.
  }

  return {};
}

function normalizeResolvedEnv(env: ResolvedFarmEnv): ResolvedFarmEnv {
  return {
    server: isRecord(env.server) ? env.server : {},
    public: isRecord(env.public) ? env.public : {},
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function getProcessEnv(): Record<string, string | undefined> {
  if (typeof process !== "undefined" && process.env) {
    return process.env;
  }

  return {};
}
