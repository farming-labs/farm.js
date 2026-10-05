import { canonicalizeRequestPathname } from "../utils/decode";
import type { MiddlewareConfig, MiddlewareContext, MiddlewareMatcher } from "./types";

interface CompiledPathPattern {
  kind: "path";
  regex: RegExp;
  params: string[];
}

interface CompiledRegExpPattern {
  kind: "regexp";
  regex: RegExp;
}

interface CompiledSubtreePattern {
  kind: "subtree";
  prefix: string;
}

interface CompiledAllPattern {
  kind: "all";
}

type CompiledPattern =
  | CompiledPathPattern
  | CompiledRegExpPattern
  | CompiledSubtreePattern
  | CompiledAllPattern;

type CompiledMatcher = CompiledPattern | ((ctx: MiddlewareContext) => boolean);

export interface CompiledMiddlewareConfig {
  matcher?: CompiledMatcher[];
  exclude?: CompiledPattern[];
}

const compiledConfigCache = new WeakMap<MiddlewareConfig, CompiledMiddlewareConfig>();

function toMatcherList(matcher: MiddlewareConfig["matcher"]): MiddlewareMatcher[] {
  if (!matcher) return [];
  return Array.isArray(matcher) ? matcher : [matcher];
}

function escapeRegex(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

function parseColonParam(segment: string): { name: string; modifier?: string } {
  const raw = segment.slice(1);
  const last = raw[raw.length - 1];
  const modifier = last === "*" || last === "+" || last === "?" ? last : undefined;
  return {
    name: modifier ? raw.slice(0, -1) : raw,
    modifier,
  };
}

function compilePathPattern(pattern: string): CompiledPathPattern {
  const params: string[] = [];
  const segments = pattern.split("/").filter(Boolean);

  if (segments.length === 0) {
    return { kind: "path", regex: /^\/$/, params };
  }

  const parts = segments.map((segment) => {
    if (segment === "**") {
      return "(?:/.*)?";
    }

    if (segment === "*") {
      return "/[^/]+";
    }

    if (segment.startsWith(":")) {
      const { name, modifier } = parseColonParam(segment);
      params.push(name);

      if (modifier === "*") {
        return "(?:/(.*))?";
      }
      if (modifier === "+") {
        return "/(.+)";
      }
      return "/([^/]+)";
    }

    if (segment.startsWith("[...") && segment.endsWith("]")) {
      params.push(segment.slice(4, -1));
      return "(?:/(.*))?";
    }

    if (segment.startsWith("[") && segment.endsWith("]")) {
      params.push(segment.slice(1, -1));
      return "/([^/]+)";
    }

    return `/${escapeRegex(segment).replace(/\\\*/g, "[^/]*")}`;
  });

  return {
    kind: "path",
    regex: new RegExp(`^${parts.join("")}$`),
    params,
  };
}

function compilePattern(pattern: string | RegExp): CompiledPattern {
  if (pattern instanceof RegExp) {
    return { kind: "regexp", regex: pattern };
  }

  if (pattern === "*" || pattern === "/(.*)") {
    return { kind: "all" };
  }

  if (pattern.endsWith("(.*)")) {
    return {
      kind: "subtree",
      prefix: pattern.slice(0, -4).replace(/\/$/, ""),
    };
  }

  return compilePathPattern(pattern);
}

export function compileMiddlewareConfig(config: MiddlewareConfig): CompiledMiddlewareConfig {
  const compiled = {
    matcher: config.matcher
      ? toMatcherList(config.matcher).map((matcher) =>
          typeof matcher === "function" ? matcher : compilePattern(matcher),
        )
      : undefined,
    exclude: config.exclude?.map(compilePattern),
  };
  compiledConfigCache.set(config, compiled);
  return compiled;
}

function matchPattern(
  pattern: CompiledPattern,
  pathname: string,
): { matched: boolean; params?: Record<string, string> } {
  if (pattern.kind === "all") {
    return { matched: true };
  }

  if (pattern.kind === "subtree") {
    return {
      matched: pathname === pattern.prefix || pathname.startsWith(`${pattern.prefix}/`),
    };
  }

  pattern.regex.lastIndex = 0;
  const match = pattern.regex.exec(pathname);
  if (!match) {
    return { matched: false };
  }

  if (pattern.kind === "regexp") {
    return {
      matched: true,
      params: match.groups ? { ...match.groups } : undefined,
    };
  }

  const values: Record<string, string> = {};
  pattern.params.forEach((param, index) => {
    // The captured text came out of the canonical pathname, so it is already
    // decoded once. Decoding it again would turn a literal "%2541BC" segment
    // into "ABC".
    values[param] = match[index + 1] || "";
  });

  return {
    matched: true,
    params: Object.keys(values).length > 0 ? values : undefined,
  };
}

export function matchesCompiledMiddlewareConfig(
  pathname: string,
  config: CompiledMiddlewareConfig,
  ctx: MiddlewareContext,
): { matched: boolean; params?: Record<string, string> } {
  let canonicalPathname: string | undefined;
  // Canonicalize at most once for the whole config, and skip the work entirely
  // for configs containing only function matchers.
  const getCanonicalPathname = () => (canonicalPathname ??= canonicalizeRequestPathname(pathname));

  if (config.exclude) {
    for (const pattern of config.exclude) {
      if (matchPattern(pattern, getCanonicalPathname()).matched) {
        return { matched: false };
      }
    }
  }

  if (config.matcher) {
    for (const matcher of config.matcher) {
      if (typeof matcher === "function") {
        if (matcher(ctx)) {
          return { matched: true };
        }
        continue;
      }

      const result = matchPattern(matcher, getCanonicalPathname());
      if (result.matched) {
        return result;
      }
    }
    return { matched: false };
  }

  return { matched: true };
}

export function matchesMiddlewareConfig(
  pathname: string,
  config: MiddlewareConfig,
  ctx: MiddlewareContext,
): { matched: boolean; params?: Record<string, string> } {
  const compiled = compiledConfigCache.get(config) ?? compileMiddlewareConfig(config);
  return matchesCompiledMiddlewareConfig(pathname, compiled, ctx);
}
