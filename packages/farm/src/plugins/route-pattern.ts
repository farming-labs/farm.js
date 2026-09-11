import { localizeFarmHref, resolveFarmLocalePath } from "../i18n/routing";
import type { ResolvedFarmI18nConfig } from "../i18n/types";
import { assertBrowserStableRoutePath } from "../routing/specificity";

type ConfigRoutePatternToken =
  | { kind: "param"; name: string; captureIndex: number; catchAll: boolean }
  | { kind: "wildcard"; captureIndex: number };

export interface CompiledConfigRoutePattern {
  regex: RegExp;
  tokens: ConfigRoutePatternToken[];
}

export function validateConfigRouteSource(source: string, field = "Config route source"): string {
  if (typeof source !== "string" || source.length === 0) {
    throw new TypeError(`${field} must be a non-empty pathname pattern.`);
  }
  if (source.trim() !== source) {
    throw new Error(`${field} cannot contain leading or trailing whitespace.`);
  }
  if (!source.startsWith("/")) {
    throw new Error(`${field} must start with "/".`);
  }
  if (source.includes("?") || source.includes("#")) {
    throw new Error(`${field} must be a pathname without a query string or hash.`);
  }
  if (
    source.includes("\\") ||
    Array.from(source).some((character) => {
      const code = character.charCodeAt(0);
      return code <= 31 || (code >= 127 && code <= 159);
    })
  ) {
    throw new Error(`${field} cannot contain backslashes or control characters.`);
  }
  assertBrowserStableRoutePath(source);
  return source;
}

export function resolveConfigRoutePathname(
  pathname: string,
  i18n?: ResolvedFarmI18nConfig,
): { pathname: string; locale?: string } {
  if (!i18n?.enabled) return { pathname };
  const match = resolveFarmLocalePath(pathname, i18n);
  return { pathname: match.pathname, locale: match.locale };
}

export function localizeConfigRouteDestination(
  destination: string,
  locale: string | undefined,
  i18n?: ResolvedFarmI18nConfig,
): string {
  return locale && i18n?.enabled ? localizeFarmHref(destination, locale, i18n) : destination;
}

function escapeRegexCharacter(character: string): string {
  return /[\\^$.*+?()[\]{}|]/.test(character) ? `\\${character}` : character;
}

export function compileConfigRoutePattern(source: string): CompiledConfigRoutePattern {
  validateConfigRouteSource(source);
  const tokens: ConfigRoutePatternToken[] = [];
  let pattern = "";
  let captureIndex = 1;

  for (let index = 0; index < source.length; ) {
    const rest = source.slice(index);
    const parameter = rest.match(/^:([A-Za-z0-9_]+)(\*)?/);
    if (parameter) {
      tokens.push({
        kind: "param",
        name: parameter[1],
        captureIndex,
        catchAll: parameter[2] === "*",
      });
      pattern += parameter[2] ? "(.*)" : "([^/]+)";
      captureIndex += 1;
      index += parameter[0].length;
      continue;
    }

    if (source[index] === "*") {
      tokens.push({ kind: "wildcard", captureIndex });
      pattern += "(.*)";
      captureIndex += 1;
      index += 1;
      continue;
    }

    pattern += escapeRegexCharacter(source[index]);
    index += 1;
  }

  return { regex: new RegExp(`^${pattern}$`), tokens };
}

export function interpolateConfigRouteDestination(
  destination: string,
  match: RegExpMatchArray,
  tokens: readonly ConfigRoutePatternToken[],
): string {
  const namedCaptures = new Map<string, string>();
  const wildcardCaptures: string[] = [];
  const captures = new Map<number, string>();

  for (const token of tokens) {
    const value = normalizeConfigRouteCapture(
      match[token.captureIndex] || "",
      token.kind === "wildcard" || token.catchAll,
    );
    captures.set(token.captureIndex, value);
    if (token.kind === "param") {
      namedCaptures.set(token.name, value);
    } else {
      wildcardCaptures.push(value);
    }
  }

  let result = "";
  let wildcardIndex = 0;
  for (let index = 0; index < destination.length; ) {
    const rest = destination.slice(index);
    const parameter = rest.match(/^:([A-Za-z0-9_]+)(\*)?/);
    if (parameter) {
      const value = namedCaptures.get(parameter[1]);
      result += value === undefined ? parameter[0] : value;
      index += parameter[0].length;
      continue;
    }

    const capture = rest.match(/^\$(\d+)/);
    if (capture) {
      result += captures.get(Number(capture[1])) ?? "";
      index += capture[0].length;
      continue;
    }

    if (destination[index] === "*") {
      result += wildcardCaptures[wildcardIndex] || "";
      wildcardIndex += 1;
      index += 1;
      continue;
    }

    result += destination[index];
    index += 1;
  }

  return result;
}

function normalizeConfigRouteCapture(value: string, catchAll: boolean): string {
  const segments = catchAll ? value.split("/").filter(Boolean) : [value];
  return segments
    .map((segment) => encodeConfigRouteSegment(decodeConfigRouteSegment(segment)))
    .join("/");
}

function decodeConfigRouteSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function encodeConfigRouteSegment(segment: string): string {
  return encodeURIComponent(segment).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}
