import path from "node:path";
import { farmRouteRuleMatches } from "../route-runtime";

export const FARM_IMMUTABLE_ASSET_CACHE_CONTROL = "public, max-age=31536000, immutable" as const;
export const FARM_IMMUTABLE_ASSET_MAX_AGE = 31_536_000;

/**
 * A content-hashed file of Farm's client output, as a URL path. The client build names every
 * chunk `chunks/<name>-h<hash>.js`, every asset `assets/<name>-h<hash><ext>` (fonts and the
 * hashed stylesheet copy included), and the entries `farm-client-h<hash>.js`,
 * `farm-client-boot-h<hash>.js` and `farm-mobile-client-h<hash>.js` at the root, where their
 * relative chunk imports pin them. The `-h` marker plus a hex hash keeps an ordinary public file
 * such as `icon-v2.svg` out, and HTML is never immutable.
 *
 * Hashed client files are served at the origin root even with a basePath: the client build sets
 * no Vite `base` and Nitro mounts the client output at "/".
 */
export const FARM_IMMUTABLE_ASSET_PATH_SOURCE =
  "^/(?:(?:assets|chunks)/(?:.+/)*[^/]+|farm-(?:mobile-)?client(?:-boot)?)" +
  "-h(?:[a-fA-F0-9]{8}|[a-fA-F0-9]{12}|[a-fA-F0-9]{16})\\.(?!(?:[hH][tT][mM][lL]?)$)[^/]+$";

const FARM_IMMUTABLE_ASSET_PATH = new RegExp(FARM_IMMUTABLE_ASSET_PATH_SOURCE);

export function isFarmImmutableAssetPath(pathname: string): boolean {
  return FARM_IMMUTABLE_ASSET_PATH.test(pathname);
}

/** The client output directories the build writes hashed files into. */
const FARM_HASHED_ASSET_DIRS = ["assets", "chunks"] as const;

// Characters a route rule key can hold literally: rou3 and the platforms' `_headers` files read
// `:` and `*` as patterns. A hashed file with another character is simply not given the header.
const LITERAL_ROUTE_PATH = /^\/[\w.~@/-]+$/;

export interface FarmImmutableAssetDir {
  dir: string;
  baseURL: string;
  maxAge: number;
}

export interface FarmImmutableAssetPlan {
  /** Directories holding only hashed files, served through Nitro's `publicAssets`. */
  publicAssets: FarmImmutableAssetDir[];
  /** One header rule per hashed file outside such a directory. */
  routeRules: Record<string, { headers: { "cache-control": string } }>;
}

export interface FarmImmutableAssetPlanOptions {
  clientOutputDir: string;
  /** Every file of the client output as a URL path, such as `/chunks/page-h1a2b3c4d.js`. */
  files: readonly string[];
  /** The app's Nitro route rules. A file one of them sets Cache-Control for keeps that value. */
  routeRules?: Record<string, { headers?: Record<string, string> } | undefined>;
  /** Public paths of the app's own routes. A directory one of them starts with is left shared. */
  routePaths?: readonly string[];
}

/**
 * How Nitro gives each content-hashed client file `Cache-Control: public, max-age=31536000,
 * immutable` on every preset it builds.
 *
 * A directory that holds only hashed files (`chunks/`, and `assets/` unless public/assets put
 * files beside Vite's) becomes its own `publicAssets` entry with a `maxAge`. Nitro turns that into
 * a route rule on Node and Bun, a `_headers` rule on Netlify and Cloudflare, and serves the
 * directory without the server function there; a missing file is a 404 without the header.
 * Hashed files anywhere else, including the root entries, get an exact-path header rule, so an
 * unhashed public file and an app route never receive it.
 *
 * A directory an app route starts with (`/assets/[id]`) stays shared with the app. An app route
 * rule that sets Cache-Control for a file wins over Farm's policy for that file.
 */
export function planFarmImmutableAssets(
  options: FarmImmutableAssetPlanOptions,
): FarmImmutableAssetPlan {
  const cacheRulePatterns = Object.entries(options.routeRules ?? {})
    .filter(([, rule]) =>
      Object.keys(rule?.headers ?? {}).some((name) => name.toLowerCase() === "cache-control"),
    )
    .map(([pattern]) => pattern);
  const isImmutable = (file: string) =>
    isFarmImmutableAssetPath(file) &&
    !cacheRulePatterns.some((pattern) => farmRouteRuleMatches(pattern, file));
  const routeDirs = new Set(
    (options.routePaths ?? []).map((routePath) => routePath.split("/").filter(Boolean)[0]),
  );

  const plan: FarmImmutableAssetPlan = { publicAssets: [], routeRules: {} };
  const addRule = (file: string) => {
    if (!LITERAL_ROUTE_PATH.test(file)) return;
    plan.routeRules[file] = { headers: { "cache-control": FARM_IMMUTABLE_ASSET_CACHE_CONTROL } };
  };

  const dirFiles = new Map<string, string[]>();
  for (const file of options.files) {
    const dir = file.split("/")[1]!;
    if (file.split("/").length > 2 && (FARM_HASHED_ASSET_DIRS as readonly string[]).includes(dir)) {
      dirFiles.set(dir, [...(dirFiles.get(dir) ?? []), file]);
    } else if (isImmutable(file)) {
      addRule(file);
    }
  }
  for (const [dir, files] of dirFiles) {
    if (!routeDirs.has(dir) && files.every(isImmutable)) {
      plan.publicAssets.push({
        dir: path.join(options.clientOutputDir, dir),
        baseURL: `/${dir}`,
        maxAge: FARM_IMMUTABLE_ASSET_MAX_AGE,
      });
    } else {
      for (const file of files) if (isImmutable(file)) addRule(file);
    }
  }
  return plan;
}

/** Every file below `dir` as a URL path, such as `/chunks/page-h1a2b3c4d.js`. */
export async function listFarmClientOutputFiles(dir: string): Promise<string[]> {
  const fs = await import("node:fs/promises");
  const entries = await fs.readdir(dir, { recursive: true, withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const relative = path.relative(dir, path.join(entry.parentPath, entry.name));
      return `/${relative.split(path.sep).join("/")}`;
    });
}
