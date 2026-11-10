import path from "path";

// Source scanners such as hydration planning receive only the project root.
// Config resolution records each project's `srcDir` so Farm's default `@/`
// alias follows it everywhere, the way the bundler alias does. The registry
// lives on globalThis because the CLI resolves config through core's CommonJS
// build and then imports the ESM build pipeline.
const FARM_PROJECT_SOURCE_DIRS = Symbol.for("farm.projectSourceDirs");

function getProjectSourceDirs(): Map<string, string> {
  const globalState = globalThis as typeof globalThis & {
    [FARM_PROJECT_SOURCE_DIRS]?: Map<string, string>;
  };
  return (globalState[FARM_PROJECT_SOURCE_DIRS] ??= new Map());
}

/** @internal Record the resolved `srcDir` for a project root. */
export function setFarmProjectSourceDir(root: string, srcDir: string): void {
  getProjectSourceDirs().set(path.resolve(root), srcDir);
}

/** @internal The `srcDir` resolved for a project root, defaulting to `src`. */
export function getFarmProjectSourceDir(root: string): string {
  return getProjectSourceDirs().get(path.resolve(root)) ?? "src";
}
