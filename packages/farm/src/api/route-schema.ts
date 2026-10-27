/** Server-only schema contract shared by declarative routes and the API runtime. */
export interface RouteSchema {
  readonly _input?: unknown;
  readonly _output?: unknown;
  parse?: (value: unknown) => unknown;
  parseAsync?: (value: unknown) => Promise<unknown>;
  readonly "~standard"?: {
    readonly types?: { input: unknown; output: unknown };
    validate(value: unknown): unknown;
  };
}

export type RouteSchemaInput<T> = T extends { _input: infer I }
  ? I
  : T extends { "~standard": { types?: { input: infer I } } }
    ? I
    : unknown;

export type RouteSchemaOutput<T> = T extends { _output: infer O }
  ? O
  : T extends { "~standard": { types?: { output: infer O } } }
    ? O
    : T extends { parse: (...args: any[]) => infer O }
      ? Awaited<O>
      : unknown;

export async function parseRouteSchema(schema: RouteSchema, value: unknown): Promise<unknown> {
  // Prefer an explicitly asynchronous parser. Some Standard Schema adapters try
  // a synchronous parse first, then repeat async refinements when it fails.
  if (schema.parseAsync) return schema.parseAsync(value);
  if (schema["~standard"]) {
    const result = (await schema["~standard"].validate(value)) as {
      value?: unknown;
      issues?: readonly unknown[];
    };
    if (result.issues)
      throw Object.assign(new Error("Validation failed"), { issues: result.issues });
    return result.value;
  }
  if (schema.parse) return schema.parse(value);
  throw new TypeError("Route validators must implement Standard Schema or parse().");
}

/** A validation issue that is safe to send to the caller. */
export interface PublicValidationIssue {
  path: (string | number)[];
  code?: string;
  message: string;
}

/**
 * Describes validator issues without their messages. A validator's default
 * message can quote what it expected, such as a literal, enum, or pattern, and
 * schemas sometimes hold secrets (`z.literal(\`Bearer ${token}\`)`). Only
 * refinement messages (`code: "custom"`), which the app wrote, are kept.
 */
export function toPublicValidationIssues(error: unknown): PublicValidationIssue[] {
  const issues = (error as { issues?: unknown; errors?: unknown } | null | undefined)?.issues;
  const list = Array.isArray(issues)
    ? issues
    : Array.isArray((error as { errors?: unknown } | null | undefined)?.errors)
      ? ((error as { errors: unknown[] }).errors as unknown[])
      : [];
  return list.map((issue) => {
    const { path, code, message } = (issue ?? {}) as {
      path?: unknown;
      code?: unknown;
      message?: unknown;
    };
    return {
      path: Array.isArray(path) ? path.map(toPublicPathSegment) : [],
      ...(typeof code === "string" ? { code } : {}),
      message:
        code === "custom" && typeof message === "string" && message ? message : "Invalid value",
    };
  });
}

function toPublicPathSegment(segment: unknown): string | number {
  const key =
    segment && typeof segment === "object" && "key" in segment
      ? (segment as { key: unknown }).key
      : segment;
  if (typeof key === "number") return key;
  if (typeof key === "symbol") return key.description || key.toString();
  return String(key);
}
