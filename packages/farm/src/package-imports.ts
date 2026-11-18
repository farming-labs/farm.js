/**
 * Package import optimization: in the server environments, `import { Zap } from "lucide-react"`
 * becomes an import of the one module the package's entry re-exports `Zap` from, so loading the
 * page no longer loads the whole barrel. In a React Server Components app every package that
 * depends on React runs through Vite's module runner, where a barrel such as lucide-react's (4,800
 * icon modules) costs seconds on the first request of `farm dev` and is parsed again by every
 * production build. The browser keeps the pre-bundled package. Next.js optimizes the same packages
 * by default (`experimental.optimizePackageImports`).
 *
 * Only packages whose entry is an ES module barrel qualify: every export must be a re-export, or
 * the package must declare `sideEffects: false`, so skipping the barrel changes nothing. A package
 * whose entry resolves through a condition that differs between environments (`browser`,
 * `react-server`, `node`, ...) is left alone, because the deep file could then differ from the
 * module Vite would have loaded.
 */
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";

/** Packages optimized by default: the list Next.js ships, which Farm apps share. */
export const FARM_OPTIMIZED_PACKAGE_IMPORTS: readonly string[] = [
  "lucide-react",
  "date-fns",
  "lodash-es",
  "ramda",
  "antd",
  "react-bootstrap",
  "ahooks",
  "@ant-design/icons",
  "@headlessui/react",
  "@headlessui-float/react",
  "@heroicons/react/20/solid",
  "@heroicons/react/24/solid",
  "@heroicons/react/24/outline",
  "@visx/visx",
  "@tremor/react",
  "rxjs",
  "@mui/material",
  "@mui/icons-material",
  "recharts",
  "react-use",
  "effect",
  "@effect/schema",
  "@effect/platform",
  "@effect/platform-node",
  "@effect/platform-browser",
  "@effect/platform-bun",
  "@effect/sql",
  "@effect/rpc",
  "@effect/typeclass",
  "@effect/experimental",
  "@effect/opentelemetry",
  "@material-ui/core",
  "@material-ui/icons",
  "@tabler/icons-react",
  "mui-core",
  ...[
    "ai",
    "bi",
    "bs",
    "cg",
    "ci",
    "di",
    "fa",
    "fa6",
    "fc",
    "fi",
    "gi",
    "go",
    "gr",
    "hi",
    "hi2",
    "im",
    "io",
    "io5",
    "lia",
    "lib",
    "lu",
    "md",
    "pi",
    "ri",
    "rx",
    "si",
    "sl",
    "tb",
    "tfi",
    "ti",
    "vsc",
    "wi",
  ].map((set) => `react-icons/${set}`),
];

/** Where a barrel export lives: the module file and the name exported there (`default`, `*`, or a binding). */
export interface FarmBarrelBinding {
  file: string;
  name: string;
}

export type FarmPackageBarrel = ReadonlyMap<string, FarmBarrelBinding>;

/** Export conditions under which the entry Vite loads can differ from the `module`/`import` one. */
const AMBIGUOUS_CONDITIONS = new Set([
  "node",
  "browser",
  "react-server",
  "react-native",
  "workerd",
  "worker",
  "edge-light",
  "deno",
  "bun",
]);
const ENTRY_CONDITIONS = new Set(["module", "import", "default"]);
const RESOLVE_EXTENSIONS = [".mjs", ".js", ".cjs"];

function pickEntry(value: unknown): string | null | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return pickEntry(value[0]);
  if (!value || typeof value !== "object") return undefined;
  // Conditions resolve in object order: the first key an environment knows wins. A condition
  // that only some environments know, before the one all of them share, makes the entry ambiguous.
  for (const [key, target] of Object.entries(value as Record<string, unknown>)) {
    if (ENTRY_CONDITIONS.has(key)) return pickEntry(target);
    if (AMBIGUOUS_CONDITIONS.has(key)) return null;
  }
  return undefined;
}

