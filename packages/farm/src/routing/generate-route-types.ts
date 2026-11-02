import * as path from "path";
import * as fs from "fs";
import { parseRoutePath } from "../utils";
import { parseRouteSlotFile } from "./route-slots";
import type { ParsedRoute } from "../types";
import { discoverProgrammaticRoutePaths } from "../routes.server";
import type { FarmSourceRoot } from "../layers";
import { writeFileIfChanged } from "../write-file-if-changed";
import { resolveFarmComponentExtensions } from "../renderer";

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

function renderTypeUnion(values: readonly string[]): string {
  return values.length <= 1 ? values[0] || "never" : `\n  | ${values.join("\n  | ")}`;
}

function renderTypeAlias(name: string, value: string): string {
  return `export type ${name} =${value.startsWith("\n") ? "" : " "}${value};`;
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
  /** Additional renderer-owned component extensions, such as `.vue` or `.svelte`. */
  componentExtensions?: readonly string[];
}

const DEFAULT_OUT_FILE = "farm-routes.d.ts";

/**
 * Scan application route modules, generate page and module route unions,
 * and write a .d.ts file for typed Link hrefs and route component props.
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
  const { extraRoutes = [], suppressLintOnLink = false } = options;
  const { pages: patterns, modules: routeModulePatterns } = await scanRoutePatterns(options);

  for (const route of extraRoutes) {
    if (route.startsWith("/")) {
      patterns.add(route);
      routeModulePatterns.add(route);
    }
  }

  const sortedPatterns = Array.from(patterns).sort();
  const typeLiterals = Array.from(new Set(sortedPatterns.flatMap(routePatternToTsTypeLiterals)));
  const patternLiterals = sortedPatterns.map(routePatternToRouteLiteral);
  const routeModulePatternLiterals = Array.from(routeModulePatterns)
    .sort()
    .map(routePatternToRouteLiteral);

  const routePathType = suppressLintOnLink ? "string" : renderTypeUnion(typeLiterals);
  const routePatternType = suppressLintOnLink ? "string" : renderTypeUnion(patternLiterals);
  const routeModulePatternType = renderTypeUnion(routeModulePatternLiterals);
  const routeTypesImportPath = `./${path.basename(outPath).replace(/\.d\.ts$/, "")}`;
  const linkAugmentationBlock = suppressLintOnLink
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

  const routeModuleAugmentationBlock = `
declare global {
  namespace FarmJS {
    interface RouteRegistry {
      pattern: import(${JSON.stringify(routeTypesImportPath)}).RouteModulePattern;
    }
  }
}
`;

  const content = `/**
 * Auto-generated route types from src/app.
 * Link href and route component props are typed automatically from generated declarations.
 * Regenerated on dev start and when routes change.
 * Set suppressLintOnLink: true in farm.config.ts to accept any string on Link href.
 */
