import { promises as fsp } from "fs";
import * as path from "path";
import type { IncomingMessage, ServerResponse } from "http";
import type { ViteDevServer } from "vite";

/**
 * Set on every request that `farm preview` tunnels into the development server. The preview relay
 * and the polling gateway client both overwrite any value a visitor sent, so its presence means
 * the request came from the public preview URL, not from the developer's machine.
 */
export const FARM_PREVIEW_REQUEST_HEADER = "x-farm-preview";

export function isFarmPreviewTunnelRequest(headers: IncomingMessage["headers"]): boolean {
  return headers[FARM_PREVIEW_REQUEST_HEADER] !== undefined;
}

export interface FarmDevPreviewGuardSourceRoot {
  root: string;
  srcDir: string;
}

export interface FarmDevPreviewGuardOptions {
  /** Application and layer source directories whose modules the preview's browser loads. */
  getSourceRoots(): readonly FarmDevPreviewGuardSourceRoot[];
}

/** Vite's `server.fs.deny` default, which a configured list replaces rather than extends. */
export const VITE_DEFAULT_FS_DENY = [
  ".env",
  ".env.*",
  "*.{crt,pem,key,p12,pfx,cer,der}",
  ".npmrc",
  ".yarnrc.yml",
  "**/.git/**",
] as const;

/**
 * Farm's build output and local state (the auth database, build caches, the Nitro server bundle)
 * live in `.farm` or the configured `distDir`; the dev file server must never hand them out.
 * Returned from the `config` hook, so Vite appends it to an app's own `server.fs.deny` and the
 * defaults are only restated when the app has not set the list itself.
 */
export function getFarmDevFsDeny(
  userDeny: readonly string[] | undefined,
  options: { root?: string; distDir?: string },
): string[] {
  const deny = ["**/.farm/**"];
  const root = path.resolve(options.root || process.cwd());
  const distDir = options.distDir ? path.resolve(root, options.distDir) : undefined;
  const relativeDistDir = distDir ? path.relative(root, distDir) : "";
  // A distDir that is the root, contains it, or needs glob escaping is left to the defaults.
  if (
    distDir &&
    relativeDistDir &&
    relativeDistDir !== ".farm" &&
    relativeDistDir !== ".." &&
    !relativeDistDir.startsWith(`..${path.sep}`) &&
    !/[*?[\]{}()!+@]/.test(distDir)
  ) {
    deny.push(`${distDir.replace(/\\/g, "/")}/**`);
  }
  return userDeny ? deny : [...VITE_DEFAULT_FS_DENY, ...deny];
}

/** Vite queries that return a file's source, a URL, or an inlined copy instead of the module. */
const SOURCE_QUERY_FLAGS = ["raw", "inline", "url"] as const;

/** Files Vite serves as transformed modules, which is how the browser loads app code. */
const MODULE_EXTENSION =
  /\.(?:[cm]?[jt]sx?|vue|svelte|astro|mdx?|css|scss|sass|less|styl|stylus|pcss|postcss|sss)$/i;

/** Vite's known asset types: what app code references as an image, font, media, or document URL. */
const ASSET_EXTENSION =
  /\.(?:apng|bmp|png|jpe?g|jfif|pjpeg|pjp|gif|svg|ico|webp|avif|cur|jxl|mp4|webm|ogg|mp3|wav|flac|aac|opus|mov|m4a|vtt|woff2?|eot|ttf|otf|webmanifest|pdf|txt|wasm)$/i;

/** Vite's own client and Farm's virtual entries are always needed for the page to run. */
const INTERNAL_PREFIXES = ["/@vite/", "/@farm/", "/@react-refresh", "/__vite_ping"];

/** Development tools that act on, or describe, the developer's machine. */
const DEVELOPER_ONLY_PREFIXES = ["/__farm/devtools", "/__open-in-editor"];

/**
 * Keep a `farm preview` URL to what the app's browser code actually needs.
 *
 * The preview tunnel reaches the dev server as `localhost`, so Vite's host checks pass and its file
 * server would otherwise answer the public with anything outside `server.fs.deny`: config files,
 * raw server source, the build output, or any file in the workspace through `/@fs/`. Requests
 * without the preview marker are never touched.
 *
 * A marked file request is served when the client module graph already references that exact URL
 * (app code imported it), when it is a dependency under `node_modules`, a public file, or a module
 * or asset inside a source directory. Raw source and URL queries are only served through the graph.
 */