/** The ES module entry of a package, or null when it has none Farm can optimize. */
export function resolveFarmPackageEntry(
  packageDir: string,
  manifest: { type?: unknown; module?: unknown; main?: unknown; exports?: unknown },
): string | null {
  let entry: string | null | undefined;
  const { exports } = manifest;
  if (exports !== undefined) {
    const isSubpathMap =
      exports &&
      typeof exports === "object" &&
      !Array.isArray(exports) &&
      Object.keys(exports as object).every((key) => key.startsWith("."));
    entry = pickEntry(isSubpathMap ? (exports as Record<string, unknown>)["."] : exports);
  }
  if (entry === null) return null;
  if (entry === undefined) {
    entry =
      typeof manifest.module === "string"
        ? manifest.module
        : typeof manifest.main === "string"
          ? manifest.main
          : undefined;
  }
  if (!entry) return null;
  const file = resolveRelative(path.resolve(packageDir, entry));
  if (!file) return null;
  const esm =
    file.endsWith(".mjs") ||
    (file.endsWith(".js") && (manifest.type === "module" || typeof manifest.module === "string"));
  return esm ? file : null;
}

function resolveRelative(target: string): string | null {
  const candidates = [
    target,
    ...RESOLVE_EXTENSIONS.map((ext) => target + ext),
    ...RESOLVE_EXTENSIONS.map((ext) => path.join(target, `index${ext}`)),
  ];
  for (const candidate of candidates) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {}
  }
  return null;
}

const stripComments = (code: string) =>
  code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

const IMPORT_RE =
  /\bimport\s+(?:(\*\s+as\s+(\w+))|(\w+)|\{([^}]*)\})?\s*(?:,\s*\{([^}]*)\})?\s*from\s*["']([^"']+)["']/g;
const EXPORT_FROM_RE =
  /\bexport\s+(?:(\*)(?:\s+as\s+(\w+))?|\{([^}]*)\})\s*from\s*["']([^"']+)["']/g;
const EXPORT_LOCAL_RE = /\bexport\s+\{([^}]*)\}\s*(?!from)/g;
const EXPORT_DECLARATION_RE =
  /\bexport\s+(?:default\b|(?:async\s+)?function\b|class\b|const\b|let\b|var\b|enum\b)/;

function specifiers(list: string): Array<{ imported: string; local: string }> {
  return list
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith("type "))
    .map((s) => {
      const [imported, local] = s.split(/\s+as\s+/).map((p) => p.trim());
      return { imported, local: local ?? imported };
    });
}

/**
 * The re-export map of a barrel file: export name to the module and name it comes from, following
 * `export * from` one level at a time. `pure` is false when the file exports something it declares
 * itself, which a package without `sideEffects: false` may rely on being evaluated.
 */
export function readFarmBarrel(
  file: string,
  depth = 0,
  seen = new Set<string>(),
): { map: Map<string, FarmBarrelBinding>; pure: boolean } {
  const map = new Map<string, FarmBarrelBinding>();
  let pure = true;
  if (seen.has(file) || depth > 4) return { map, pure };
  seen.add(file);
  let code: string;
  try {
    code = stripComments(readFileSync(file, "utf8"));
  } catch {
    return { map, pure: false };
  }
  const dir = path.dirname(file);
  const resolve = (spec: string) =>
    spec.startsWith(".") ? resolveRelative(path.resolve(dir, spec)) : null;
  const locals = new Map<string, FarmBarrelBinding>();
  for (const m of code.matchAll(IMPORT_RE)) {
    const target = resolve(m[6]);
    if (!target) continue;
    if (m[2]) locals.set(m[2], { file: target, name: "*" });
    if (m[3]) locals.set(m[3], { file: target, name: "default" });
    for (const list of [m[4], m[5]]) {
      if (list)
        for (const s of specifiers(list)) locals.set(s.local, { file: target, name: s.imported });
    }
  }
  for (const m of code.matchAll(EXPORT_FROM_RE)) {
    const target = resolve(m[4]);
    if (!target) {
      pure = false;
      continue;
    }
    if (m[1] && m[2]) {
      map.set(m[2], { file: target, name: "*" });
    } else if (m[1]) {
      const nested = readFarmBarrel(target, depth + 1, seen);
      if (!nested.pure) pure = false;
      for (const [name, binding] of nested.map) if (!map.has(name)) map.set(name, binding);
    } else {
      for (const s of specifiers(m[3])) map.set(s.local, { file: target, name: s.imported });
    }
  }
  for (const m of code.matchAll(EXPORT_LOCAL_RE)) {
    for (const s of specifiers(m[1])) {
      const binding = locals.get(s.imported);
      if (binding) map.set(s.local, binding);
      else pure = false;
    }
  }
  if (EXPORT_DECLARATION_RE.test(code)) pure = false;
  return { map, pure };
}

/** The installed package's directory, as the app resolves it: the nearest node_modules above root. */
function findPackageDir(root: string, packageName: string): string | undefined {
  for (let dir = path.resolve(root); ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, "node_modules", packageName);
    if (existsSync(path.join(candidate, "package.json"))) return realpathSync(candidate);
    if (path.dirname(dir) === dir) return undefined;
  }
}

