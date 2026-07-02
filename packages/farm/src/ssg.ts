/**
 * Farm.js SSG (Static Site Generation) Module
 *
 * Handles collection and pre-rendering of SSG pages at build time.
 *
 * SSR is the default - pages render on each request
 * SSG is opt-in via `export const ssg = true`, Next-compatible route
 * config exports, or a top-of-file rendering directive.
 *
 * @example
 * ```tsx
 * // SSG Page
 * export const ssg = true;
 * export default function AboutPage() {
 *   return <h1>About</h1>;
 * }
 *
 * // SSG with ISR
 * export const ssg = true;
 * export const revalidate = 60;
 * export default async function ProductsPage() {
 *   const products = await fetchProducts();
 *   return <ProductList products={products} />;
 * }
 *
 * // Dynamic SSG
 * export const ssg = true;
 * export async function getStaticPaths() {
 *   const posts = await fetchPosts();
 *   return posts.map(post => ({ slug: post.slug }));
 * }
 * export default async function BlogPost({ params }) {
 *   return <article>{params.slug}</article>;
 * }
 *
 * // Next-compatible route config
 * export const dynamic = "force-static";
 * export const revalidate = 60;
 *
 * // Directive config
 * "use ssg; 60";
 * export default function DocsPage() {
 *   return <h1>Docs</h1>;
 * }
 * ```
 */

import { readFile } from "fs/promises";
import type { RouteModule, SSGPage, SSGCollectionResult } from "./types";

interface RouteEntry {
  path: string;
  filePath: string;
  isDynamic: boolean;
  pattern: string;
}

export type RouteRenderingDynamic = NonNullable<RouteModule["dynamic"]>;

export interface RouteRenderingConfig {
  ssg: boolean;
  revalidate?: number;
  dynamic?: RouteRenderingDynamic;
  directive?: string;
}

interface DirectiveRenderingConfig {
  ssg: boolean;
  revalidate?: number;
  dynamic?: RouteRenderingDynamic;
  directive: string;
}

/**
 * Resolve route rendering from Farm exports, Next-compatible exports, and
 * top-of-file directives such as `"use ssg";` or `"use ssg; 60";`.
 */
export function resolveRouteRenderingConfig(
  mod: RouteModule | null | undefined,
  source?: string,
): RouteRenderingConfig {
  const directiveConfig = parseRouteRenderingDirective(source);
  let ssg = directiveConfig?.ssg ?? false;
  let revalidate = directiveConfig?.revalidate;
  const moduleDynamic = normalizeDynamicMode(mod?.dynamic);
  const dynamic = moduleDynamic ?? directiveConfig?.dynamic;
  const hasExplicitSsg = typeof mod?.ssg === "boolean";

  if (hasExplicitSsg) {
    ssg = mod!.ssg === true;
  }

  if (typeof mod?.revalidate === "number") {
    if (mod.revalidate > 0) {
      revalidate = mod.revalidate;
      if (!hasExplicitSsg) {
        ssg = true;
      }
    } else {
      revalidate = undefined;
      if (!hasExplicitSsg) {
        ssg = false;
      }
    }
  } else if (mod?.revalidate === false) {
    revalidate = undefined;
  }

  if (moduleDynamic === "force-static" || moduleDynamic === "error") {
    ssg = true;
  } else if (moduleDynamic === "force-dynamic") {
    ssg = false;
    revalidate = undefined;
  }

  return {
    ssg,
    revalidate: ssg ? revalidate : undefined,
    dynamic,
    directive: directiveConfig?.directive,
  };
}

export async function resolveRouteRenderingConfigFromFile(
  mod: RouteModule | null | undefined,
  filePath: string,
): Promise<RouteRenderingConfig> {
  const source = await readFile(filePath, "utf8").catch(() => undefined);
  return resolveRouteRenderingConfig(mod, source);
}

export function parseRouteRenderingDirective(
  source: string | undefined,
): DirectiveRenderingConfig | undefined {
  if (!source) {
    return undefined;
  }

  for (const directive of readDirectivePrologue(source)) {
    const config = parseKnownRenderingDirective(directive);
    if (config) {
      return config;
    }
  }

  return undefined;
}

function parseKnownRenderingDirective(directive: string): DirectiveRenderingConfig | undefined {
  const normalized = directive.trim().toLowerCase();
  const match = normalized.match(/^use\s+(ssg|static|isr|ssr|dynamic)(?:\s*[;:]\s*(\d+))?\s*;?$/);

  if (!match?.[1]) {
    return undefined;
  }

  const mode = match[1];
  const revalidate = match[2] ? Number(match[2]) : undefined;

  if (mode === "ssr" || mode === "dynamic") {
    return {
      ssg: false,
      dynamic: "force-dynamic",
      directive,
    };
  }

  return {
    ssg: true,
    dynamic: "force-static",
    revalidate: typeof revalidate === "number" && revalidate > 0 ? revalidate : undefined,
    directive,
  };
}

function normalizeDynamicMode(value: unknown): RouteRenderingDynamic | undefined {
  switch (value) {
    case "auto":
    case "force-static":
    case "force-dynamic":
    case "error":
      return value;
    default:
      return undefined;
  }
}

function readDirectivePrologue(source: string): string[] {
  const directives: string[] = [];
  let index = skipTrivia(source, 0);

  while (index < source.length) {
    const parsed = readStringStatement(source, index);
    if (!parsed) {
      break;
    }

    directives.push(parsed.value);
    index = skipTrivia(source, parsed.end);
  }

  return directives;
}

