import fs from "node:fs";
import path from "node:path";
import type { FarmIslandStrategy } from "../island";
import {
  createFarmRendererHookError,
  readFarmRendererHydration,
  type FarmRenderer,
  type FarmRendererHydration,
} from "../renderer";

/**
 * A renderer's hydration settings, as the route scan records them for one app. Farm reads
 * hydration from each page and layout's source text before any compiler runs
 * (`client-component.ts`); this is what that reading consults for the levels the text can't hold:
 * the renderer's defaults, the rule `routes()` returned for the file, and the renderer's own syntax.
 * A renderer's `compile()` turns its own files into the code that reading sees.
 */
interface FarmRendererHydrationScope {
  renderer: Pick<FarmRenderer, "name" | "hydration" | "componentExtensions" | "compile">;
  /** The renderer's own extensions, lowercase: the files its `hydration.resolve()` reads. */
  extensions: ReadonlySet<string>;
  /** Each page and layout file the scan found, by real path. */
  routeModules: ReadonlyMap<string, { kind: "page" | "layout"; hydration: FarmRendererHydration }>;
}

// By the real path of each source root (the app's and its layers'), so two apps in one process
// (tests, a dev server next to a build) keep their own settings.
const scopes = new Map<string, FarmRendererHydrationScope>();

function realPath(file: string): string {
  try {
    return fs.realpathSync(file);
  } catch {
    return path.resolve(file);
  }
}

/**
 * Records what a route scan found for `roots`, replacing the last scan's record. A renderer with no
 * `hydration`, no `compile()`, and no route rule that sets any leaves nothing recorded, so the
 * reading stays as it was. Returns the reverse: forgetting the record if no later scan replaced it.
 */
export function setFarmRendererHydrationScope(
  roots: readonly string[],
  renderer: Pick<FarmRenderer, "name" | "hydration" | "componentExtensions" | "compile">,
  routeModules: ReadonlyArray<{
    modulePath: string;
    kind: "page" | "layout";
    hydration?: FarmRendererHydration;
  }>,
): () => void {
  const keys = roots.map(realPath);
  const ruleSetsHydration = routeModules.some(
    (entry) => entry.hydration?.hydrate !== undefined || entry.hydration?.strategy !== undefined,
  );
  if (!renderer?.hydration && !renderer?.compile && !ruleSetsHydration) {
    for (const key of keys) scopes.delete(key);
    return () => {};
  }
  const scope: FarmRendererHydrationScope = {
    renderer,
    extensions: new Set((renderer.componentExtensions ?? []).map(normalizeExtension)),
    routeModules: new Map(
      routeModules.map((entry) => [
        realPath(entry.modulePath),
        { kind: entry.kind, hydration: entry.hydration ?? {} },
      ]),
    ),
  };
  for (const key of keys) scopes.set(key, scope);
  return () => {
    for (const key of keys) if (scopes.get(key) === scope) scopes.delete(key);
  };
}

function normalizeExtension(extension: string): string {
  const lowered = extension.trim().toLowerCase();
  return lowered.startsWith(".") ? lowered : `.${lowered}`;
}

function findScope(file: string): FarmRendererHydrationScope | null {
  if (scopes.size === 0) return null;
  let match: { length: number; scope: FarmRendererHydrationScope } | null = null;
  for (const [root, scope] of scopes) {
    if (file !== root && !file.startsWith(`${root}${path.sep}`)) continue;
    if (!match || root.length > match.length) match = { length: root.length, scope };
  }
  return match?.scope ?? null;
}

/** What a page or layout's source says about its hydration in Farm's own syntax. */
export interface FarmSourceHydration {
  /** `export const hydrate = <literal>`, or undefined when the file doesn't export it. */
  hydrate: boolean | undefined;
  /** `export const island = "<strategy>"`, or null. */
  strategy: FarmIslandStrategy | null;
  /** Whether the file starts with `"use client"`, which hydrates it whatever else it says. */
  clientDirective: boolean;
}

/**
 * A page or layout's hydration once the renderer's levels apply, or null when no renderer setting
 * covers the file (Farm's own reading stands). The file's own settings win, then its route rule,
 * then the renderer's defaults.
 */
