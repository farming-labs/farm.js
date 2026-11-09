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
  /** Dotted paths the renderer serves without a route file, such as a configured /llms.txt. */
  generatedPaths: readonly string[] = [],
  method = "GET",
): boolean {
  if (!pathname.includes(".") || pathname.endsWith(".html")) return false;
  const matchesAppRoute = Boolean(
    routeManager?.matchRoute(pathname)?.route ||
    routeManager?.matchMetadataRoute(pathname) ||
    routeManager?.matchMetadataImage(pathname) ||
    generatedPaths.includes(pathname),
  );
  if (method !== "GET" && method !== "HEAD") {
    // Production serves files to GET and HEAD only; any other method reaches the app, which
    // answers a file's path like any path it has no route for. Vite would serve the file.
    return !matchesAppRoute && !devServableFileExists(pathname, baseDirs);
  }
  return !matchesAppRoute || devServableFileExists(pathname, baseDirs);
}

/**
 * Whether production's HTTP layer rejects the pathname before any Farm code runs: h3 answers a
 * path whose percent-encoding does not decode (`/%ZZ`, a truncated `%E0%A4`) with a 400.
 */
export function isMalformedFarmRequestPathname(pathname: string): boolean {
  if (!pathname.includes("%")) return false;
  try {
    decodeURI(pathname);
    return false;
  } catch {
    return true;
  }
}

/** The 400 production answers a malformed pathname with: h3's JSON error, as Nitro sends it. */
export const FARM_MALFORMED_REQUEST_BODY = JSON.stringify(
  { error: true, status: 400, message: "Bad Request" },
  null,
  2,
);

/**
 * The public file production serves for a GET or HEAD of `pathname`, or null. Nitro's static
 * handler runs before middleware and routes: it drops one trailing slash, decodes the path
 * (keeping encoded slashes), and serves that file or the directory's index.html. So
 * `/hello.txt/` serves hello.txt, and `/docs` and `/docs/` serve docs/index.html.
 */
export function resolveFarmPublicFilePath(
  pathname: string,
  publicFiles: ReadonlySet<string>,
): string | null {
  if (publicFiles.size === 0) return null;
  let id = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  if (id.includes("%")) {
    const escaped = id.replace(/%2f/gi, "%252F");
    try {
      id = decodeURIComponent(escaped);
    } catch {
      id = escaped;
    }
  }
  if (publicFiles.has(id)) return id;
  const index = `${id === "/" ? "" : id}/index.html`;
  return publicFiles.has(index) ? index : null;
}

/**
 * The public dir's files as `/`-rooted URL paths, listed once and listed again after the
 * public dir changes, so matching a request against them never touches the filesystem.
 */
export function createFarmPublicFileIndex(getPublicDir: () => string | false | undefined): {
  get(): ReadonlySet<string>;
  /** Forget the listing when `file` (a watcher event's path) is in the public dir. */
  invalidate(file: string): void;
} {
  const none: ReadonlySet<string> = new Set();
  let listing: { configured: string; dir: string; files: Set<string> } | undefined;
  return {
    get() {
      const configured = getPublicDir();
      if (typeof configured !== "string" || configured.length === 0) return none;
      if (listing?.configured === configured) return listing.files;
      const dir = path.resolve(configured);
      listing = { configured, dir, files: listFarmPublicFiles(dir) };
      return listing.files;
    },
    invalidate(file) {
      if (!listing) return;
      const resolved = path.resolve(file);
      if (resolved === listing.dir || resolved.startsWith(listing.dir + path.sep)) {
        listing = undefined;
      }
    },
  };
}

function listFarmPublicFiles(dir: string): Set<string> {
  const files = new Set<string>();
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { recursive: true, withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    const filePath = path.join(entry.parentPath, entry.name);
    let isFile = entry.isFile();
    if (!isFile && entry.isSymbolicLink()) {
      try {
        isFile = fs.statSync(filePath).isFile();
      } catch {
        // A dangling link serves nothing.
      }
    }
    if (isFile) files.add(`/${path.relative(dir, filePath).split(path.sep).join("/")}`);
  }
  return files;
}

/** Vite query flags that turn a file request into a module request. */
const VITE_MODULE_QUERY_FLAGS = [
  "import",
  "raw",
  "url",
  "inline",
  "worker",
  "sharedworker",
] as const;
const SCRIPT_FETCH_DESTINATIONS = new Set(["script", "worker", "sharedworker", "serviceworker"]);

/**
 * Whether a dev request is Vite loading a module, not a visitor or an agent
 * asking for a page. A `.md` file imported by app or dependency code (an
 * eager `import.meta.glob` over Markdown, for example) arrives as
 * `/README.md?import` from a module script; the Markdown mirror and its 404
 * must leave it to Vite, or the import fails and the page never hydrates.
 */
export function isViteModuleRequest(
  url: URL,
  headers: Record<string, string | string[] | undefined>,
): boolean {
  if (VITE_MODULE_QUERY_FLAGS.some((flag) => url.searchParams.has(flag))) return true;
  const destination = headers["sec-fetch-dest"];
  const value = Array.isArray(destination) ? destination[0] : destination;
  return value !== undefined && SCRIPT_FETCH_DESTINATIONS.has(value.toLowerCase());
}

/** Root files the docs engine answers that an app can serve itself. */
const DOCS_ENGINE_APP_OWNABLE_PATHS = new Set([
  "/llms.txt",
  "/llms-full.txt",
  "/sitemap.xml",
  "/robots.txt",
]);

/**
 * Whether the app serves one of the docs engine's root files itself:
 * /llms.txt or /llms-full.txt through `agent.llmsTxt` or an llms.ts or
 * llms-full.ts route, /sitemap.xml through sitemap.ts, /robots.txt through
 * robots.ts, or any of them through a file in the public dir. Development then
 * keeps the docs engine off that path, as production does, where platforms
 * serve public files before any route. Other files under the project root do
 * not count: production does not emit them.
 */
export function farmAppOwnsDocsEnginePath(
  pathname: string,
  options: {
    generatedPaths: readonly string[];
    routeManager?: DottedPathRouteMatcher | null;
    publicDir: string | false | undefined;
  },
): boolean {
  if (!DOCS_ENGINE_APP_OWNABLE_PATHS.has(pathname)) return false;
  return (
    options.generatedPaths.includes(pathname) ||
    Boolean(options.routeManager?.matchMetadataRoute(pathname)) ||
    devServableFileExists(pathname, [options.publicDir])
  );
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