function skipTrivia(source: string, start: number): number {
  let index = start;

  while (index < source.length) {
    const char = source[index];

    if (char && /\s/.test(char)) {
      index += 1;
      continue;
    }

    if (source.startsWith("//", index)) {
      const nextLine = source.indexOf("\n", index + 2);
      index = nextLine === -1 ? source.length : nextLine + 1;
      continue;
    }

    if (source.startsWith("/*", index)) {
      const end = source.indexOf("*/", index + 2);
      index = end === -1 ? source.length : end + 2;
      continue;
    }

    break;
  }

  return index;
}

function readStringStatement(
  source: string,
  start: number,
): { value: string; end: number } | undefined {
  const quote = source[start];
  if (quote !== '"' && quote !== "'") {
    return undefined;
  }

  let value = "";
  let index = start + 1;

  while (index < source.length) {
    const char = source[index];
    if (char === "\\") {
      value += source.slice(index, index + 2);
      index += 2;
      continue;
    }

    if (char === quote) {
      index += 1;
      const semicolonIndex = skipHorizontalWhitespace(source, index);
      const end = source[semicolonIndex] === ";" ? semicolonIndex + 1 : index;
      return { value, end };
    }

    value += char ?? "";
    index += 1;
  }

  return undefined;
}

function skipHorizontalWhitespace(source: string, start: number): number {
  let index = start;
  while (source[index] === " " || source[index] === "\t" || source[index] === "\r") {
    index += 1;
  }
  return index;
}

/**
 * Collect SSG pages from route modules
 *
 * Scans all routes and categorizes them into:
 * - SSG pages: Pre-rendered at build time
 * - SSR routes: Rendered on each request
 *
 * @param routes - Array of route entries
 * @param loadModule - Function to load a route module
 * @returns SSG pages and SSR routes
 */
export async function collectSSGPages(
  routes: RouteEntry[],
  loadModule: (filePath: string) => Promise<RouteModule>,
): Promise<SSGCollectionResult> {
  const ssgPages: SSGPage[] = [];
  const ssrRoutes: string[] = [];

  for (const route of routes) {
    try {
      const mod = await loadModule(route.filePath);

      if (!mod) {
        ssrRoutes.push(route.path);
        continue;
      }

      const rendering = await resolveRouteRenderingConfigFromFile(mod, route.filePath);

      // Check if page is marked for SSG
      if (rendering.ssg) {
        if (route.isDynamic) {
          // Dynamic SSG route requires getStaticPaths
          const getStaticPaths = mod.getStaticPaths || mod.generateStaticParams;

          if (!getStaticPaths) {
            throw new Error(
              `Dynamic SSG route "${route.path}" requires getStaticPaths export. ` +
                `Add: export function getStaticPaths() { return [{ paramName: 'value' }]; }`,
            );
          }

          // Get all paths to pre-render
          const paths = await getStaticPaths();

          for (const params of paths) {
            // Build URL path by replacing dynamic segments
            let urlPath = route.path;
            for (const [key, value] of Object.entries(params)) {
              // Handle [...slug] catch-all routes
              urlPath = urlPath.replace(`[...${key}]`, value);
              // Handle [slug] dynamic routes
              urlPath = urlPath.replace(`[${key}]`, value);
            }

            ssgPages.push({
              urlPath,
              filePath: route.filePath,
              params,
              revalidate: rendering.revalidate,
            });
          }
        } else {
          // Static SSG page
          ssgPages.push({
            urlPath: route.path,
            filePath: route.filePath,
            params: {},
            revalidate: rendering.revalidate,
          });
        }
      } else {
        // SSR route (default)
        ssrRoutes.push(route.path);
      }
    } catch (error) {
      console.error(`Error processing route ${route.path}:`, error);
      // Fall back to SSR for problematic routes
      ssrRoutes.push(route.path);
    }
  }

  return { ssg: ssgPages, ssr: ssrRoutes };
}

/**
 * Check if a route module is SSG
 */
export function isSSGModule(mod: RouteModule | null | undefined): boolean {
  return resolveRouteRenderingConfig(mod).ssg;
}

/**
 * Check if a route module has ISR (Incremental Static Regeneration)
 */
export function hasISR(mod: RouteModule | null | undefined): boolean {
  const rendering = resolveRouteRenderingConfig(mod);
  return rendering.ssg && typeof rendering.revalidate === "number" && rendering.revalidate > 0;
}

/**
 * Get revalidation interval for a module
 */
export function getRevalidateInterval(mod: RouteModule | null | undefined): number | undefined {
  return resolveRouteRenderingConfig(mod).revalidate;
}

/**
 * Generate SSG manifest for production builds
 */
export function generateSSGManifest(pages: SSGPage[]): string {
  return JSON.stringify(
    pages.map((page) => ({
      urlPath: page.urlPath,
      params: page.params,
      revalidate: page.revalidate,
    })),
    null,
    2,
  );
}

/**
 * Check if a URL path matches an SSG page
 */
export function matchSSGPage(urlPath: string, ssgPages: SSGPage[]): SSGPage | undefined {
  const normalizedPath = urlPath === "/" ? "/" : urlPath.replace(/\/$/, "");
  return ssgPages.find((page) => page.urlPath === normalizedPath);
}
