import {
  farmRouteRuleMatches,
  getFarmSourceRoots,
  getFarmPresetRuntime,
  isProgrammaticRoutesFileName,
  loadConfig,
  mergeFarmRouteRuntimeConfigs,
  resolveConfig,
  resolveFarmRouteRuleRuntimeConfig,
  resolveFarmRouteRuntimeConfig,
  resolveRouteRenderingConfig,
  scanProgrammaticPagePaths,
  type FarmRouteRule,
  type FarmRouteRuntimeConfig,
} from "@farm.js/core";
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";
import pc from "picocolors";

const ROUTE_EXTENSIONS = ["tsx", "ts", "jsx", "js", "vue", "mdx", "md"] as const;
const MIDDLEWARE_EXTENSIONS = ["ts", "tsx", "js", "jsx", "mjs", "cjs"] as const;
const SOCIAL_IMAGE_EXTENSIONS = [
  "tsx",
  "ts",
  "jsx",
  "js",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
] as const;

export interface ExplainFarmRouteOptions {
  root?: string;
  configPath?: string;
}

export interface FarmRouteExplanation {
  pathname: string;
  pattern: string;
  params: Record<string, string | string[]>;
  filePath: string;
  source: string;
  layouts: string[];
  middleware: Array<{ source: "file" | "config"; filePath: string }>;
  runtime: {
    runtime: "auto" | "node" | "edge";
    regions?: string[];
    maxDuration?: number;
  };
  rendering: {
    mode: "static" | "partial" | "dynamic" | "client";
    reason: string;
    ppr: boolean;
  };
  cache: {
    revalidate?: number | false;
    swr?: number | boolean;
    isr?: number | boolean;
    rules: string[];
  };
  metadata: {
    static: string[];
    dynamic: string[];
    openGraphImage?: string;
    twitterImage?: string;
  };
  deployment: {
    target: string;
    preset: string;
    runtime: "node" | "edge" | "unknown";
    compatible: boolean;
    warnings: string[];
  };
}

type PageCandidate = {
  filePath: string;
  pattern: string;
  params: Record<string, string | string[]>;
  source: string;
  priority: number;
  score: number;
};

type LayeredRouteFile = {
  filePath: string;
  pattern: string;
};

