import type { Parser } from "./parsers";

export const PARSE_REPEATED_VALUES = Symbol("farm.query.parseRepeatedValues");

export type RepeatedValueParser<T> = Parser<T> & {
  [PARSE_REPEATED_VALUES]?: (values: readonly string[]) => T | null;
};

export function parseQueryParameter<T>(parser: Parser<T>, values: readonly string[]): T | null {
  const parseRepeated = (parser as RepeatedValueParser<T>)[PARSE_REPEATED_VALUES];
  if (values.length > 1 && parseRepeated) return parseRepeated(values);
  return parser.parse(values.length > 1 ? values.join(",") : (values[0] ?? ""));
}
