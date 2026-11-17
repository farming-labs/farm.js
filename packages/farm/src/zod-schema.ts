/**
 * Reading a Zod schema's structure (Zod 3 and 4) without importing Zod: the OpenAPI generator
 * documents request schemas with it, and the API runtime reads which query fields are arrays.
 */
const zodTypeNameKinds: Record<string, string> = {
  ZodArray: "array",
  ZodBoolean: "boolean",
  ZodDefault: "default",
  ZodEffects: "effects",
  ZodEnum: "enum",
  ZodLiteral: "literal",
  ZodNullable: "nullable",
  ZodNumber: "number",
  ZodObject: "object",
  ZodOptional: "optional",
  ZodPipeline: "pipe",
  ZodRecord: "record",
  ZodString: "string",
  ZodTuple: "tuple",
  ZodUnion: "union",
};

export function getZodKind(schema: unknown): string | undefined {
  if (!schema || typeof schema !== "object") return undefined;
  const definition = (schema as any)._def;
  if (!definition || typeof definition !== "object") return undefined;
  if (typeof definition.type === "string") return definition.type;
  return typeof definition.typeName === "string"
    ? zodTypeNameKinds[definition.typeName]
    : undefined;
}

export function getZodObjectShape(schema: unknown): Record<string, unknown> | undefined {
  if (getZodKind(schema) !== "object") return undefined;
  const candidate = (schema as any).shape ?? (schema as any)._def?.shape;
  const shape = typeof candidate === "function" ? candidate() : candidate;
  return shape && typeof shape === "object" ? shape : undefined;
}

/**
 * The schema a client sends for a transform-like wrapper, or `undefined` when the schema is not
 * one. Request documentation describes what the client sends, not what the handler receives:
 *
 * - Zod 4 `.transform()`, `.pipe()` and codecs are pipes, documented by their input side. A
 *   `z.preprocess(fn, schema)` pipe starts with a transform that accepts anything, so its target
 *   schema is the closest description, as Zod's own `toJSONSchema({ io: "input" })` chooses.
 * - Zod 3 `.transform()`, `.refine()` and `z.preprocess()` are effects around their schema, and
 *   `.pipe()` is a pipeline documented by its input side.
 */
export function getZodTransformInput(schema: unknown): unknown {
  const kind = getZodKind(schema);
  const definition = (schema as any)?._def;
  if (kind === "effects") return definition.schema;
  if (kind !== "pipe") return undefined;
  return getZodKind(definition.in) === "transform" ? definition.out : definition.in;
}

export function unwrapZodTransforms(schema: unknown): unknown {
  let current = schema;
  for (let input = getZodTransformInput(current); input; input = getZodTransformInput(current)) {
    current = input;
  }
  return current;
}

/** Wrappers that only change whether a value may be missing or null, around the field's type. */
const OPTIONALITY_WRAPPERS = new Set([
  "optional",
  "nullable",
  "default",
  "prefault",
  "catch",
  "readonly",
]);

/**
 * The keys of an object schema whose field takes an array, behind optionality wrappers and
 * transforms. A query string names one value the same way whether the field takes a string or
 * a one-element array, so the API runtime reads these keys as arrays.
 */
export function getZodArrayFieldKeys(schema: unknown): string[] {
  const shape = getZodObjectShape(unwrapZodTransforms(schema));
  if (!shape) return [];
  const keys: string[] = [];
  for (const [key, field] of Object.entries(shape)) {
    let current = unwrapZodTransforms(field);
    for (
      let kind = getZodKind(current);
      kind && OPTIONALITY_WRAPPERS.has(kind);
      kind = getZodKind(current)
    ) {
      const inner = (current as any)._def?.innerType;
      if (!inner) break;
      current = unwrapZodTransforms(inner);
    }
    if (getZodKind(current) === "array") keys.push(key);
  }
  return keys;
}

/**
 * Form data names one value the same way for a string field and a one-element array. Give a field
 * the schema declares as an array its single value as an array, as a repeated field arrives, so
 * `tags: ["a"]` sent as form data validates like `tags: ["a", "b"]`.
 */
export function wrapZodArrayFieldValues<T extends Record<string, unknown>>(
  values: T,
  schema: unknown,
): T {
  for (const key of getZodArrayFieldKeys(schema)) {
    if (!Object.prototype.hasOwnProperty.call(values, key)) continue;
    const value = values[key];
    if (value !== undefined && !Array.isArray(value))
      (values as Record<string, unknown>)[key] = [value];
  }
  return values;
}
