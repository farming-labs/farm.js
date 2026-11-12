/**
 * `runtime: "edge"` middleware on Vercel. A page that only such middleware guards is prerendered,
 * and the build puts the middleware in front of its static file as Vercel routing middleware (a
 * Build Output API route with `middlewarePath`), so the guard still decides every request while
 * the page is served from the CDN instead of rendered by the function. Every other target, and
 * every other page, keeps running the same middleware in the server.
 */
import { createRequire, isBuiltin } from "node:module";
import path from "node:path";
import { gzipSync } from "node:zlib";
import type { Plugin } from "rolldown";
import type { ResolvedFarmConfig } from "../config";
import { resolveFarmAPIServerBasePath } from "../api/server-path";
import { applyFarmBasePath } from "../base-path";
import type { StaticMiddlewareConfig } from "../middleware/static-config";
import { createFarmSourceAlias } from "../server/vite-config";
import { withPlainDiagnostics } from "../build/node-module-bundle";
import { logger } from "../utils";

/** The Vercel function that runs the edge middleware; its name is also its `middlewarePath`. */
export const FARM_VERCEL_EDGE_MIDDLEWARE_FUNCTION = "_farm_middleware";
/** Rewritten to by a middleware that calls `notFound()`: no route answers it. */
export const FARM_VERCEL_EDGE_NOT_FOUND_PATH = "/__farm/not-found";

// The Node modules Vercel's Edge runtime provides, with or without the `node:` prefix.
const EDGE_NODE_MODULES = new Set(["async_hooks", "events", "buffer", "assert", "util"]);
// Hobby's limit after gzip; Pro allows 2 MB and Enterprise 4 MB.
const EDGE_FUNCTION_SIZE_WARNING_BYTES = 1024 * 1024;

export interface FarmEdgeMiddlewareRoute {
  path: string;
  filePath: string;
  config?: StaticMiddlewareConfig | null | "unknown";
}

/** Whether the target runs `runtime: "edge"` middleware before it serves static files. */
export function farmTargetRunsEdgeMiddleware(preset: string): boolean {
  return preset === "vercel";
}

