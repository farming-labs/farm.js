import type { Parser } from "./parsers";

export type RouteParamsInput =
  | Record<string, string | undefined>
  | URLSearchParams
  | Promise<Record<string, string | undefined> | URLSearchParams>;

function normalizeParams(input: Record<string, string | undefined> | URLSearchParams) {
  if (input instanceof URLSearchParams) {
    const params: Record<string, string | undefined> = {};
    input.forEach((value, key) => {
      params[key] = value;
    });
    return params;
  }
  return input;
}

export async function loadRouteParams<T extends Record<string, Parser<any>>>(
  input: RouteParamsInput,
  parsers: T,
  options: { strict?: boolean } = {},
): Promise<{ [K in keyof T]: ReturnType<T[K]["parse"]> }> {
  const resolved = await Promise.resolve(input);
  const params = normalizeParams(resolved);
  const result = {} as { [K in keyof T]: ReturnType<T[K]["parse"]> };

  for (const [key, parser] of Object.entries(parsers)) {
    const raw = params[key] ?? "";
    const parsed = parser.parse(raw);
    if (parsed === null && options.strict) {
      throw new Error(`Failed to parse route param "${key}" with value "${raw}"`);
    }
    result[key as keyof T] = parsed as ReturnType<T[typeof key]["parse"]>;
  }

  return result;
}

export function parseRouteParams<T extends Record<string, Parser<any>>>(
  input: Record<string, string | undefined> | URLSearchParams,
  parsers: T,
  options: { strict?: boolean } = {},
): { [K in keyof T]: ReturnType<T[K]["parse"]> } {
  const params = normalizeParams(input);
  const result = {} as { [K in keyof T]: ReturnType<T[K]["parse"]> };

  for (const [key, parser] of Object.entries(parsers)) {
    const raw = params[key] ?? "";
    const parsed = parser.parse(raw);
    if (parsed === null && options.strict) {
      throw new Error(`Failed to parse route param "${key}" with value "${raw}"`);
    }
    result[key as keyof T] = parsed as ReturnType<T[typeof key]["parse"]>;
  }

  return result;
}
