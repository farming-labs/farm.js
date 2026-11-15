// Previous file matcher from 1307b964; only imports/export visibility differ.
import { canonicalizeRequestPathname } from "../../utils/decode";
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

function compilePathPattern(pattern: string): { regex: RegExp; params: string[] } {
  const params: string[] = [];
  const segments = pattern.split("/").filter(Boolean);

  if (segments.length === 0) {
    return { regex: /^\/$/, params };
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
    regex: new RegExp(`^${parts.join("")}$`),
    params,
  };
}

function matchPattern(
  pattern: string | RegExp,
  pathname: string,
): { matched: boolean; params?: Record<string, string> } {
  // A middleware matcher is a guard, so it has to be compared against the same
  // pathname the route matchers resolve the request to. They decode each
  // segment once; comparing the raw pathname here let `/%64ashboard` miss a
  // `/dashboard` matcher while still rendering the protected page.
  const canonicalPathname = canonicalizeRequestPathname(pathname);

  if (pattern instanceof RegExp) {
    pattern.lastIndex = 0;
    const match = pattern.exec(canonicalPathname);
    return {
      matched: !!match,
      params: match?.groups ? { ...match.groups } : undefined,
    };
  }

  if (pattern === "*" || pattern === "/(.*)") {
    return { matched: true };
  }

  if (pattern.endsWith("(.*)")) {
    // Strip a trailing slash before the wildcard so `/admin/(.*)` matches the
    // `/admin` subtree like `/admin/**` does. Without this the prefix keeps its
    // slash and the check becomes startsWith("/admin//"), which no path
    // satisfies, so the matcher silently matches nothing — an auth gate written
    // that way would never run.
    const prefix = pattern.slice(0, -4).replace(/\/$/, "");
    return { matched: canonicalPathname === prefix || canonicalPathname.startsWith(`${prefix}/`) };
  }

  const { regex, params } = compilePathPattern(pattern);
  const match = regex.exec(canonicalPathname);
  if (!match) {
    return { matched: false };
  }

  const values: Record<string, string> = {};
  params.forEach((param, index) => {
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

export function matchRoutePath(
  pathname: string,
  middlewarePath: string,
): { matched: boolean; params?: Record<string, string> } {
  if (middlewarePath === "/") return { matched: true };

  const exactMatch = matchPattern(middlewarePath, pathname);
  if (exactMatch.matched) {
    return exactMatch;
  }

  const nestedMatch = matchPattern(`${middlewarePath}/:__farmRest*`, pathname);
  if (!nestedMatch.matched) {
    return { matched: false };
  }

  const params = { ...nestedMatch.params };
  delete params.__farmRest;
  return {
    matched: true,
    params: Object.keys(params).length > 0 ? params : undefined,
  };
}
