import type { Parser } from "./parsers";
import { parseQueryParameter } from "./values";

export type RouteParamsInput =
  | Record<string, string | undefined>
  | URLSearchParams
  | Promise<Record<string, string | undefined> | URLSearchParams>;

function parseParam<T>(
  input: Record<string, string | undefined> | URLSearchParams,
  key: string,
  parser: Parser<T>,
) {
  const values = input instanceof URLSearchParams ? input.getAll(key) : [input[key] ?? ""];
  return {
    raw: values.length > 1 ? values.join(",") : (values[0] ?? ""),
    parsed: parseQueryParameter(parser, values),
  };
}

export async function loadRouteParams<T extends Record<string, Parser<any>>>(
  input: RouteParamsInput,
  parsers: T,
  options: { strict?: boolean } = {},
): Promise<{ [K in keyof T]: ReturnType<T[K]["parse"]> }> {
  const resolved = await Promise.resolve(input);
  const result = {} as { [K in keyof T]: ReturnType<T[K]["parse"]> };

  for (const [key, parser] of Object.entries(parsers)) {
    const { raw, parsed } = parseParam(resolved, key, parser);
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
  const result = {} as { [K in keyof T]: ReturnType<T[K]["parse"]> };

  for (const [key, parser] of Object.entries(parsers)) {
    const { raw, parsed } = parseParam(input, key, parser);
    if (parsed === null && options.strict) {
      throw new Error(`Failed to parse route param "${key}" with value "${raw}"`);
    }
    result[key as keyof T] = parsed as ReturnType<T[typeof key]["parse"]>;
  }

  return result;
}