/** The barrel of an installed package, or null when its imports should stay as written. */
export function readFarmPackageBarrel(root: string, packageName: string): FarmPackageBarrel | null {
  const dir = findPackageDir(root, packageName);
  if (!dir) return null;
  let manifest: {
    type?: unknown;
    module?: unknown;
    main?: unknown;
    exports?: unknown;
    sideEffects?: unknown;
  };
  try {
    manifest = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
  } catch {
    return null;
  }
  const entry = resolveFarmPackageEntry(dir, manifest);
  if (!entry) return null;
  const { map, pure } = readFarmBarrel(entry);
  if (map.size === 0) return null;
  if (!pure && manifest.sideEffects !== false) return null;
  return map;
}

const NAMED_IMPORT_RE = /\bimport\s*\{([^}]*)\}\s*from\s*(["'])([^"']+)\2\s*;?/g;

const toImportPath = (file: string) => file.split(path.sep).join("/");

function importStatement(binding: FarmBarrelBinding, local: string): string {
  const from = JSON.stringify(toImportPath(binding.file));
  if (binding.name === "default") return `import ${local} from ${from};`;
  if (binding.name === "*") return `import * as ${local} from ${from};`;
  return `import { ${binding.name === local ? local : `${binding.name} as ${local}`} } from ${from};`;
}

/**
 * Rewrites the named imports of `packages` in `code` to imports of the modules their barrels
 * re-export. Imports the barrel cannot be followed for stay on the package.
 */
export function rewriteFarmPackageImports(
  code: string,
  packages: ReadonlySet<string>,
  barrel: (packageName: string) => FarmPackageBarrel | null,
): string | null {
  let changed = false;
  const out = code.replace(
    NAMED_IMPORT_RE,
    (statement, list: string, _quote, specifier: string) => {
      if (!packages.has(specifier)) return statement;
      const map = barrel(specifier);
      if (!map) return statement;
      const kept: string[] = [];
      const deep: string[] = [];
      for (const s of specifiers(list)) {
        const binding = map.get(s.imported);
        if (binding) deep.push(importStatement(binding, s.local));
        else kept.push(s.imported === s.local ? s.imported : `${s.imported} as ${s.local}`);
      }
      if (deep.length === 0) return statement;
      changed = true;
      return [
        ...deep,
        ...(kept.length
          ? [`import { ${kept.join(", ")} } from ${JSON.stringify(specifier)};`]
          : []),
      ].join(" ");
    },
  );
  return changed ? out : null;
}

/**
 * The packages to optimize for an app: Farm's defaults plus `experimental.optimizePackageImports`,
 * or none when that is `false`.
 */
export function resolveFarmOptimizedPackageImports(
  option: string[] | false | undefined,
): Set<string> {
  if (option === false) return new Set();
  return new Set([...FARM_OPTIMIZED_PACKAGE_IMPORTS, ...(option ?? [])]);
}

const SOURCE_RE = /\.(?:[cm]?[jt]sx?)$/;

/** The Vite plugin: app modules import the deep modules of optimized packages. */
export function farmPackageImportsPlugin(options: {
  root: string;
  packages: ReadonlySet<string>;
}): Plugin {
  const barrels = new Map<string, FarmPackageBarrel | null>();
  const barrel = (packageName: string) => {
    let entry = barrels.get(packageName);
    if (entry === undefined) {
      entry = readFarmPackageBarrel(options.root, packageName);
      barrels.set(packageName, entry);
    }
    return entry;
  };
  return {
    name: "farm:package-imports",
    transform(code, id) {
      if (options.packages.size === 0) return;
      // The browser gets these packages pre-bundled and tree-shaken already; a deep import there
      // would bypass the optimizer and load the package's own dependencies unbundled. The cost
      // the rewrite removes is in the server environments, where Vite evaluates the barrel.
      if (this.environment?.name === "client") return;
      const file = id.split("?")[0];
      if (file.includes("/node_modules/") || !SOURCE_RE.test(file)) return;
      if (!code.includes("import")) return;
      let mentions = false;
      for (const name of options.packages) {
        if (code.includes(name)) {
          mentions = true;
          break;
        }
      }
      if (!mentions) return;
      const rewritten = rewriteFarmPackageImports(code, options.packages, barrel);
      return rewritten === null ? undefined : { code: rewritten, map: null };
    },
  };
}
