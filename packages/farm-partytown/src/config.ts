import type { PartytownForward } from "./shared.js";
import { readPartytownForward, validateForwardPath } from "./shared.js";

export type PartytownForwardInput = string | PartytownForward<(...args: any[]) => unknown>;

export interface PartytownOptions {
  /** Global calls that should be forwarded from the main thread to the worker. */
  forward?: readonly PartytownForwardInput[];
  /** Use Partytown's debug runtime. Defaults to true in development and false in production. */
  debug?: boolean;
  /** Milliseconds before Partytown falls back to the main thread. Set to 0 to disable fallback. */
  fallbackTimeout?: number;
  /** Use strict proxy `has` behavior for scripts that require it. */
  strictProxyHas?: boolean;
}

export interface ResolvedPartytownForward {
  path: string;
  preserveBehavior: boolean;
}

export interface ResolvedPartytownOptions {
  forward: ResolvedPartytownForward[];
  debug?: boolean;
  fallbackTimeout?: number;
  strictProxyHas?: boolean;
}

export function resolvePartytownOptions(options: PartytownOptions): ResolvedPartytownOptions {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("partytown options must be an object");
  }
  if ("enabled" in options) {
    throw new TypeError(
      "partytown does not accept enabled; remove partytown() from plugins to disable it",
    );
  }
  assertBoolean(options.debug, "debug");
  assertBoolean(options.strictProxyHas, "strictProxyHas");
  if (
    options.fallbackTimeout !== undefined &&
    (!Number.isInteger(options.fallbackTimeout) || options.fallbackTimeout < 0)
  ) {
    throw new TypeError("partytown fallbackTimeout must be a non-negative integer");
  }
  if (options.forward !== undefined && !Array.isArray(options.forward)) {
    throw new TypeError("partytown forward must be an array");
  }

  const forwards = new Map<string, ResolvedPartytownForward>();
  for (const input of options.forward ?? []) {
    const descriptor = readPartytownForward(input) ?? {
      path: validateForwardPath(input),
      preserveBehavior: false,
    };
    const previous = forwards.get(descriptor.path);
    if (previous && previous.preserveBehavior !== descriptor.preserveBehavior) {
      throw new TypeError(
        `partytown forward path ${JSON.stringify(descriptor.path)} has conflicting preserveBehavior settings`,
      );
    }
    forwards.set(descriptor.path, descriptor);
  }

  return {
    forward: [...forwards.values()],
    debug: options.debug,
    fallbackTimeout: options.fallbackTimeout,
    strictProxyHas: options.strictProxyHas,
  };
}

function assertBoolean(value: unknown, key: string): void {
  if (value !== undefined && typeof value !== "boolean") {
    throw new TypeError(`partytown ${key} must be boolean`);
  }
}
