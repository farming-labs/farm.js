import * as path from "path";
import * as fs from "fs";
import { parseRoutePath } from "../utils";
import { parseRouteSlotFile } from "./route-slots";
import type { ParsedRoute } from "../types";
import { discoverProgrammaticRoutePaths } from "../routes.server";
import type { FarmSourceRoot } from "../layers";
import { writeFileIfChanged } from "../write-file-if-changed";

function routeSegmentsToTsTypeLiteral(segments: string[]): string {
  if (segments.length === 0) return '"/"';
  const hasDynamic = segments.some((s) => s.startsWith("["));
  if (!hasDynamic) return JSON.stringify("/" + segments.join("/"));
  const parts = segments.map((s) => {
    if (s.startsWith("[[...") || s.startsWith("[...")) return "${string}";
    if (s.startsWith("[")) return "${string}";
    return s;
  });
  return "`/" + parts.join("/") + "`";
}

function routePatternToTsTypeLiterals(pattern: string): string[] {
  if (pattern === "/") return ['"/"'];

  let variants: string[][] = [[]];
  for (const segment of pattern.slice(1).split("/").filter(Boolean)) {
    if (segment.startsWith("[[...") && segment.endsWith("]]")) {
      variants = variants.flatMap((parts) => [parts, [...parts, segment]]);
    } else {
      variants = variants.map((parts) => [...parts, segment]);
    }
  }

  return variants.map(routeSegmentsToTsTypeLiteral);
}

function routePatternToRouteLiteral(pattern: string): string {
  return JSON.stringify(pattern);
}

function createRoutePattern(route: ParsedRoute): string {
  if (route.segments.length === 0) return "/";
  return (
    "/" +
    route.segments
      .map((seg) => {
        if (!seg.isDynamic) return seg.segment;
        if (seg.isCatchAll) return seg.isOptional ? `[[...${seg.segment}]]` : `[...${seg.segment}]`;
        return `[${seg.segment}]`;
      })
      .join("/")
  );
}

export interface GenerateRouteTypesOptions {
  root: string;
  srcDir?: string;
  outFile?: string;
  extraRoutes?: string[];
  /** Ordered layer roots followed by the project root. */
  sourceRoots?: readonly FarmSourceRoot[];
  /** When true, do not augment LinkDefaultRoute so Link href accepts any string (no route-type errors). */
  suppressLintOnLink?: boolean;
}

const DEFAULT_OUT_FILE = "farm-routes.d.ts";

/**
 * Scan app directory for page files, generate RoutePath union type,
 * and write a .d.ts file for typed Link href.
 */
export async function generateRouteTypes(options: GenerateRouteTypesOptions): Promise<string> {
  const root = path.resolve(options.root);
  const srcDir = options.srcDir || "src";
  const outFile = options.outFile || DEFAULT_OUT_FILE;
  const outPath = path.isAbsolute(outFile) ? outFile : path.join(root, srcDir, outFile);
  const content = await createRouteTypeDeclarations(options, outPath);

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileIfChanged(outPath, content);

  return outPath;
}

export async function createRouteTypeDeclarations(
  options: GenerateRouteTypesOptions,
  outPath: string,
): Promise<string> {
  const { root, srcDir = "src", extraRoutes = [], suppressLintOnLink = false } = options;
  const sourceRoots = options.sourceRoots ?? [{ name: "project", root, srcDir, layer: false }];

  const patterns = new Set<string>();

  const glob = await import("fast-glob");
  for (const source of sourceRoots) {
    const appDir = path.join(source.root, source.srcDir, "app");
    if (fs.existsSync(appDir)) {
      const pageFiles = await glob.default("**/page.{ts,tsx,js,jsx,md,mdx}", {
        cwd: appDir,
        absolute: false,
      });

      for (const file of pageFiles) {
        if (parseRouteSlotFile(file)) continue;
        const route = parseRoutePath(file);
        if (route.type === "page") {
          const pattern = createRoutePattern(route);
          patterns.add(pattern);
        }
      }
    }

    for (const route of await discoverProgrammaticRoutePaths(source.root, source.srcDir)) {
      patterns.add(route);
    }
  }

  for (const route of extraRoutes) {
    if (route.startsWith("/")) {
      patterns.add(route);
    }
  }

  const sortedPatterns = Array.from(patterns).sort();
  const typeLiterals = Array.from(new Set(sortedPatterns.flatMap(routePatternToTsTypeLiterals)));
  const patternLiterals = sortedPatterns.map(routePatternToRouteLiteral);

  const routePathType = suppressLintOnLink
    ? "string"
    : typeLiterals.length
      ? typeLiterals.join(" | ")
      : "never";
  const routePatternType = suppressLintOnLink
    ? "string"
    : patternLiterals.length
      ? patternLiterals.join(" | ")
      : "never";
  const routeTypesImportPath = `./${path.basename(outPath).replace(/\.d\.ts$/, "")}`;
  const augmentationBlock = suppressLintOnLink
    ? ""
    : `
declare module "@farm.js/core/client" {
  interface LinkDefaultRoute {
    _: import(${JSON.stringify(routeTypesImportPath)}).RoutePath;
    pattern: import(${JSON.stringify(routeTypesImportPath)}).RoutePattern;
  }
}

declare module "@farm.js/core" {
  interface LinkDefaultRoute {
    _: import(${JSON.stringify(routeTypesImportPath)}).RoutePath;
    pattern: import(${JSON.stringify(routeTypesImportPath)}).RoutePattern;
  }
  // Ensure root import ("@farm.js/core") uses the same typed Link signature as client entry.
  const Link: typeof import("@farm.js/core/client").Link;
}

// Internal declaration path used by @farm.js/core root type re-exports.
declare module "@farm.js/core/dist/client.js" {
  interface LinkDefaultRoute {
    _: import(${JSON.stringify(routeTypesImportPath)}).RoutePath;
    pattern: import(${JSON.stringify(routeTypesImportPath)}).RoutePattern;
  }
}
`;

  const content = `/**
 * Auto-generated route types from src/app.
 * Link href is typed automatically via module augmentation. Regenerated on dev start and when routes change.
 * Set suppressLintOnLink: true in farm.config.ts to accept any string on Link href.
 */
export type RoutePath = ${routePathType};
export type RoutePattern = ${routePatternType};${augmentationBlock}
`;

  return content;
}
