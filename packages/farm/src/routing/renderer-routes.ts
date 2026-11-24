import fs from "node:fs";
import path from "node:path";
import {
  createFarmRendererHookError,
  readFarmRendererHydration,
  resolveFarmComponentExtensions,
  type FarmRenderer,
  type FarmRendererHydration,
  type FarmRendererRouteFile,
  type FarmRendererRouteKind,
  type FarmRendererRoutes,
} from "../renderer";
import { parseRoutePath } from "../utils";

const ROUTE_KINDS: ReadonlySet<string> = new Set<FarmRendererRouteKind>([
  "page",
  "layout",
  "loading",
  "error",
  "not-found",
]);

/** Files Farm discovers itself in `src/app`, which it never hands to a renderer's `resolve()`. */
const FARM_OWNED_FILES: ReadonlySet<string> = new Set([
  "route",
  "middleware",
  "instrumentation",
  "sitemap",
  "robots",
  "manifest",
  "llms",
  "llms-full",
  "opengraph-image",
  "twitter-image",
]);

/** A route a renderer's rules mapped a file to. */
export interface FarmRendererRouteEntry {
  kind: FarmRendererRouteKind;
  /** The pattern the rule returned. */
  pattern: string;
  /**
   * The file as Farm's folders would name it, relative to the route directory:
   * `blog/[slug]/page.leaf`. Route parsing reads it; nothing opens it.
   */
  routeFile: string;
  /** The file itself, absolute. */
  modulePath: string;
  /** Hydration settings the rule returned for the file. */
  hydration: FarmRendererHydration;
}

export interface FarmRendererRouteTable {
  /** The scanned directory, absolute. */
  dir: string;
  entries: FarmRendererRouteEntry[];
}

/**
 * Farm's folder rules as a renderer's `routes()` receives them in `defaults`: a file named
 * `page`, `layout`, `loading` or `error` is that kind of route for its directory, and a
 * `not-found` file directly in the directory is the not-found page.
 */
export function createFarmFolderRoutes(dir?: string): FarmRendererRoutes {
  return {
    ...(dir === undefined ? {} : { dir }),
    resolve(file) {
      if (!ROUTE_KINDS.has(file.name)) return null;
      const kind = file.name as FarmRendererRouteKind;
      if (kind === "not-found" && file.segments.length > 0) return null;
      return { kind, pattern: `/${file.segments.join("/")}` };
    },
  };
}

/**
 * The routes a renderer's `routes()` maps the files under its directory to, or null when the
 * renderer leaves routes to Farm's folders. Throws for a rule Farm can't serve, naming the file.
 */
export async function resolveFarmRendererRoutes(options: {
  renderer: Pick<FarmRenderer, "name" | "routes" | "componentExtensions">;
  /** The project root, or a layer's root. */
  root: string;
  srcDir?: string;
}): Promise<FarmRendererRouteTable | null> {
  const { renderer } = options;
  if (typeof renderer?.routes !== "function") return null;
  const root = path.resolve(options.root);
  const defaultDir = path.join(options.srcDir ?? "src", "app");
  const where = `Renderer \`${renderer.name}\` routes()`;

  const rules = (await renderer.routes({
    root,
    defaults: createFarmFolderRoutes(defaultDir),
  })) as unknown;
  if (
    !rules ||
    typeof rules !== "object" ||
    typeof (rules as FarmRendererRoutes).resolve !== "function"
  ) {
    throw new TypeError(`${where} must return an object with a \`resolve(file)\` method.`);
  }
  const { dir: configuredDir, resolve } = rules as FarmRendererRoutes;
  if (configuredDir !== undefined && (typeof configuredDir !== "string" || !configuredDir.trim())) {
    throw new TypeError(
      `${where} returned \`dir: ${JSON.stringify(configuredDir)}\`. Return a directory relative to ${root}, or leave it out for ${defaultDir}.`,
    );
  }
  const dir = path.resolve(root, configuredDir ?? defaultDir);
  const relativeDir = path.relative(root, dir);
  if (relativeDir.startsWith("..") || path.isAbsolute(relativeDir)) {
    throw new Error(
      `${where} returned \`dir: ${JSON.stringify(configuredDir)}\`, which is outside ${root}. Keep route files inside the project.`,
    );
  }

  const extensions = [
    ...resolveFarmComponentExtensions(renderer.componentExtensions),
    ".md",
    ".mdx",
  ];
  const files = await listRouteCandidates(dir, extensions);
  const entries: FarmRendererRouteEntry[] = [];
  const claimed = new Map<string, string>();

  for (const relative of files) {
    const extension = path.extname(relative).toLowerCase();
    const parts = relative.split("/");
    const fileName = parts.pop()!;
    const name = fileName.slice(0, fileName.length - extension.length);
    // Named slots and Farm's own files stay with Farm's `src/app` discovery.
    if (FARM_OWNED_FILES.has(name) || parts.some((part) => part.startsWith("@"))) continue;
    if (fileName.endsWith(".d.ts")) continue;

    const modulePath = path.join(dir, ...relative.split("/"));
    const file: FarmRendererRouteFile = Object.freeze({
      path: relative,
      segments: Object.freeze(parts),
      name,
      extension,
    });
    let rule: unknown;
    try {
      rule = resolve.call(rules, file);
    } catch (error) {
      throw createFarmRendererHookError(
        `${where} threw while resolving ${modulePath}: ${error instanceof Error ? error.message : String(error)}`,
        error,
      );
    }
    if (rule === null || rule === undefined) continue;

    const entry = readRouteRule(rule, `${where} for ${modulePath}`, extension, modulePath);
    // One file per kind and URL: two pages for /about would leave which one renders to chance.
    const key = `${entry.kind}:${entry.pattern}${extension === ".md" || extension === ".mdx" ? ":markdown" : ""}`;
    const existing = claimed.get(key);
    if (existing) {
      throw new Error(
        `${where} maps two files to the ${entry.kind} "${entry.pattern}": ${existing} and ${modulePath}. Return null for one of them, or give it another pattern.`,
      );
    }
    claimed.set(key, modulePath);
    entries.push(entry);
  }

  return { dir, entries };
}

