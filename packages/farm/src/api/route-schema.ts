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
  if (schema["~standard"]) {
    const result = (await schema["~standard"].validate(value)) as {
      value?: unknown;
      issues?: readonly unknown[];
    };
    if (result.issues)
      throw Object.assign(new Error("Validation failed"), { issues: result.issues });
    return result.value;
  }
  if (schema.parseAsync) return schema.parseAsync(value);
  if (schema.parse) return schema.parse(value);
  throw new TypeError("Route validators must implement Standard Schema or parse().");
}
