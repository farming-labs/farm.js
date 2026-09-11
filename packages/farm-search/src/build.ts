import { mkdir, readFile, readdir, realpath, rm } from "node:fs/promises";
import path from "node:path";
import * as pagefind from "pagefind";
import type { ResolvedSearchOptions } from "./config.js";

export interface SearchBuildInput {
  outputDir: string;
  publicDir?: string;
  preset: string;
  basePath: string;
  options: ResolvedSearchOptions;
}

export interface SearchBuildResult {
  bundlePath: string;
  outputPath: string;
  indexedRoutes: string[];
  skippedRoutes: string[];
}

export async function writeSearchIndex(input: SearchBuildInput): Promise<SearchBuildResult> {
  const publicDir = path.resolve(
    input.publicDir ?? resolveSearchPublicDir(input.outputDir, input.preset),
  );
  const basePath = normalizeBasePath(input.basePath);
  const bundlePath = withBasePath(`/${input.options.output}`, basePath);
  const outputPath = resolveOutputPath(publicDir, bundlePath);
  await assertOutputPathInside(publicDir, outputPath);
  const htmlFiles = await collectHtmlFiles(publicDir, outputPath);
  const routes = htmlFiles
    .map((file) => ({
      file,
      logicalRoute: stripBasePath(routeFromHtmlFile(path.relative(publicDir, file)), basePath),
    }))
    .sort((left, right) => left.logicalRoute.localeCompare(right.logicalRoute));
  const selected = routes.filter(({ logicalRoute }) =>
    shouldIndexRoute(logicalRoute, input.options),
  );
  const skippedRoutes = routes
    .filter(({ logicalRoute }) => !shouldIndexRoute(logicalRoute, input.options))
    .map(({ logicalRoute }) => withBasePath(logicalRoute, basePath));

  if (selected.length === 0) {
    throw new Error(
      "[farm:search] No static HTML pages matched the configured routes. " +
        "Mark searchable pages as static or update search include/exclude patterns.",
    );
  }

  const created = await pagefind.createIndex({
    ...(input.options.rootSelector ? { rootSelector: input.options.rootSelector } : {}),
    ...(input.options.excludeSelectors.length
      ? { excludeSelectors: input.options.excludeSelectors }
      : {}),
    ...(input.options.language ? { forceLanguage: input.options.language } : {}),
    ...(input.options.includeCharacters
      ? { includeCharacters: input.options.includeCharacters }
      : {}),
    keepIndexUrl: input.options.keepIndexUrl,
    verbose: input.options.verbose,
    writePlayground: false,
  });
  if (!created.index || created.errors.length) {
    await pagefind.close();
    throw pagefindError("could not create an index", created.errors);
  }

  const index = created.index;
  const indexedRoutes: string[] = [];
  try {
    for (const { file, logicalRoute } of selected) {
      const route = withBasePath(logicalRoute, basePath);
      const result = await index.addHTMLFile({
        url: route,
        content: await readFile(file, "utf8"),
      });
      if (result.errors.length) {
        throw pagefindError(`could not index ${route}`, result.errors);
      }
      indexedRoutes.push(route);
    }

    await rm(outputPath, { recursive: true, force: true });
    await mkdir(path.dirname(outputPath), { recursive: true });
    const written = await index.writeFiles({ outputPath });
    if (written.errors.length) throw pagefindError("could not write the index", written.errors);
  } finally {
    try {
      await index.deleteIndex();
    } finally {
      await pagefind.close();
    }
  }

  return {
    bundlePath: `${bundlePath}/`,
    outputPath,
    indexedRoutes,
    skippedRoutes,
  };
}

export function resolveSearchPublicDir(outputDir: string, preset: string): string {
  return path.join(
    outputDir,
    preset === "vercel" || preset === "vercel-edge" ? "static" : "public",
  );
}

export function normalizeBasePath(value: string | undefined): string {
  if (!value || value === "/") return "/";
  return `/${value.replace(/^\/+|\/+$/g, "")}`;
}

export function withBasePath(route: string, basePath: string): string {
  const normalizedBase = normalizeBasePath(basePath);
  const normalizedRoute = route === "/" ? "/" : `/${route.replace(/^\/+|\/+$/g, "")}`;
  if (normalizedBase === "/") return normalizedRoute;
  if (normalizedRoute === normalizedBase || normalizedRoute.startsWith(`${normalizedBase}/`)) {
    return normalizedRoute;
  }
  return normalizedRoute === "/" ? normalizedBase : `${normalizedBase}${normalizedRoute}`;
}

export function stripBasePath(route: string, basePath: string): string {
  const normalizedBase = normalizeBasePath(basePath);
  if (normalizedBase === "/") return route;
  if (route === normalizedBase) return "/";
  return route.startsWith(`${normalizedBase}/`) ? route.slice(normalizedBase.length) || "/" : route;
}

export function routeFromHtmlFile(file: string): string {
  const normalized = file.replace(/\\/g, "/").replace(/^\/+/, "");
  const withoutIndex = normalized.replace(/(?:^|\/)index\.html$/i, "");
  const route = withoutIndex ? withoutIndex.replace(/\.html$/i, "").replace(/^\/+|\/+$/g, "") : "";
  return route ? `/${route}` : "/";
}

export function matchesRoutePattern(route: string, pattern: string): boolean {
  if (pattern.endsWith("/**")) {
    const parent = pattern.slice(0, -3) || "/";
    return route === parent || route.startsWith(parent === "/" ? "/" : `${parent}/`);
  }
  let source = "";
  for (let index = 0; index < pattern.length; index++) {
    const character = pattern[index]!;
    if (character === "*" && pattern[index + 1] === "*") {
      source += ".*";
      index++;
    } else if (character === "*") {
      source += "[^/]*";
    } else if (character === "?") {
      source += "[^/]";
    } else {
      source += character.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
    }
  }
  return new RegExp(`^${source}/?$`).test(route);
}

function shouldIndexRoute(route: string, options: ResolvedSearchOptions): boolean {
  return (
    options.include.some((pattern) => matchesRoutePattern(route, pattern)) &&
    !options.exclude.some((pattern) => matchesRoutePattern(route, pattern))
  );
}

async function collectHtmlFiles(root: string, ignoredDirectory: string): Promise<string[]> {
  const files: string[] = [];
  const pending = [root];
  while (pending.length) {
    const directory = pending.pop()!;
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (absolute !== ignoredDirectory) pending.push(absolute);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".html")) {
        files.push(absolute);
      }
    }
  }
  return files.sort();
}

function resolveOutputPath(publicDir: string, bundlePath: string): string {
  const outputPath = path.resolve(publicDir, `.${bundlePath}`);
  const relative = path.relative(publicDir, outputPath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("[farm:search] Search output must stay inside the public output directory");
  }
  return outputPath;
}

async function assertOutputPathInside(publicDir: string, outputPath: string): Promise<void> {
  const realPublicDir = await realpath(publicDir);
  let existingAncestor = outputPath;

  while (true) {
    try {
      existingAncestor = await realpath(existingAncestor);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = path.dirname(existingAncestor);
      if (parent === existingAncestor) throw error;
      existingAncestor = parent;
    }
  }

  const relative = path.relative(realPublicDir, existingAncestor);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(
      "[farm:search] Search output must stay inside the public output directory, including through symlinks",
    );
  }
}

function pagefindError(action: string, errors: string[]): Error {
  const details = errors.length ? `:\n${errors.map((error) => `  - ${error}`).join("\n")}` : "";
  return new Error(`[farm:search] Pagefind ${action}${details}`);
}
