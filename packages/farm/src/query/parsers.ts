/**
 * Farm.js Query State Parsers
 *
 * Shared parsers that can be used in both client and server contexts
 */

export interface Parser<T> {
  parse: (value: string) => T | null;
  serialize: (value: T) => string;
  withDefault?: (defaultValue: T) => Parser<T>;
}

// String parser
export const asString: Parser<string> = {
  parse: (value: string) => (value && value.trim()) || null,
  serialize: (value: string) => value,
  withDefault: (defaultValue: string) => ({
    parse: (value: string) => (value && value.trim()) || defaultValue,
    serialize: (value: string) => value || defaultValue,
  }),
};

// Integer parser
export const asInteger: Parser<number> = {
  parse: (value: string) => {
    const parsed = Number.parseInt(value, 10);
    return isNaN(parsed) ? null : parsed;
  },
  serialize: (value: number) => value.toString(),
  withDefault: (defaultValue: number) => ({
    parse: (value: string) => {
      const parsed = Number.parseInt(value, 10);
      return isNaN(parsed) ? defaultValue : parsed;
    },
    serialize: (value: number) => value.toString(),
  }),
};

// Float parser
export const asFloat: Parser<number> = {
  parse: (value: string) => {
    const parsed = Number.parseFloat(value);
    return isNaN(parsed) ? null : parsed;
  },
  serialize: (value: number) => value.toString(),
  withDefault: (defaultValue: number) => ({
    parse: (value: string) => {
      const parsed = Number.parseFloat(value);
      return isNaN(parsed) ? defaultValue : parsed;
    },
    serialize: (value: number) => value.toString(),
  }),
};

// Boolean parser
export const asBoolean: Parser<boolean> = {
  parse: (value: string) => {
    if (value === "true") return true;
    if (value === "false") return false;
    return null;
  },
  serialize: (value: boolean) => value.toString(),
  withDefault: (defaultValue: boolean) => ({
    parse: (value: string) => {
      if (value === "true") return true;
      if (value === "false") return false;
      return defaultValue;
    },
    serialize: (value: boolean) => value.toString(),
  }),
};

// Array parser
export function asArrayOf<T>(itemParser: Parser<T>): Parser<T[]> {
  return {
    parse: (value: string) => {
      if (!value) return null;
      return value
        .split(",")
        .filter(Boolean)
        .map((item) => itemParser.parse(item.trim()))
        .filter((item) => item !== null) as T[];
    },
    serialize: (value: T[]) => value.map((item) => itemParser.serialize(item)).join(","),
    withDefault: (defaultValue: T[]) => ({
      parse: (value: string) => {
        if (!value) return defaultValue;
        return value
          .split(",")
          .filter(Boolean)
          .map((item) => itemParser.parse(item.trim()))
          .filter((item) => item !== null) as T[];
      },
      serialize: (value: T[]) => value.map((item) => itemParser.serialize(item)).join(","),
    }),
  };
}

// JSON parser
export function asJson<T>(): Parser<T> {
  return {
    parse: (value: string) => {
      try {
        return JSON.parse(value);
      } catch {
        return null;
      }
    },
    serialize: (value: T) => JSON.stringify(value),
    withDefault: (defaultValue: T) => ({
      parse: (value: string) => {
        try {
          return JSON.parse(value);
        } catch {
          return defaultValue;
        }
      },
      serialize: (value: T) => JSON.stringify(value),
    }),
  };
}

// ISO Date parser
export const asIsoDate: Parser<Date> = {
  parse: (value: string) => {
    const date = new Date(value);
    return isNaN(date.getTime()) ? null : date;
  },
  serialize: (value: Date) => value.toISOString(),
  withDefault: (defaultValue: Date) => ({
    parse: (value: string) => {
      const date = new Date(value);
      return isNaN(date.getTime()) ? defaultValue : date;
    },
    serialize: (value: Date) => value.toISOString(),
  }),
};

// ISO DateTime parser
export const asIsoDateTime: Parser<Date> = {
  parse: (value: string) => {
    const date = new Date(value);
    return isNaN(date.getTime()) ? null : date;
  },
  serialize: (value: Date) => value.toISOString(),
  withDefault: (defaultValue: Date) => ({
    parse: (value: string) => {
      const date = new Date(value);
      return isNaN(date.getTime()) ? defaultValue : date;
    },
    serialize: (value: Date) => value.toISOString(),
  }),
};

// Custom parser creator
export function createParser<T>(config: {
  parse: (value: string) => T | null;
  serialize: (value: T) => string;
}): Parser<T> {
  return {
    parse: config.parse,
    serialize: config.serialize,
    withDefault: (defaultValue: T) => ({
      parse: (value: string) => config.parse(value) ?? defaultValue,
      serialize: config.serialize,
    }),
  };
}

// Type inference helper
export type inferParserType<T> = T extends Parser<infer U> ? U : never;