export async function explainFarmRoute(
  pathname: string,
  options: ExplainFarmRouteOptions = {},
): Promise<FarmRouteExplanation> {
  const root = path.resolve(options.root || process.cwd());
  const userConfig = await loadConfig(root, options.configPath, "production");
  const config = await resolveConfig({ root, ...userConfig }, "production");
  const normalizedPathname = normalizePathname(pathname, config.basePath || "/");
  const candidates = discoverMatchingPages(config, normalizedPathname);
  const page = candidates.sort(
    (left, right) => right.score - left.score || right.priority - left.priority,
  )[0];

  if (!page) {
    throw new Error(`No Farm page route matches ${normalizedPathname}.`);
  }

  const layouts = collectInheritedRouteFiles(
    config,
    normalizedPathname,
    "layout",
    ROUTE_EXTENSIONS,
  );
  const middleware = collectMiddleware(
    root,
    Boolean(userConfig?.middleware && Object.keys(userConfig.middleware).length),
    config,
    normalizedPathname,
  );
  const pageSource = readFileSync(page.filePath, "utf8");
  const layoutSources = layouts.map((filePath) => ({
    filePath,
    source: readFileSync(filePath, "utf8"),
  }));
  const runtime = resolveFarmRouteRuntimeConfig(
    mergeFarmRouteRuntimeConfigs(
      resolveFarmRouteRuleRuntimeConfig(normalizedPathname, config.routeRules),
      ...layoutSources.map(({ source }) => readRuntimeExports(source)),
      readRuntimeExports(pageSource),
    ),
    `Route ${page.pattern}`,
  );
  const matchingRules = Object.entries(config.routeRules)
    .filter(([pattern]) => farmRouteRuleMatches(pattern, normalizedPathname))
    .sort(([left], [right]) => routeSpecificity(left) - routeSpecificity(right));
  const rendering = resolveRendering(pageSource, matchingRules);
  const cache = resolveCaching(pageSource, matchingRules);
  const metadataSources = [...layoutSources, { filePath: page.filePath, source: pageSource }];
  const openGraphImage = findNearestSocialImage(config, normalizedPathname, "opengraph-image");
  const twitterImage = findNearestSocialImage(config, normalizedPathname, "twitter-image");
  const preset = String(config.deploy.preset || config.preset || "node-server");
  const presetRuntime = getFarmPresetRuntime(preset);
  const compatible =
    rendering.mode === "static" ||
    rendering.mode === "client" ||
    runtime.runtime === "auto" ||
    (presetRuntime !== "unknown" && runtime.runtime === presetRuntime);
  const warnings: string[] = [];
  if (presetRuntime === "unknown" && runtime.runtime !== "auto") {
    warnings.push(
      `Farm cannot verify the ${runtime.runtime} route requirement because the ${preset} preset runtime is unknown.`,
    );
  } else if (!compatible) {
    warnings.push(
      `The route requires ${runtime.runtime}, but the ${preset} preset emits ${presetRuntime} functions.`,
    );
  }
  if (runtime.regions?.length && preset !== "vercel" && preset !== "vercel-edge") {
    warnings.push(`${preset} does not map Farm per-route region hints.`);
  }
  if (runtime.maxDuration && preset !== "vercel") {
    warnings.push(`${preset} does not map Farm per-route maxDuration.`);
  }

  return {
    pathname: normalizedPathname,
    pattern: page.pattern,
    params: page.params,
    filePath: toProjectPath(root, page.filePath),
    source: page.source,
    layouts: layouts.map((filePath) => toProjectPath(root, filePath)),
    middleware,
    runtime,
    rendering,
    cache,
    metadata: {
      static: metadataSources
        .filter(({ source }) => /export\s+const\s+metadata\b/.test(source))
        .map(({ filePath }) => toProjectPath(root, filePath)),
      dynamic: metadataSources
        .filter(({ source }) =>
          /export\s+(?:async\s+)?function\s+generateMetadata\b|export\s+const\s+generateMetadata\b/.test(
            source,
          ),
        )
        .map(({ filePath }) => toProjectPath(root, filePath)),
      ...(openGraphImage ? { openGraphImage: toProjectPath(root, openGraphImage) } : {}),
      ...(twitterImage ? { twitterImage: toProjectPath(root, twitterImage) } : {}),
    },
    deployment: {
      target: String(config.deploy.target || "node"),
      preset,
      runtime: presetRuntime,
      compatible,
      warnings,
    },
  };
}

export function formatFarmRouteExplanation(
  explanation: FarmRouteExplanation,
  options: { color?: boolean } = {},
): string {
  const color = options.color === undefined ? pc : pc.createColors(options.color);
  const lines = [
    color.bold("FARM / EXPLAIN"),
    "",
    `${color.bold("Path")}       ${explanation.pathname}`,
    `${color.bold("Pattern")}    ${explanation.pattern}`,
    `${color.bold("File")}       ${explanation.filePath}`,
    `${color.bold("Source")}     ${explanation.source}`,
    `${color.bold("Params")}     ${formatParams(explanation.params)}`,
    `${color.bold("Layouts")}    ${explanation.layouts.length ? explanation.layouts.join(" -> ") : "none"}`,
    `${color.bold("Middleware")} ${explanation.middleware.length ? explanation.middleware.map((entry) => entry.filePath).join(", ") : "none"}`,
    `${color.bold("Runtime")}    ${formatRuntime(explanation.runtime)}`,
    `${color.bold("Rendering")}  ${explanation.rendering.mode} (${explanation.rendering.reason})${explanation.rendering.ppr ? ", PPR" : ""}`,
    `${color.bold("Caching")}    ${formatCaching(explanation.cache)}`,
    `${color.bold("Metadata")}   ${formatMetadata(explanation.metadata)}`,
    `${color.bold("Deployment")} ${explanation.deployment.target} / ${explanation.deployment.preset} — ${explanation.deployment.compatible ? color.green("compatible") : color.red("incompatible")}`,
  ];
  for (const warning of explanation.deployment.warnings)
    lines.push(`  ${color.yellow("!")} ${warning}`);
  return lines.join("\n");
}

