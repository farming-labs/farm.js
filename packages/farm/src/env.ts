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

declare const __FARM_PUBLIC_ENV__: Record<string, unknown> | undefined;
declare const __FARM_ENV__: ResolvedFarmEnv | undefined;

const FARM_ENV_SYMBOL = Symbol.for("farm.env");
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

export function setEnv(env: ResolvedFarmEnv): void {
  currentEnv = normalizeResolvedEnv(env);
  if (typeof window === "undefined") {
    farmEnvGlobal[FARM_ENV_SYMBOL] = currentEnv;
  }
}

export function getResolvedEnv<TEnv extends ResolvedFarmEnv = FarmTypedEnv>(): TEnv {
  return getCurrentEnv() as TEnv;
}

export function getEnv<TServer extends Record<string, any> = FarmServerEnv>(): TServer;
export function getEnv<TKey extends Extract<keyof FarmServerEnv, string>>(
  key: TKey,
): FarmServerEnv[TKey];
export function getEnv(key?: string): unknown {
  assertServerEnvAccess();
  if (key === undefined) {
    return getCurrentEnv().server;
  }

  return getCurrentEnv().server[key];
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
        return env[property];
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
  if (scope === "server") {
    assertServerEnvAccess();
  }

  return getCurrentEnv()[scope] || {};
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
      return normalizeResolvedEnv(__FARM_ENV__);
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
