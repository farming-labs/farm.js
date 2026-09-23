const FORWARD_MARKER = Symbol.for("@farm.js/partytown.forward");
const FORBIDDEN_PATH_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

export interface PartytownForwardOptions {
  /** Also run an existing main-thread implementation before forwarding the call. */
  preserveBehavior?: boolean;
}

export type PartytownForward<T extends (...args: any[]) => unknown> = ((
  ...args: Parameters<T>
) => void) & {
  readonly path: string;
  readonly preserveBehavior: boolean;
};

export interface PartytownForwardDescriptor {
  path: string;
  preserveBehavior: boolean;
}

export function markPartytownForward<T extends (...args: any[]) => unknown>(
  value: (...args: Parameters<T>) => void,
  descriptor: PartytownForwardDescriptor,
): PartytownForward<T> {
  Object.defineProperties(value, {
    [FORWARD_MARKER]: { value: true },
    path: { value: descriptor.path, enumerable: true },
    preserveBehavior: { value: descriptor.preserveBehavior, enumerable: true },
  });
  return value as PartytownForward<T>;
}

export function readPartytownForward(value: unknown): PartytownForwardDescriptor | undefined {
  if (typeof value !== "function") return undefined;
  const candidate = value as unknown as Record<PropertyKey, unknown>;
  if (candidate[FORWARD_MARKER] !== true) return undefined;
  if (typeof candidate.path !== "string" || typeof candidate.preserveBehavior !== "boolean") {
    return undefined;
  }
  return { path: candidate.path, preserveBehavior: candidate.preserveBehavior };
}

export function validateForwardPath(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError("partytown forward path must be a non-empty string");
  }
  const path = value.trim();
  if (path.length > 256)
    throw new TypeError("partytown forward path must be 256 characters or less");

  const segments = path.split(".");
  if (
    segments.some((segment) => !IDENTIFIER.test(segment) || FORBIDDEN_PATH_SEGMENTS.has(segment))
  ) {
    throw new TypeError(
      `partytown forward path ${JSON.stringify(path)} must contain only safe dotted JavaScript identifiers`,
    );
  }
  return path;
}