function discoverMatchingPages(
  config: Awaited<ReturnType<typeof resolveConfig>>,
  pathname: string,
) {
  const candidates: PageCandidate[] = [];
  for (const [priority, source] of getFarmSourceRoots(config).entries()) {
    const appDirectory = path.join(source.root, source.srcDir, "app");
    if (existsSync(appDirectory)) {
      for (const filePath of walkFiles(appDirectory)) {
        if (!/^page\.(?:tsx?|jsx?|vue|svelte|mdx?)$/.test(path.basename(filePath))) continue;
        const relativeDirectory = path.relative(appDirectory, path.dirname(filePath));
        if (
          relativeDirectory.split(path.sep).includes("api") ||
          isRouteSlotDirectory(relativeDirectory)
        ) {
          continue;
        }
        const pattern = directoryToRoutePattern(relativeDirectory);
        const match = matchRoutePattern(pattern, pathname);
        if (!match) continue;
        candidates.push({
          filePath,
          pattern,
          params: match.params,
          score: match.score,
          source: source.name,
          priority,
        });
      }
    }

    const sourceDirectory = path.join(source.root, source.srcDir);
    if (!existsSync(sourceDirectory)) continue;
    for (const entry of readdirSync(sourceDirectory, { withFileTypes: true })) {
      if (
        (!entry.isFile() && !entry.isSymbolicLink()) ||
        !isProgrammaticRoutesFileName(entry.name)
      ) {
        continue;
      }
      const filePath = path.join(sourceDirectory, entry.name);
      const moduleSource = readFileSync(filePath, "utf8");
      for (const pattern of scanProgrammaticPagePaths(moduleSource)) {
        const match = matchRoutePattern(pattern, pathname);
        if (!match) continue;
        candidates.push({
          filePath,
          pattern,
          params: match.params,
          score: match.score,
          source: source.name,
          priority,
        });
      }
    }
  }
  return candidates;
}

function isRouteSlotDirectory(relativeDirectory: string): boolean {
  return relativeDirectory.split(path.sep).some((segment) => /^@[A-Za-z][\w-]*$/.test(segment));
}

function walkFiles(directory: string): string[] {
  const files: string[] = [];
  const pending = [directory];
  while (pending.length) {
    const current = pending.pop()!;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
        pending.push(entryPath);
        continue;
      }
      files.push(entryPath);
    }
  }
  return files;
}

function directoryToRoutePattern(relativeDirectory: string): string {
  const segments = relativeDirectory
    .split(path.sep)
    .filter(Boolean)
    .filter((segment) => !/^\(.+\)$/.test(segment) && !segment.startsWith("@"))
    .map((segment) => segment.replace(/^\(\.{1,3}\)/, ""));
  return segments.length ? `/${segments.join("/")}` : "/";
}

function matchRoutePattern(pattern: string, pathname: string) {
  const patternSegments = splitPath(pattern);
  const pathSegments = splitPath(pathname);
  const params: Record<string, string | string[]> = {};
  let score = 0;
  let pathIndex = 0;

  for (const segment of patternSegments) {
    const optionalCatchAll = segment.match(/^\[\[\.\.\.(.+)\]\]$/);
    if (optionalCatchAll) {
      params[optionalCatchAll[1]] = pathSegments.slice(pathIndex);
      pathIndex = pathSegments.length;
      score += 1;
      continue;
    }
    const catchAll = segment.match(/^\[\.\.\.(.+)\]$/);
    if (catchAll) {
      if (pathIndex >= pathSegments.length) return null;
      params[catchAll[1]] = pathSegments.slice(pathIndex);
      pathIndex = pathSegments.length;
      score += 10;
      continue;
    }
    const dynamic = segment.match(/^\[(.+)\]$/);
    if (dynamic) {
      if (pathIndex >= pathSegments.length) return null;
      params[dynamic[1]] = pathSegments[pathIndex++];
      score += 50;
      continue;
    }
    if (segment !== pathSegments[pathIndex++]) return null;
    score += 100;
  }

  return pathIndex === pathSegments.length ? { params, score } : null;
}

