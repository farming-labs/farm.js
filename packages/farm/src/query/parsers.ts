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

const INTEGER_PATTERN = /^[+-]?\d+$/;
const FLOAT_PATTERN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_DATE_TIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

function parseInteger(value: string): number | null {
  if (!INTEGER_PATTERN.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function parseFloatValue(value: string): number | null {
  if (!FLOAT_PATTERN.test(value)) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= daysInMonth[month - 1];
}

function parseIsoDate(value: string): Date | null {
  const match = value.match(ISO_DATE_PATTERN);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!isValidCalendarDate(year, month, day)) return null;

  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return date;
}

function parseIsoDateTime(value: string): Date | null {
  const match = value.match(ISO_DATE_TIME_PATTERN);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const timezone = match[7];
  if (!isValidCalendarDate(year, month, day) || hour > 23 || minute > 59 || second > 59) {
    return null;
  }

  if (timezone !== "Z") {
    const [offsetHour, offsetMinute] = timezone.slice(1).split(":").map(Number);
    if (offsetHour > 23 || offsetMinute > 59) return null;
  }

  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
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
  parse: parseInteger,
  serialize: (value: number) => value.toString(),
  withDefault: (defaultValue: number) => ({
    parse: (value: string) => parseInteger(value) ?? defaultValue,
    serialize: (value: number) => value.toString(),
  }),
};

// Float parser
export const asFloat: Parser<number> = {
  parse: parseFloatValue,
  serialize: (value: number) => value.toString(),
  withDefault: (defaultValue: number) => ({
    parse: (value: string) => parseFloatValue(value) ?? defaultValue,
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
  parse: parseIsoDate,
  serialize: (value: Date) => value.toISOString().slice(0, 10),
  withDefault: (defaultValue: Date) => ({
    parse: (value: string) => parseIsoDate(value) ?? defaultValue,
    serialize: (value: Date) => value.toISOString().slice(0, 10),
  }),
};

// ISO DateTime parser
export const asIsoDateTime: Parser<Date> = {
  parse: parseIsoDateTime,
  serialize: (value: Date) => value.toISOString(),
  withDefault: (defaultValue: Date) => ({
    parse: (value: string) => parseIsoDateTime(value) ?? defaultValue,
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