function readRouteRule(
  rule: unknown,
  where: string,
  extension: string,
  modulePath: string,
): FarmRendererRouteEntry {
  if (typeof rule !== "object" || Array.isArray(rule)) {
    throw new TypeError(
      `${where} returned ${JSON.stringify(rule)}. Return \`{ kind, pattern }\`, or null when the file isn't a route.`,
    );
  }
  const value = rule as Record<string, unknown>;
  const kind = value.kind;
  if (typeof kind !== "string" || !ROUTE_KINDS.has(kind)) {
    throw new TypeError(
      `${where} returned \`kind: ${JSON.stringify(kind)}\`. Use "page", "layout", "loading", "error", or "not-found".`,
    );
  }
  const pattern = value.pattern;
  if (typeof pattern !== "string") {
    throw new TypeError(
      `${where} returned \`pattern: ${JSON.stringify(pattern)}\`. Return a URL pattern such as "/blog/[slug]".`,
    );
  }
  const segments = readPatternSegments(pattern, where);
  if (kind === "not-found" && segments.length > 0) {
    throw new Error(
      `${where} returned a not-found route for "${pattern}". Farm renders one not-found page: return \`pattern: "/"\`.`,
    );
  }
  const routeFile = [...segments, `${kind}${extension}`].join("/");
  try {
    parseRoutePath(routeFile);
  } catch (error) {
    throw createFarmRendererHookError(
      `${where} returned \`pattern: ${JSON.stringify(pattern)}\`: ${error instanceof Error ? error.message : String(error)}`,
      error,
    );
  }
  return {
    kind: kind as FarmRendererRouteKind,
    pattern,
    routeFile,
    modulePath,
    hydration: readFarmRendererHydration(value, where),
  };
}

function readPatternSegments(pattern: string, where: string): string[] {
  const fix = 'Write it as src/app folders do: "/", "/blog/[slug]", "/docs/[...path]".';
  if (!pattern.startsWith("/")) {
    throw new Error(
      `${where} returned \`pattern: ${JSON.stringify(pattern)}\`, which doesn't start with "/". ${fix}`,
    );
  }
  if (pattern === "/") return [];
  const segments = pattern.slice(1).split("/");
  for (const segment of segments) {
    if (
      segment === "" ||
      segment === "." ||
      segment === ".." ||
      segment.startsWith("@") ||
      /[\\?#]/.test(segment)
    ) {
      throw new Error(
        `${where} returned \`pattern: ${JSON.stringify(pattern)}\`, which has the segment ${JSON.stringify(segment)}. ${fix} Named slots (@name) stay in src/app.`,
      );
    }
  }
  return segments;
}

/** Files under `dir` with one of `extensions`, relative and sorted so every scan sees one order. */
async function listRouteCandidates(dir: string, extensions: readonly string[]): Promise<string[]> {
  if (!fs.existsSync(dir)) return [];
  const { glob } = await import("tinyglobby");
  const names = extensions.map((extension) => extension.slice(1)).join(",");
  const files = await glob(`**/*.{${names}}`, {
    cwd: dir,
    expandDirectories: false,
    ignore: ["**/node_modules/**"],
  });
  return files.map((file) => file.replace(/\\/g, "/")).sort();
}