function collectInheritedRouteFiles(
  config: Awaited<ReturnType<typeof resolveConfig>>,
  pathname: string,
  baseName: string,
  extensions: readonly string[],
): string[] {
  return collectLayeredRouteFiles(config, baseName, extensions)
    .filter((entry) => matchesRoutePrefix(entry.pattern, pathname))
    .sort(compareInheritedRouteFiles)
    .map((entry) => entry.filePath);
}

function collectMiddleware(
  root: string,
  hasConfigMiddleware: boolean,
  config: Awaited<ReturnType<typeof resolveConfig>>,
  pathname: string,
): FarmRouteExplanation["middleware"] {
  const rootMiddleware = new Map<string, LayeredRouteFile>();
  for (const source of getFarmSourceRoots(config)) {
    const filePath = findFile(
      path.join(source.root, source.srcDir),
      "middleware",
      MIDDLEWARE_EXTENSIONS,
    );
    if (filePath) {
      rootMiddleware.set("root", {
        filePath,
        pattern: "/",
      });
    }
  }
  const files = [
    ...rootMiddleware.values(),
    ...collectLayeredRouteFiles(config, "middleware", MIDDLEWARE_EXTENSIONS).filter((entry) =>
      matchesRoutePrefix(entry.pattern, pathname),
    ),
  ]
    .sort(compareInheritedRouteFiles)
    .map((entry) => entry.filePath);
  return [
    ...(hasConfigMiddleware
      ? [{ source: "config" as const, filePath: "farm.config (middleware)" }]
      : []),
    ...files.map((filePath) => ({
      source: "file" as const,
      filePath: toProjectPath(root, filePath),
    })),
  ];
}

function collectLayeredRouteFiles(
  config: Awaited<ReturnType<typeof resolveConfig>>,
  baseName: string,
  extensions: readonly string[],
): LayeredRouteFile[] {
  const files = new Map<string, LayeredRouteFile>();
  const filePattern = new RegExp(
    `^${escapeRegExp(baseName)}\\.(?:${extensions.map(escapeRegExp).join("|")})$`,
  );

  for (const source of getFarmSourceRoots(config)) {
    const appDirectory = path.join(source.root, source.srcDir, "app");
    if (!existsSync(appDirectory)) continue;
    for (const filePath of walkFiles(appDirectory)) {
      if (!filePattern.test(path.basename(filePath))) continue;
      const relativeDirectory = path.relative(appDirectory, path.dirname(filePath));
      const pattern = directoryToRoutePattern(relativeDirectory);
      files.set(pattern, {
        filePath,
        pattern,
      });
    }
  }

  return [...files.values()];
}

function findNearestSocialImage(
  config: Awaited<ReturnType<typeof resolveConfig>>,
  pathname: string,
  baseName: string,
) {
  return collectLayeredRouteFiles(config, baseName, SOCIAL_IMAGE_EXTENSIONS)
    .filter((entry) => matchesRoutePrefix(entry.pattern, pathname))
    .sort((left, right) => compareInheritedRouteFiles(right, left))[0]?.filePath;
}

function compareInheritedRouteFiles(left: LayeredRouteFile, right: LayeredRouteFile): number {
  return splitPath(left.pattern).length - splitPath(right.pattern).length;
}

function matchesRoutePrefix(pattern: string, pathname: string): boolean {
  const patternSegments = splitPath(pattern);
  const pathSegments = splitPath(pathname);
  if (patternSegments.length > pathSegments.length) return false;

  return patternSegments.every((segment, index) => {
    if (/^\[{1,2}(?:\.\.\.)?.+\]{1,2}$/.test(segment)) return true;
    return segment === pathSegments[index];
  });
}

