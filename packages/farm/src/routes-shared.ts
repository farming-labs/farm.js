import type { ParsedRoute } from "./types";
import {
  assertBrowserStableRoutePath,
  assertTerminalCatchAll,
  assertUniqueRouteParameters,
} from "./routing/specificity";
import { extractProgrammaticPageCallPathLiterals } from "./route-call-scanner";

export const PROGRAMMATIC_ROUTE_FILE_NAMES = [
  "farm.route.ts",
  "farm.route.tsx",
  "farm.route.js",
  "farm.route.jsx",
  "farm.routes.ts",
  "farm.routes.tsx",
  "farm.routes.js",
  "farm.routes.jsx",
  "routes.ts",
  "routes.tsx",
  "routes.js",
  "routes.jsx",
] as const;

export interface ProgrammaticRouteSearchClientOptions {
  stripDefaults?: boolean | readonly string[];
  preserve?: readonly string[];
  temporary?: readonly string[];
}

type ProgrammaticRouteSearchLike =
  | { parse(value: unknown): unknown }
  | ({
      schema?: { parse(value: unknown): unknown };
    } & ProgrammaticRouteSearchClientOptions);

export function getProgrammaticRouteSearchClientOptions(
  search: ProgrammaticRouteSearchLike | undefined,
): ProgrammaticRouteSearchClientOptions | undefined {
  if (!search || "parse" in search) return undefined;

  const options: ProgrammaticRouteSearchClientOptions = {};
  if (typeof search.stripDefaults !== "undefined") options.stripDefaults = search.stripDefaults;
  if (search.preserve?.length) options.preserve = [...search.preserve];
  if (search.temporary?.length) options.temporary = [...search.temporary];

  return Object.keys(options).length > 0 ? options : undefined;
}

export function isProgrammaticRoutesFileName(fileName: string): boolean {
  const normalized = fileName.replace(/\\/g, "/");
  const baseName = normalized.split("/").pop() || normalized;
  return PROGRAMMATIC_ROUTE_FILE_NAMES.includes(
    baseName as (typeof PROGRAMMATIC_ROUTE_FILE_NAMES)[number],
  );
}

export function createProgrammaticRouteModuleId(
  filePath: string,
  kind: "page" | "layout" | "api",
  routePath: string,
): string {
  // The id ends in the route path, so a path like /feed.xml would make the
  // production transform read the module as XML. The generated module is
  // plain JavaScript; a trailing `lang.js` marker says so whatever the path.
  return `${filePath}?farm-route=${kind}:${encodeURIComponent(normalizeProgrammaticRoutePath(routePath))}&lang.js`;
}

export function parseProgrammaticRouteModuleId(moduleId: string): {
  filePath: string;
  kind: "page" | "layout" | "api";
  routePath: string;
} | null {
  const queryIndex = moduleId.indexOf("?");
  if (queryIndex === -1) return null;

  const filePath = moduleId.slice(0, queryIndex);
  const params = new URLSearchParams(moduleId.slice(queryIndex + 1));
  const value = params.get("farm-route");
  if (!value) return null;

  const separator = value.indexOf(":");
  if (separator === -1) return null;

  const kind = value.slice(0, separator);
  if (kind !== "page" && kind !== "layout" && kind !== "api") return null;

  return {
    filePath,
    kind,
    routePath: normalizeProgrammaticRoutePath(value.slice(separator + 1)),
  };
}

export function parseProgrammaticRoutePath(
  routePath: string,
  type: ParsedRoute["type"] = "page",
): ParsedRoute {
  const fileName = type === "layout" ? "layout.tsx" : "page.tsx";
  const normalized = normalizeProgrammaticRoutePath(routePath);
  assertTerminalCatchAll(normalized);
  assertUniqueRouteParameters(normalized);
  const filePath =
    normalized === "/" ? fileName : `${normalized.slice(1).replace(/\/+$/, "")}/${fileName}`;

  return {
    filePath,
    segments: normalized
      .split("/")
      .filter(Boolean)
      .filter((segment) => !(segment.startsWith("(") && segment.endsWith(")")))
      .map(parseRouteSegment),
    type,
  };
}

export function scanProgrammaticPagePaths(source: string): string[] {
  const paths = new Set<string>();

  for (const routePath of extractProgrammaticPageCallPathLiterals(source)) {
    paths.add(normalizeProgrammaticRoutePath(routePath));
  }

  return Array.from(paths);
}

export function normalizeProgrammaticRoutePath(routePath: string): string {
  if (routePath.includes("?") || routePath.includes("#")) {
    throw new TypeError(
      `Programmatic route path "${routePath}" must be a pathname without a query string or hash.`,
    );
  }
  const withSlash = routePath.startsWith("/") ? routePath : `/${routePath}`;
  const withoutTrailing = withSlash.length > 1 ? withSlash.replace(/\/+$/, "") : withSlash;
  assertBrowserStableRoutePath(withoutTrailing);
  return withoutTrailing || "/";
}

function parseRouteSegment(segment: string): ParsedRoute["segments"][number] {
  if (segment.startsWith("[") && segment.endsWith("]")) {
    let name = segment.slice(1, -1);
    let isOptional = false;
    let isCatchAll = false;

    if (name.startsWith("[") && name.endsWith("]")) {
      isOptional = true;
      name = name.slice(1, -1);
    }

    if (name.startsWith("...")) {
      isCatchAll = true;
      name = name.slice(3);
    }

    return { segment: name, isDynamic: true, isOptional, isCatchAll };
  }

  return { segment, isDynamic: false, isOptional: false, isCatchAll: false };
}

/**
 * Where a programmatic route definition was made, recorded while Farm evaluates routes files
 * on the server so the client build can keep every module that defines routes out of the
 * browser. `stacks` holds the call stack of each step that made or copied the definition
 * (page(), defineRoutes()); `raw` is set when the chain starts from an object literal rather
 * than a route factory, which no stack can locate.
 */
export interface ProgrammaticRouteDefinitionSource {
  stacks: readonly string[];
  raw: boolean;
}

/** An enumerable symbol, so `{ ...route }` copies keep where the route came from. */
export const PROGRAMMATIC_ROUTE_SOURCE = Symbol.for("farm.routes.source");
export const TRACK_PROGRAMMATIC_ROUTE_SOURCES = Symbol.for("farm.routes.trackSources");

/** Record where route definitions are made. Only Farm's server-side route discovery turns it on. */
export function trackProgrammaticRouteSources(): void {
  (globalThis as Record<symbol, unknown>)[TRACK_PROGRAMMATIC_ROUTE_SOURCES] = true;
}

export function getProgrammaticRouteDefinitionSource(
  route: unknown,
): ProgrammaticRouteDefinitionSource | undefined {
  if (!route || typeof route !== "object") return undefined;
  const source = (route as Record<symbol, unknown>)[PROGRAMMATIC_ROUTE_SOURCE];
  return source && typeof source === "object" && Array.isArray((source as any).stacks)
    ? (source as ProgrammaticRouteDefinitionSource)
    : undefined;
}