export function createFarmDevPreviewGuard(
  server: ViteDevServer,
  options: FarmDevPreviewGuardOptions,
) {
  return async function farmDevPreviewGuard(
    req: IncomingMessage,
    res: ServerResponse,
    next: (error?: unknown) => void,
  ): Promise<void> {
    if (!isFarmPreviewTunnelRequest(req.headers)) return next();
    try {
      if (await isAllowedPreviewRequest(server, options, req)) return next();
    } catch {
      // Fail closed: an unresolvable request is not one the preview needs.
    }
    res.statusCode = 403;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.end("This development file is not available through farm preview.");
  };
}

async function isAllowedPreviewRequest(
  server: ViteDevServer,
  options: FarmDevPreviewGuardOptions,
  req: IncomingMessage,
): Promise<boolean> {
  const rawUrl = req.url || "/";
  const queryIndex = rawUrl.indexOf("?");
  const rawPath = queryIndex === -1 ? rawUrl : rawUrl.slice(0, queryIndex);
  const query = new URLSearchParams(queryIndex === -1 ? "" : rawUrl.slice(queryIndex + 1));
  let pathname = decodeURI(rawPath);

  // Vite serves module requests both under its base and, for non-HTML requests, without it.
  const base = (server.config.base || "/").replace(/\/$/, "");
  if (base.startsWith("/") && (pathname === base || pathname.startsWith(`${base}/`))) {
    pathname = pathname.slice(base.length) || "/";
  }
  const url = `${pathname}${queryIndex === -1 ? "" : rawUrl.slice(queryIndex)}`;

  if (DEVELOPER_ONLY_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return false;
  if (INTERNAL_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return true;
  // Vite only serves files for GET and HEAD; every other method belongs to the app's routes.
  const method = (req.method || "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") return true;

  const file = await resolveRequestedFile(server, pathname);
  // Virtual modules and paths without a file (pages, API routes, public files) have nothing to
  // leak from the filesystem; the app and Vite answer them as usual.
  if (!file) return true;

  const client = server.environments?.client;
  const inClientGraph = async () => Boolean(await client?.moduleGraph.getModuleByUrl(url));
  if (SOURCE_QUERY_FLAGS.some((flag) => query.has(flag))) return inClientGraph();
  if (await inClientGraph()) return true;

  if (file.split(path.sep).includes("node_modules")) return true;
  if (server.config.publicDir && isInside(await realpathOr(server.config.publicDir), file)) {
    return true;
  }

  const isModuleOrAsset =
    MODULE_EXTENSION.test(file) || ASSET_EXTENSION.test(file) || query.has("import");
  if (!isModuleOrAsset) return false;
  for (const source of options.getSourceRoots()) {
    const sourceRoot = await realpathOr(source.root);
    const sourceDir = await realpathOr(path.resolve(source.root, source.srcDir));
    // An app without a src directory keeps its config files at the root it shares with app code.
    if (sourceRoot === sourceDir && path.dirname(file) === sourceDir) continue;
    if (isInside(sourceDir, file)) return true;
  }
  return false;
}

/** The real, case-correct path of the file Vite would serve for this pathname, if any. */
async function resolveRequestedFile(
  server: ViteDevServer,
  pathname: string,
): Promise<string | undefined> {
  let candidate: string | undefined;
  if (pathname.startsWith("/@fs/")) {
    candidate = pathname.slice("/@fs".length);
    if (/^\/[A-Za-z]:/.test(candidate)) candidate = candidate.slice(1);
  } else {
    let id = pathname;
    if (id.startsWith("/@id/")) {
      id = id.slice("/@id/".length).replace(/^__x00__/, "\0");
      if (id.startsWith("\0")) return undefined;
    }
    const resolved = await server.environments?.client?.pluginContainer.resolveId(id, undefined);
    const resolvedId = resolved?.id.replace(/[?#].*$/, "");
    if (resolvedId && path.isAbsolute(resolvedId)) candidate = resolvedId;
    else if (resolvedId?.startsWith("\0")) return undefined;
    else if (id.startsWith("/")) candidate = path.join(server.config.root, id);
  }
  if (!candidate) return undefined;

  try {
    const real = await fsp.realpath(candidate);
    return (await fsp.stat(real)).isFile() ? real : undefined;
  } catch {
    return undefined;
  }
}

async function realpathOr(directory: string): Promise<string> {
  try {
    return await fsp.realpath(directory);
  } catch {
    return path.resolve(directory);
  }
}

function isInside(directory: string, file: string): boolean {
  const relative = path.relative(directory, file);
  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}
