import fs from "node:fs";
import path from "node:path";
import { inferStrategy } from "@farm.js/islx/compiler";
import { parseAst } from "rolldown/parseAst";
import type { FarmIslandStrategy } from "./island";
import { routeBoundaryCoversDirectory } from "./routing/route-groups";
import {
  collectFarmRenderedClientModules,
  getIslandStrategyExport,
  resolveImportedModule,
} from "./utils/client-component";

/**
 * Islands mode: the hydration an island gets when its module sets no `island` export (RFC 0003,
 * section 11). An island whose client code does nothing until it is clicked renders the same before
 * and after hydration, so it waits for an interaction: the click (or submit) is held and replayed
 * once it hydrates, and a press or focus starts hydrating it early. Anything the analysis cannot
 * prove keeps `"load"`: an effect, a ref, a handler other than a click or submit, a form field,
 * a spread onto an element, a class, a module that runs code as it loads, or an import from a
 * package other than React.
 */
export interface FarmIslandInference {
  /** `"interaction"` when the island can wait; null to keep `"load"`. */
  strategy: "interaction" | null;
  /** The source files the result depends on, the module itself included. */
  files: string[];
  /** Why the island keeps `"load"`, for diagnostics. */
  reason?: string;
  /** A route root only: a client module in it declares its own `island` strategy. */
  declared?: boolean;
}

const PARSE_LANGS = new Map([
  [".tsx", "tsx"],
  [".ts", "ts"],
  [".jsx", "jsx"],
  [".js", "jsx"],
  [".mjs", "js"],
]);

function parseFarmIslandSource(file: string, code: string) {
  const lang = PARSE_LANGS.get(path.extname(file));
  if (!lang) throw new Error(`${path.basename(file)} is not a script module`);
  return parseAst(code, { lang: lang as "tsx" }) as never;
}

function modifiedAt(file: string): number {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return -1;
  }
}

// Inferences by module, valid while none of the files they read changes.
const inferences = new Map<
  string,
  { stamps: Array<[string, number]>; result: FarmIslandInference }
>();

/**
 * Infers the hydration of the islands `filePath` exports (a `"use client"` module) with islx's
 * checks (`inferStrategy`), resolving the app's imports, aliases included, as Farm does.
 */
export function inferFarmIslandStrategy(filePath: string, root?: string): FarmIslandInference {
  const file = path.resolve(filePath);
  const cached = inferences.get(file);
  if (cached && cached.stamps.every(([read, stamp]) => modifiedAt(read) === stamp)) {
    return cached.result;
  }
  let code: string;
  try {
    code = fs.readFileSync(file, "utf8");
  } catch {
    return { strategy: null, files: [file], reason: `${path.basename(file)} could not be read` };
  }
  const result: FarmIslandInference = inferStrategy(file, code, {
    parse: parseFarmIslandSource,
    resolve: (specifier, importer) => {
      const resolved = resolveImportedModule(importer, specifier, root);
      return resolved.local ? resolved.path : null;
    },
  });
  inferences.set(file, {
    stamps: result.files.map((read) => [read, modifiedAt(read)]),
    result,
  });
  return result;
}

/**
 * Islands mode: whether a route that hydrates as one root (a layout around a client provider, or a
 * client page) can wait for an interaction. `owners` are the route modules inside that root, the
 * page and its layouts; every client component they render must be able to wait. Their server
 * output is the root's own, so the slot rule for islands does not apply.
 */
export function inferFarmRouteRootStrategy(owners: string[], root?: string): FarmIslandInference {
  const files: string[] = [];
  const modules: string[] = [];
  for (const owner of owners) {
    const rendered = collectFarmRenderedClientModules(owner, root);
    if (!rendered) {
      return {
        strategy: null,
        files,
        reason: `${path.basename(owner)}: its client components could not be listed`,
      };
    }
    modules.push(...rendered);
  }
  // A module that declares its strategy decides it, as it does for an island.
  for (const module of modules) {
    let source: string | null = null;
    try {
      source = fs.readFileSync(module, "utf8");
    } catch {}
    if (getIslandStrategyExport(source) !== null) return { strategy: null, files, declared: true };
  }
  for (const module of modules) {
    const result = inferFarmIslandStrategy(module, root);
    files.push(...result.files);
    if (!result.strategy) return { strategy: null, files, reason: result.reason };
  }
  return { strategy: "interaction", files };
}

/**
 * The hydration strategy of a route's root: the strategies its page and layouts declare, when they
 * agree. In islands mode, when none declares one, a route that hydrates as one root (its page is a
 * client component, or a layout on it hydrates, such as a client provider) waits for an
 * interaction when every client component inside that root can (RFC 0003, section 11). The client
 * route table, the server's choice of entry and `farm dev` all read this.
 */
export function resolveFarmRouteRootStrategy(
  route: { modulePath: string; pattern: string; directory?: string },
  page: { shouldHydrate: boolean; islandStrategy: FarmIslandStrategy | null },
  layouts: Array<{
    pattern: string;
    modulePath: string;
    shouldHydrate: boolean;
    hasIsolatedClientBoundaries: boolean;
    islandStrategy: FarmIslandStrategy | null;
  }>,
  root: string,
  islandsMode: boolean,
): FarmIslandStrategy {
  const directory = route.directory ?? route.pattern;
  const onRoute = layouts.filter((layout) =>
    routeBoundaryCoversDirectory(layout.pattern, directory),
  );
  const declared = [
    ...(page.islandStrategy ? [page.islandStrategy] : []),
    ...onRoute.flatMap((layout) =>
      (layout.shouldHydrate || layout.hasIsolatedClientBoundaries) && layout.islandStrategy
        ? [layout.islandStrategy]
        : [],
    ),
  ];
  // The plans report "load" for a hydrating module that declares nothing, so whether anything is
  // declared is read from the root's modules below.
  const combined = declared.every((strategy) => strategy === declared[0])
    ? (declared[0] ?? "load")
    : "load";
  const layoutHydrates = onRoute.some((layout) => layout.shouldHydrate);
  if (!islandsMode || (!page.shouldHydrate && !layoutHydrates)) return combined;
  // A hydrating layout's root holds the whole layout chain; a client page's root holds the page.
  const owners = [
    route.modulePath,
    ...(layoutHydrates ? onRoute.map((layout) => layout.modulePath) : []),
  ];
  const inference = inferFarmRouteRootStrategy(owners, root);
  if (inference.declared) return combined;
  return inference.strategy ?? "load";
}