export function resolveFarmRendererModuleHydration(
  content: string,
  sourcePath: string,
  readSource: () => FarmSourceHydration,
): { hydrate: boolean; strategy: FarmIslandStrategy | null } | null {
  if (scopes.size === 0) return null;
  const file = realPath(sourcePath);
  const scope = findScope(file);
  if (!scope) return null;
  const route = scope.routeModules.get(file);
  const options = scope.renderer.hydration;
  const own =
    options?.resolve && scope.extensions.has(path.extname(file).toLowerCase())
      ? readOwnHydration(scope, content, file)
      : {};
  if (!route && own.hydrate === undefined && own.strategy === undefined) return null;

  const source = readSource();
  const where = `${file} sets its hydration twice`;
  if (own.hydrate !== undefined && source.hydrate !== undefined && own.hydrate !== source.hydrate) {
    throw new Error(
      `${where}: \`export const hydrate = ${source.hydrate}\` and renderer \`${scope.renderer.name}\`'s syntax, which says ${own.hydrate}. Keep one of them.`,
    );
  }
  if (own.strategy !== undefined && source.strategy !== null && own.strategy !== source.strategy) {
    throw new Error(
      `${where}: \`export const island = "${source.strategy}"\` and renderer \`${scope.renderer.name}\`'s syntax, which says "${own.strategy}". Keep one of them.`,
    );
  }

  const kindDefault =
    route?.kind === "page"
      ? options?.pages
      : route?.kind === "layout"
        ? options?.layouts
        : undefined;
  const hydrate = own.hydrate ?? source.hydrate ?? route?.hydration.hydrate ?? kindDefault ?? false;
  const strategy =
    own.strategy ??
    source.strategy ??
    route?.hydration.strategy ??
    ((hydrate || source.clientDirective) && route ? options?.strategy : undefined) ??
    null;
  return { hydrate, strategy };
}

function readOwnHydration(
  scope: FarmRendererHydrationScope,
  content: string,
  file: string,
): FarmRendererHydration {
  const where = `Renderer \`${scope.renderer.name}\` hydration.resolve() for ${file}`;
  let value: unknown;
  try {
    value = scope.renderer.hydration!.resolve!(content, file);
  } catch (error) {
    throw createFarmRendererHookError(
      `${where} threw: ${error instanceof Error ? error.message : String(error)}`,
      error,
    );
  }
  if (value === null || value === undefined) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(
      `${where} returned ${JSON.stringify(value)}. Return \`{ hydrate?, strategy? }\`, or nothing to leave the file to Farm.`,
    );
  }
  return readFarmRendererHydration(value as Record<string, unknown>, where);
}

/**
 * Whether a renderer's `compile()` may apply to `file`, by its extension alone: a quick check
 * before the source reading looks the file's scope up.
 */
export function mayCompileFarmRendererSource(file: string): boolean {
  if (scopes.size === 0) return false;
  const extension = path.extname(file).toLowerCase();
  for (const scope of scopes.values()) {
    if (scope.renderer.compile && scope.extensions.has(extension)) return true;
  }
  return false;
}

/**
 * A file's code as Farm's source reading sees it: for a file with one of the renderer's own
 * extensions, the module its `compile()` returns; otherwise the source as it is.
 */
export function compileFarmRendererSource(content: string, sourcePath: string): string {
  if (scopes.size === 0) return content;
  const file = realPath(sourcePath);
  const scope = findScope(file);
  const compile = scope?.renderer.compile;
  if (!scope || !compile || !scope.extensions.has(path.extname(file).toLowerCase())) {
    return content;
  }
  const where = `Renderer \`${scope.renderer.name}\` compile() for ${file}`;
  let value: unknown;
  try {
    value = compile.call(scope.renderer, content, file);
  } catch (error) {
    throw createFarmRendererHookError(
      `${where} threw: ${error instanceof Error ? error.message : String(error)}`,
      error,
    );
  }
  if (typeof value !== "string") {
    throw new TypeError(
      `${where} returned ${value === null ? "null" : typeof value}. Return the module the file compiles to, as JavaScript or TSX source.`,
    );
  }
  return value;
}
