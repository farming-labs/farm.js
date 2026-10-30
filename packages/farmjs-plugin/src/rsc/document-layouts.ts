import { promises as fs } from "node:fs";
import path from "node:path";

const LAYOUT_FILE = /^layout\.(tsx|jsx|ts|js)$/;
const SOURCE_EXTENSIONS = [".tsx", ".ts", ".jsx", ".js"];
const RENDERS_HTML = /<html[\s>]/;
// `export { default } from "./x"` and `export { Layout as default } from "./x"`.
const DEFAULT_REEXPORT =
  /export\s*\{[^}]*\b(?:default|[\w$]+\s+as\s+default)\b[^}]*\}\s*from\s*["'](\.{1,2}\/[^"']+)["']/;

async function resolveRelativeModule(fromFile: string, specifier: string): Promise<string | null> {
  const base = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [
    base,
    ...SOURCE_EXTENSIONS.map((extension) => base + extension),
    ...SOURCE_EXTENSIONS.map((extension) => path.join(base, "index" + extension)),
  ];
  for (const candidate of candidates) {
    try {
      if ((await fs.stat(candidate)).isFile()) return candidate;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

/**
 * Whether a layout module renders the whole `<html>` document, following re-exports of its default
 * export a few modules deep (`export { default } from "../site/app/layout"`).
 */
export async function layoutRendersDocument(file: string, depth = 0): Promise<boolean> {
  let source: string;
  try {
    source = await fs.readFile(file, "utf8");
  } catch {
    return false;
  }
  if (RENDERS_HTML.test(source)) return true;
  const reexport = DEFAULT_REEXPORT.exec(source);
  if (!reexport || depth >= 4) return false;
  const target = await resolveRelativeModule(file, reexport[1]!);
  return target ? layoutRendersDocument(target, depth + 1) : false;
}

/**
 * Files below `routesDir` whose name passes `test`, as route-relative keys (`/layout.tsx`,
 * `/(docs)/layout.tsx`): the keys the RSC entry gives its merged route module maps.
 */
export async function findRouteFiles(
  routesDir: string,
  test: (name: string) => boolean,
): Promise<Array<{ key: string; file: string }>> {
  const found: Array<{ key: string; file: string }> = [];
  const walk = async (dir: string) => {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules" && !entry.name.startsWith(".")) await walk(full);
      } else if (test(entry.name)) {
        found.push({
          key: "/" + path.relative(routesDir, full).split(path.sep).join("/"),
          file: full,
        });
      }
    }
  };
  await walk(routesDir);
  return found.sort((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0));
}

/** The layouts below `routesDir` that render the `<html>` document themselves. */
export async function findDocumentLayouts(routesDir: string): Promise<string[]> {
  const layouts = await findRouteFiles(routesDir, (name) => LAYOUT_FILE.test(name));
  const owners = await Promise.all(layouts.map(({ file }) => layoutRendersDocument(file)));
  return layouts.filter((_, index) => owners[index]).map(({ key }) => key);
}
