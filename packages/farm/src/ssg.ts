/**
 * Farm.js SSG (Static Site Generation) Module
 *
 * Handles collection and pre-rendering of SSG pages at build time.
 *
 * SSR is the default - pages render on each request
 * SSG is opt-in via `export const ssg = true`
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
 * ```
 */

import type { RouteModule, SSGPage, SSGCollectionResult } from "./types";

interface RouteEntry {
  path: string;
  filePath: string;
  isDynamic: boolean;
  pattern: string;
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

      // Check if page is marked for SSG
      if (mod.ssg === true) {
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
              revalidate: mod.revalidate,
            });
          }
        } else {
          // Static SSG page
          ssgPages.push({
            urlPath: route.path,
            filePath: route.filePath,
            params: {},
            revalidate: mod.revalidate,
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
  return mod?.ssg === true;
}

/**
 * Check if a route module has ISR (Incremental Static Regeneration)
 */
export function hasISR(mod: RouteModule | null | undefined): boolean {
  return mod?.ssg === true && typeof mod.revalidate === "number" && mod.revalidate > 0;
}

/**
 * Get revalidation interval for a module
 */
export function getRevalidateInterval(mod: RouteModule | null | undefined): number | undefined {
  if (hasISR(mod)) {
    return mod!.revalidate;
  }
  return undefined;
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