/** Whether a middleware file's literal `config` asks for the edge runtime. */
export function isFarmEdgeMiddlewareRoute(route: FarmEdgeMiddlewareRoute): boolean {
  return typeof route.config === "object" && route.config?.runtime === "edge";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The Vercel route that runs the edge middleware for exactly these prerendered pages. No URL may
 * reach a guarded file without its guard, so it matches every URL the static output answers for a
 * page: the path its file is written at (prerendered files are written at the app path, without
 * the basePath), the same path under the basePath, and each with `/`, `/index.html`, or `.html`.
 */
export function createFarmVercelEdgeMiddlewareRoute(
  pathnames: readonly string[],
  basePath = "/",
): { src: string; middlewarePath: string; middlewareRawSrc: string[]; continue: true } {
  const publicPaths = [
    ...new Set(pathnames.flatMap((pathname) => [pathname, applyFarmBasePath(pathname, basePath)])),
  ];
  const alternatives = publicPaths.map((pathname) => {
    const trimmed = pathname.replace(/\/+$/, "");
    return trimmed ? `${escapeRegExp(trimmed)}(?:/|/index\\.html|\\.html)?` : "/(?:index\\.html)?";
  });
  return {
    src: `^(?:${alternatives.join("|")})$`,
    middlewarePath: FARM_VERCEL_EDGE_MIDDLEWARE_FUNCTION,
    middlewareRawSrc: publicPaths,
    continue: true,
  };
}

/** The edge function's entry: the edge middleware files and the runtime that answers for them. */
export function generateFarmVercelEdgeMiddlewareEntry(
  routes: readonly FarmEdgeMiddlewareRoute[],
  config: ResolvedFarmConfig,
): string {
  const imports = routes.map(
    (route, index) =>
      `import * as farmEdgeMiddleware${index} from ${JSON.stringify(route.filePath.replace(/\\/g, "/"))};`,
  );
  const modules = routes.map(
    (route, index) =>
      `  { path: ${JSON.stringify(route.path)}, filePath: ${JSON.stringify(route.filePath)}, module: farmEdgeMiddleware${index} },`,
  );
  return `import { createFarmVercelEdgeMiddleware } from "@farm.js/core/internal/vercel-edge-middleware";
${imports.join("\n")}

export default createFarmVercelEdgeMiddleware({
  modules: [
${modules.join("\n")}
  ],
  i18n: ${JSON.stringify(config.i18n)},
  server: ${JSON.stringify({ trustProxy: config.server?.trustProxy === true })},
  apiBasePath: ${JSON.stringify(resolveFarmAPIServerBasePath(config.api))},
  notFoundPath: ${JSON.stringify(applyFarmBasePath(FARM_VERCEL_EDGE_NOT_FOUND_PATH, config.basePath))},
});
`;
}

/** The real directory of the `@farm.js/core` install the app resolves. */
async function resolveFarmCoreDir(root: string, fs: typeof import("fs/promises")): Promise<string> {
  const runtimeEntry = createRequire(path.join(root, "package.json")).resolve(
    "@farm.js/core/internal/vercel-edge-middleware",
  );
  // dist/internal/vercel-edge-middleware.* -> the package directory.
  return fs.realpath(path.resolve(path.dirname(runtimeEntry), "..", ".."));
}

/**
 * Core's middleware runtime reaches `node:stream` only to convert a Node request, which the edge
 * runner never receives (it is handed a web Request). Vercel's Edge runtime has no `node:stream`,
 * so core's import gets a stub that fails loudly if anything ever calls it. The app's own code
 * gets no stub: a Node module the Edge runtime lacks stops the build.
 */
function edgeNodeModulesPlugin(coreDir: string, unsupported: Set<string>): Plugin {
  const streamStub = "\0farm-edge-node-stream";
  const corePrefix = coreDir + path.sep;
  return {
    name: "farm-vercel-edge-node-modules",
    resolveId(source, importer) {
      if (!isBuiltin(source)) return null;
      const name = source.replace(/^node:/, "").split("/")[0]!;
      if (EDGE_NODE_MODULES.has(name)) return { id: `node:${name}`, external: true };
      if (name === "stream" && importer && path.resolve(importer).startsWith(corePrefix)) {
        return streamStub;
      }
      unsupported.add(`${source} (imported by ${importer ?? "the entry"})`);
      return { id: source, external: true };
    },
    load(id) {
      if (id !== streamStub) return null;
      return `export const Readable = { toWeb() { throw new Error("[Farm.js] Node streams are not available in Vercel edge middleware."); } };`;
    },
  };
}

/**
 * Bundle the edge middleware into `functions/_farm_middleware.func`, a Vercel Edge function.
 * A Node module the Edge runtime does not provide stops the build and names the import.
 */
export async function writeFarmVercelEdgeMiddlewareFunction(options: {
  root: string;
  outputDir: string;
  buildDir: string;
  config: ResolvedFarmConfig;
  routes: readonly FarmEdgeMiddlewareRoute[];
  fs: typeof import("fs/promises");
}): Promise<void> {
  const { root, outputDir, buildDir, config, routes, fs } = options;
  const functionDir = path.join(
    outputDir,
    "functions",
    `${FARM_VERCEL_EDGE_MIDDLEWARE_FUNCTION}.func`,
  );
  // The entry sits inside the project so `@farm.js/core` resolves from the app's own install.
  const entryPath = path.join(buildDir, "vercel-edge-middleware-entry.mjs");
  await fs.mkdir(path.dirname(entryPath), { recursive: true });
  await fs.writeFile(entryPath, generateFarmVercelEdgeMiddlewareEntry(routes, config));

  const unsupported = new Set<string>();
  const coreDir = await resolveFarmCoreDir(root, fs);
  const { rolldown } = await import("rolldown");
  let code: string;
  try {
    const bundle = await rolldown({
      cwd: root,
      input: entryPath,
      platform: "browser",
      logLevel: "silent",
      plugins: [edgeNodeModulesPlugin(coreDir, unsupported)],
      resolve: {
        alias: createFarmSourceAlias(root, config.srcDir),
        conditionNames: ["edge-light", "worker", "browser", "import", "module", "default"],
      },
      transform: {
        target: "es2022",
        define: { "process.env.NODE_ENV": JSON.stringify("production") },
      },
    });
    try {
      const { output } = await bundle.generate({
        format: "esm",
        codeSplitting: false,
        minify: true,
      });
      code = output[0].code;
    } finally {
      await bundle.close();
    }
  } catch (error) {
    throw withPlainDiagnostics(error);
  } finally {
    await fs.rm(entryPath, { force: true });
  }

  if (unsupported.size > 0) {
    throw new Error(
      `[Farm.js] runtime: "edge" middleware runs in Vercel's Edge runtime, which does not provide these Node modules:\n` +
        [...unsupported].map((entry) => `  - ${entry}`).join("\n") +
        `\nRemove them from the middleware (Edge provides ${[...EDGE_NODE_MODULES].join(", ")}), or remove runtime: "edge" so the middleware runs in the server and its pages render on request.`,
    );
  }

  await fs.rm(functionDir, { recursive: true, force: true });
  await fs.mkdir(functionDir, { recursive: true });
  await fs.writeFile(path.join(functionDir, "index.js"), code);
  await fs.writeFile(
    path.join(functionDir, ".vc-config.json"),
    `${JSON.stringify({ runtime: "edge", entrypoint: "index.js" }, null, 2)}\n`,
  );

  const gzippedBytes = gzipSync(code).length;
  if (gzippedBytes > EDGE_FUNCTION_SIZE_WARNING_BYTES) {
    logger.warn(
      `Vercel edge middleware is ${(gzippedBytes / 1024 / 1024).toFixed(2)} MB gzipped, over the Hobby plan's 1 MB Edge function limit (Pro allows 2 MB, Enterprise 4 MB).`,
    );
  }
  logger.info(
    `🛡️  Vercel edge middleware: ${routes.length} middleware file(s) guard their prerendered pages before the CDN serves them`,
  );
}
