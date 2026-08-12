import type { ParsedRoute } from "./types";

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
  return `${filePath}?farm-route=${kind}:${encodeURIComponent(normalizeProgrammaticRoutePath(routePath))}`;
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
  const filePath =
    normalized === "/" ? fileName : `${normalized.slice(1).replace(/\/+$/, "")}/${fileName}`;

  return {
    filePath,
    segments: normalized.split("/").filter(Boolean).map(parseRouteSegment),
    type,
  };
}

export function scanProgrammaticPagePaths(source: string): string[] {
  const paths = new Set<string>();
  const callRe = /\b(?:page|createRoute)\s*\(\s*(["'`])([^"'`]+)\1/g;

  for (const match of source.matchAll(callRe)) {
    if (match[2]) paths.add(normalizeProgrammaticRoutePath(match[2]));
  }

  return Array.from(paths);
}

export function normalizeProgrammaticRoutePath(routePath: string): string {
  const withSlash = routePath.startsWith("/") ? routePath : `/${routePath}`;
  const withoutTrailing = withSlash.length > 1 ? withSlash.replace(/\/+$/, "") : withSlash;
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
