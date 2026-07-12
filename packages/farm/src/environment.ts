type AnyEnvironmentFunction = (...args: never[]) => unknown;

export type FarmEnvironment = "server" | "client";

export interface FarmIsomorphicFnOptions<TArgs extends unknown[], TServerResult, TClientResult> {
  server: (...args: TArgs) => TServerResult;
  client: (...args: TArgs) => TClientResult;
}

export class FarmEnvironmentError extends Error {
  readonly code = "FARM_ENVIRONMENT_MISMATCH";

  constructor(
    readonly api: "createServerOnlyFn" | "createClientOnlyFn",
    readonly expected: FarmEnvironment,
    readonly actual: FarmEnvironment,
  ) {
    super(`${api}() can only be called on the ${expected}. It was called on the ${actual}.`);
    this.name = "FarmEnvironmentError";
  }
}

export function createServerOnlyFn<TFunction extends AnyEnvironmentFunction>(
  implementation: TFunction,
): TFunction;
export function createServerOnlyFn(
  implementation: AnyEnvironmentFunction | undefined,
  compiledActualEnvironment?: FarmEnvironment,
): AnyEnvironmentFunction {
  if (compiledActualEnvironment) {
    return createMismatchFunction("createServerOnlyFn", "server", compiledActualEnvironment);
  }
  if (getRuntimeEnvironment() !== "server") {
    return createMismatchFunction("createServerOnlyFn", "server");
  }

  assertFunction(implementation, "createServerOnlyFn");
  return implementation;
}

export function createClientOnlyFn<TFunction extends AnyEnvironmentFunction>(
  implementation: TFunction,
): TFunction;
export function createClientOnlyFn(
  implementation: AnyEnvironmentFunction | undefined,
  compiledActualEnvironment?: FarmEnvironment,
): AnyEnvironmentFunction {
  if (compiledActualEnvironment) {
    return createMismatchFunction("createClientOnlyFn", "client", compiledActualEnvironment);
  }
  if (getRuntimeEnvironment() !== "client") {
    return createMismatchFunction("createClientOnlyFn", "client");
  }

  assertFunction(implementation, "createClientOnlyFn");
  return implementation;
}

export function createIsomorphicFn<TArgs extends unknown[], TServerResult, TClientResult>(
  options: FarmIsomorphicFnOptions<TArgs, TServerResult, TClientResult>,
): (...args: TArgs) => TServerResult | TClientResult {
  if (!options || typeof options !== "object") {
    throw new TypeError("createIsomorphicFn requires server and client functions");
  }

  assertFunction(options.server, "createIsomorphicFn server");
  assertFunction(options.client, "createIsomorphicFn client");

  return getRuntimeEnvironment() === "server" ? options.server : options.client;
}

function getRuntimeEnvironment(): FarmEnvironment {
  return typeof window === "undefined" ? "server" : "client";
}

function createMismatchFunction(
  api: "createServerOnlyFn" | "createClientOnlyFn",
  expected: FarmEnvironment,
  actual: FarmEnvironment = expected === "server" ? "client" : "server",
) {
  return function farmEnvironmentBoundary(): never {
    throw new FarmEnvironmentError(api, expected, actual);
  };
}

function assertFunction(value: unknown, label: string): asserts value is AnyEnvironmentFunction {
  if (typeof value !== "function") {
    throw new TypeError(`${label} must be a function`);
  }
}
