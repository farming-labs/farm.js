import {
  markPartytownForward,
  validateForwardPath,
  type PartytownForward,
  type PartytownForwardOptions,
} from "./shared.js";

export type { PartytownForward, PartytownForwardOptions };

/**
 * Create a typed caller for a global function forwarded to Partytown.
 * The same value can be passed to `partytown({ forward: [...] })` and called
 * from browser code without declaring a vendor global on `window`.
 */
export function defineForward<T extends (...args: any[]) => unknown>(
  path: string,
  options: PartytownForwardOptions = {},
): PartytownForward<T> {
  const resolvedPath = validateForwardPath(path);
  if (typeof options !== "object" || options === null || Array.isArray(options)) {
    throw new TypeError("partytown forward options must be an object");
  }
  if (options.preserveBehavior !== undefined && typeof options.preserveBehavior !== "boolean") {
    throw new TypeError("partytown forward preserveBehavior must be boolean");
  }
  const preserveBehavior = options.preserveBehavior ?? false;
  const segments = resolvedPath.split(".");

  const forward = (...args: Parameters<T>): void => {
    if (typeof window === "undefined") return;

    let owner: unknown = window;
    for (let index = 0; index < segments.length - 1; index += 1) {
      if ((typeof owner !== "object" && typeof owner !== "function") || owner === null) return;
      owner = Reflect.get(owner, segments[index]!);
    }
    if ((typeof owner !== "object" && typeof owner !== "function") || owner === null) return;
    const callable = Reflect.get(owner, segments.at(-1)!);
    if (typeof callable === "function") Reflect.apply(callable, owner, args);
  };

  return markPartytownForward<T>(forward, {
    path: resolvedPath,
    preserveBehavior,
  });
}