${renderTypeAlias("RoutePath", routePathType)}
${renderTypeAlias("RoutePattern", routePatternType)}
${renderTypeAlias("RouteModulePattern", routeModulePatternType)}${linkAugmentationBlock}${routeModuleAugmentationBlock}
`;

  return content;
}

/**
 * Mobile screen files next to a route's `page.tsx`: React Native (`page.native.tsx`,
 * `page.ios.tsx`, `page.android.tsx`) and platform (`page.kt`, `page.swift`). Layouts use the
 * first three.
 */
export interface PlatformRouteFiles {
  native?: string;
  ios?: string;
  android?: string;
  kt?: string;
  swift?: string;
}

export interface ScannedRoutePatterns {
  pages: Set<string>;
  modules: Set<string>;
}

export interface ScannedPlatformRoutePatterns extends ScannedRoutePatterns {
  /** Absolute page file per file-based page pattern; a project file wins over a layer's. */
  pageFiles: Map<string, string>;
  /** Mobile screen files per page pattern, absolute paths. */
  nativePages: Map<string, PlatformRouteFiles>;
  /** Reserved `layout.native.tsx` files per app directory, such as `/(tabs)`, absolute paths. */
  nativeLayouts: Map<string, PlatformRouteFiles>;
}

const PLATFORM_FILE =
  /^(?:(page|layout)\.(native|ios|android)\.(?:tsx|ts|jsx|js)|page\.(kt|swift))$/;

/**
 * Page and route module URL patterns from the app directory and programmatic routes files, as
 * the generated route types list them: `/notes/[id]`, route groups removed, slots skipped.
 * With `platformFiles` (mobile commands only) it also lists page files and the
 * `page.{native,ios,android}.tsx` screens next to them; web scans never look for them.
 */
export async function scanRoutePatterns(
  options: Pick<
    GenerateRouteTypesOptions,
    "root" | "srcDir" | "sourceRoots" | "componentExtensions"
  > & { platformFiles: true },
): Promise<ScannedPlatformRoutePatterns>;
export async function scanRoutePatterns(
  options: Pick<
    GenerateRouteTypesOptions,
    "root" | "srcDir" | "sourceRoots" | "componentExtensions"
  > & { platformFiles?: false },
): Promise<ScannedRoutePatterns>;
export async function scanRoutePatterns(
  options: Pick<
    GenerateRouteTypesOptions,
    "root" | "srcDir" | "sourceRoots" | "componentExtensions"
  > & { platformFiles?: boolean },
): Promise<ScannedRoutePatterns | ScannedPlatformRoutePatterns> {
  const { root, srcDir = "src" } = options;
  const sourceRoots = options.sourceRoots ?? [{ name: "project", root, srcDir, layer: false }];
  const componentExtensions = resolveFarmComponentExtensions(options.componentExtensions).map(
    (extension) => extension.slice(1),
  );

  const pages = new Set<string>();
  const modules = new Set<string>();
  const pageFiles = new Map<string, string>();
  const nativePages = new Map<string, PlatformRouteFiles>();
  const nativeLayouts = new Map<string, PlatformRouteFiles>();

  const glob = await import("fast-glob");
  for (const source of sourceRoots) {
    const appDir = path.join(source.root, source.srcDir, "app");
    if (fs.existsSync(appDir)) {
      const routeModuleFiles = await glob.default(
        `**/{page,layout,loading,error}.{${componentExtensions.join(",")},md,mdx}`,
        {
          cwd: appDir,
          absolute: false,
        },
      );

      for (const file of routeModuleFiles) {
        if (parseRouteSlotFile(file)) continue;
        const route = parseRoutePath(file);
        const pattern = createRoutePattern(route);
        modules.add(pattern);
        if (route.type === "page") {
          pages.add(pattern);
          if (options.platformFiles) pageFiles.set(pattern, path.join(appDir, file));
        }
      }

      if (options.platformFiles) {
        scanPlatformRouteFiles(
          appDir,
          await glob.default(
            ["**/{page,layout}.{native,ios,android}.{tsx,ts,jsx,js}", "**/page.{kt,swift}"],
            { cwd: appDir, absolute: false },
          ),
          nativePages,
          nativeLayouts,
        );
      }
    }

    for (const route of await discoverProgrammaticRoutePaths(source.root, source.srcDir)) {
      pages.add(route);
      modules.add(route);
    }
  }

  if (!options.platformFiles) return { pages, modules };
  for (const [pattern, files] of nativePages) {
    if (!pages.has(pattern)) {
      const file = path.relative(root, Object.values(files)[0]!);
      throw new Error(
        `${file.replace(/\\/g, "/")} has no web page next to it. Add ${path
          .join(path.dirname(file), "page.tsx")
          .replace(/\\/g, "/")}: it is the route's web screen and the fallback on every platform.`,
      );
    }
  }
  return { pages, modules, pageFiles, nativePages, nativeLayouts };
}

function scanPlatformRouteFiles(
  appDir: string,
  files: readonly string[],
  nativePages: Map<string, PlatformRouteFiles>,
  nativeLayouts: Map<string, PlatformRouteFiles>,
): void {
  // One layer's files replace an earlier layer's per route, like page files.
  const seen = new Map<string, string>();
  for (const file of [...files].sort()) {
    const normalized = file.replace(/\\/g, "/");
    const match = PLATFORM_FILE.exec(path.posix.basename(normalized));
    if (!match) continue;
    const kind = (match[1] ?? "page") as "page" | "layout";
    const platform = (match[2] ?? match[3]) as keyof PlatformRouteFiles;
    const twin = path.posix.join(path.posix.dirname(normalized), `${kind}.tsx`);
    if (kind === "page" && parseRouteSlotFile(twin)) continue;
    // Layouts key by directory: a group's layout and its parent's share a URL pattern.
    const dir = path.posix.dirname(normalized);
    const pattern =
      kind === "page" ? createRoutePattern(parseRoutePath(twin)) : dir === "." ? "/" : `/${dir}`;
    const key = `${kind}\0${pattern}\0${platform}`;
    const previous = seen.get(key);
    if (previous) {
      throw new Error(
        `Duplicate ${platform} ${kind} for "${pattern}": found ${previous} and ${normalized} in ` +
          `${appDir}. Keep one.`,
      );
    }
    seen.set(key, normalized);
    const target = kind === "page" ? nativePages : nativeLayouts;
    const entry = { ...target.get(pattern) };
    entry[platform] = path.join(appDir, normalized);
    target.set(pattern, entry);
  }
}
