import * as fs from "fs";
import * as path from "path";

interface DottedPathRouteMatcher {
  matchRoute(pathname: string): { route: unknown } | null | undefined;
  matchMetadataRoute(pathname: string): object | null;
  matchMetadataImage(pathname: string): object | null;
}

/**
 * Decide whether the dev server should hand a dotted request path to the
 * static pipeline instead of Farm's renderer. Dotted paths are usually asset
 * requests, but they are also how page routes with dotted segments and
 * application metadata routes (/manifest.webmanifest, /sitemap.xml,
 * /robots.txt, generated metadata images) are addressed, so the router is
 * only bypassed when nothing in the app matches the pathname or a real file
 * shadows it.
 */
export function shouldBypassFarmRouterForDottedPath(
  pathname: string,
  routeManager: DottedPathRouteMatcher | null | undefined,
  baseDirs: Array<string | false | undefined>,
): boolean {
  if (!pathname.includes(".") || pathname.endsWith(".html")) return false;
  const matchesAppRoute = Boolean(
    routeManager?.matchRoute(pathname)?.route ||
    routeManager?.matchMetadataRoute(pathname) ||
    routeManager?.matchMetadataImage(pathname),
  );
  return !matchesAppRoute || devServableFileExists(pathname, baseDirs);
}

/**
 * Route segments may legitimately contain dots (e.g. /kinfish/farm.js), so a
 * dot alone cannot classify a dev request as a static asset. A dotted path is
 * only treated as an asset when it maps to a real file under one of the
 * servable base dirs (project root, public dir), matching the
 * filesystem-first behavior of production hosting.
 */
export function devServableFileExists(
  pathname: string,
  baseDirs: Array<string | false | undefined>,
): boolean {
  let decodedPathname: string;
  try {
    decodedPathname = decodeURIComponent(pathname);
  } catch {
    return false;
  }
  const relativePathname = decodedPathname.replace(/^\/+/, "");
  if (!relativePathname) return false;
  for (const baseDir of baseDirs) {
    if (typeof baseDir !== "string" || baseDir.length === 0) continue;
    const resolvedBase = path.resolve(baseDir);
    const candidate = path.resolve(resolvedBase, relativePathname);
    if (!candidate.startsWith(resolvedBase + path.sep)) continue;
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return true;
      }
    } catch {
      // Ignore filesystem errors and keep checking other base dirs.
    }
  }
  return false;
}