function findFile(directory: string, baseName: string, extensions: readonly string[]) {
  return extensions
    .map((extension) => path.join(directory, `${baseName}.${extension}`))
    .find(existsSync);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readRuntimeExports(source: string): FarmRouteRuntimeConfig {
  const runtime = readStringExport(source, "runtime");
  const maxDuration = readNumberOrAutoExport(source, "maxDuration");
  const regions = readStringArrayOrAutoExport(source, "regions");
  return {
    ...(runtime === "auto" || runtime === "node" || runtime === "edge" ? { runtime } : {}),
    ...(regions ? { regions } : {}),
    ...(maxDuration !== undefined ? { maxDuration } : {}),
  };
}

function resolveRendering(
  pageSource: string,
  matchingRules: Array<[string, FarmRouteRule]>,
): FarmRouteExplanation["rendering"] {
  const pageRendering = resolveRouteRenderingConfig(
    {
      ...(readBooleanExport(pageSource, "ssg") !== undefined
        ? { ssg: readBooleanExport(pageSource, "ssg") }
        : {}),
      ...(readBooleanExport(pageSource, "ppr") !== undefined
        ? { ppr: readBooleanExport(pageSource, "ppr") }
        : {}),
      ...(readBooleanExport(pageSource, "experimental_ppr") !== undefined
        ? { experimental_ppr: readBooleanExport(pageSource, "experimental_ppr") }
        : {}),
      ...(readNumberOrFalseExport(pageSource, "revalidate") !== undefined
        ? { revalidate: readNumberOrFalseExport(pageSource, "revalidate") }
        : {}),
      ...(readDynamicExport(pageSource) ? { dynamic: readDynamicExport(pageSource) } : {}),
    },
    pageSource,
  );
  let mode: FarmRouteExplanation["rendering"]["mode"] = pageRendering.ssg
    ? "static"
    : pageRendering.ppr
      ? "partial"
      : "dynamic";
  let reason = pageRendering.directive
    ? `page directive ${JSON.stringify(pageRendering.directive)}`
    : pageRendering.ssg
      ? "page static rendering declaration"
      : pageRendering.ppr
        ? "page PPR declaration"
        : "default server rendering";
  let ppr = pageRendering.ppr;

  for (const [pattern, rule] of matchingRules) {
    if (rule.prerender === true || rule.render === "static") {
      mode = "static";
      reason = `routeRules ${pattern}`;
      ppr = false;
    } else if (rule.prerender === false || rule.render === "dynamic" || rule.ssr === true) {
      mode = "dynamic";
      reason = `routeRules ${pattern}`;
      ppr = false;
    } else if (rule.ssr === false) {
      mode = "client";
      reason = `routeRules ${pattern}`;
      ppr = false;
    }
  }
  return { mode, reason, ppr };
}

function resolveCaching(
  pageSource: string,
  matchingRules: Array<[string, FarmRouteRule]>,
): FarmRouteExplanation["cache"] {
  let swr: number | boolean | undefined;
  let isr: number | boolean | undefined;
  for (const [, rule] of matchingRules) {
    if (typeof rule.swr === "number" || typeof rule.swr === "boolean") swr = rule.swr;
    if (typeof rule.isr === "number" || typeof rule.isr === "boolean") isr = rule.isr;
  }
  return {
    ...(readNumberOrFalseExport(pageSource, "revalidate") !== undefined
      ? { revalidate: readNumberOrFalseExport(pageSource, "revalidate") }
      : {}),
    ...(swr !== undefined ? { swr } : {}),
    ...(isr !== undefined ? { isr } : {}),
    rules: matchingRules.map(([pattern]) => pattern),
  };
}

function readStringExport(source: string, name: string): string | undefined {
  return source.match(new RegExp(`export\\s+const\\s+${name}\\s*=\\s*["']([^"']+)["']`))?.[1];
}

function readDynamicExport(
  source: string,
): "auto" | "force-dynamic" | "error" | "force-static" | undefined {
  const dynamic = readStringExport(source, "dynamic");
  return dynamic === "auto" ||
    dynamic === "force-dynamic" ||
    dynamic === "error" ||
    dynamic === "force-static"
    ? dynamic
    : undefined;
}

function readBooleanExport(source: string, name: string): boolean | undefined {
  const value = source.match(new RegExp(`export\\s+const\\s+${name}\\s*=\\s*(true|false)`))?.[1];
  return value === undefined ? undefined : value === "true";
}

function readNumberOrAutoExport(source: string, name: string): number | "auto" | undefined {
  const value = source.match(
    new RegExp(`export\\s+const\\s+${name}\\s*=\\s*(?:["'](auto)["']|(\\d+))`),
  );
  return value?.[1] === "auto" ? "auto" : value?.[2] ? Number(value[2]) : undefined;
}

function readNumberOrFalseExport(source: string, name: string): number | false | undefined {
  const value = source.match(new RegExp(`export\\s+const\\s+${name}\\s*=\\s*(false|\\d+)`))?.[1];
  return value === "false" ? false : value ? Number(value) : undefined;
}

function readStringArrayOrAutoExport(source: string, name: string): "auto" | string[] | undefined {
  const auto = source.match(new RegExp(`export\\s+const\\s+${name}\\s*=\\s*["']auto["']`));
  if (auto) return "auto";
  const array = source.match(new RegExp(`export\\s+const\\s+${name}\\s*=\\s*\\[([^\\]]*)\\]`))?.[1];
  if (array === undefined) return undefined;
  return [...array.matchAll(/["']([^"']+)["']/g)].map((match) => match[1]);
}

function routeSpecificity(pattern: string): number {
  return splitPath(pattern).reduce((score, segment) => {
    if (segment === "**" || segment.startsWith("[[...")) return score + 1;
    if (segment === "*" || segment.startsWith("[...")) return score + 10;
    if (segment.startsWith("[") || segment.startsWith(":")) return score + 50;
    return score + 100;
  }, 0);
}

function normalizePathname(value: string, basePath: string): string {
  let pathname: string;
  try {
    pathname = new URL(value, "http://farm.local").pathname;
  } catch {
    pathname = value;
  }
  pathname = pathname.startsWith("/") ? pathname : `/${pathname}`;
  const normalizedBase =
    basePath && basePath !== "/" ? `/${basePath.replace(/^\/+|\/+$/g, "")}` : "";
  if (
    normalizedBase &&
    (pathname === normalizedBase || pathname.startsWith(`${normalizedBase}/`))
  ) {
    pathname = pathname.slice(normalizedBase.length) || "/";
  }
  return pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
}

function splitPath(value: string) {
  return value.split("/").filter(Boolean).map(decodeURIComponent);
}

function toProjectPath(root: string, filePath: string) {
  let relativePath = path.relative(root, filePath);
  if (
    (relativePath === ".." || relativePath.startsWith(`..${path.sep}`)) &&
    existsSync(root) &&
    existsSync(filePath)
  ) {
    relativePath = path.relative(realpathSync(root), realpathSync(filePath));
  }
  return relativePath.split(path.sep).join("/");
}

function formatParams(params: FarmRouteExplanation["params"]) {
  const entries = Object.entries(params);
  return entries.length
    ? entries
        .map(([key, value]) => `${key}=${Array.isArray(value) ? value.join("/") : value}`)
        .join(", ")
    : "none";
}

function formatRuntime(runtime: FarmRouteExplanation["runtime"]) {
  return [
    runtime.runtime,
    runtime.regions?.length ? `regions=${runtime.regions.join(",")}` : "",
    runtime.maxDuration ? `maxDuration=${runtime.maxDuration}s` : "",
  ]
    .filter(Boolean)
    .join(", ");
}

function formatCaching(cache: FarmRouteExplanation["cache"]) {
  const values = [
    cache.revalidate !== undefined ? `revalidate=${cache.revalidate}` : "",
    cache.swr !== undefined ? `swr=${cache.swr}` : "",
    cache.isr !== undefined ? `isr=${cache.isr}` : "",
    cache.rules.length ? `rules=${cache.rules.join(",")}` : "",
  ].filter(Boolean);
  return values.length ? values.join("; ") : "request-time / no declared cache";
}

function formatMetadata(metadata: FarmRouteExplanation["metadata"]) {
  const values = [
    metadata.static.length ? `static=${metadata.static.join(",")}` : "",
    metadata.dynamic.length ? `dynamic=${metadata.dynamic.join(",")}` : "",
    metadata.openGraphImage ? `og=${metadata.openGraphImage}` : "",
    metadata.twitterImage ? `twitter=${metadata.twitterImage}` : "",
  ].filter(Boolean);
  return values.length ? values.join("; ") : "none";
}
