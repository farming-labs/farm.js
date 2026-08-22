/**
 * Guard against reintroducing synthetic PopStateEvent dispatches.
 *
 * Farm's SPA router treats popstate as real back/forward navigation, so code
 * that fakes the event to announce URL or state changes triggers spurious
 * full navigations (#415, #420, #424, #425). Programmatic history changes
 * must be announced through client/history-sync instead; its no-router
 * compat fallback is the single place allowed to dispatch a synthetic
 * popstate.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packagesRoot = path.join(repoRoot, "packages");

const PATTERN = "new PopStateEvent";
const ALLOWED_FILES = new Set([path.join("packages", "farm", "src", "client", "history-sync.ts")]);
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

function isTestPath(relativePath) {
  return (
    relativePath.split(path.sep).includes("__tests__") ||
    /\.(test|spec)\.[cm]?[jt]sx?$/.test(relativePath)
  );
}

function* walkSourceFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      yield* walkSourceFiles(fullPath);
      continue;
    }
    if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) yield fullPath;
  }
}

const violations = [];
for (const packageEntry of readdirSync(packagesRoot)) {
  const srcDir = path.join(packagesRoot, packageEntry, "src");
  let srcStat;
  try {
    srcStat = statSync(srcDir);
  } catch {
    continue;
  }
  if (!srcStat.isDirectory()) continue;

  for (const filePath of walkSourceFiles(srcDir)) {
    const relativePath = path.relative(repoRoot, filePath);
    if (ALLOWED_FILES.has(relativePath) || isTestPath(relativePath)) continue;

    const content = readFileSync(filePath, "utf8");
    if (!content.includes(PATTERN)) continue;

    content.split("\n").forEach((line, index) => {
      if (line.includes(PATTERN)) violations.push(`${relativePath}:${index + 1}: ${line.trim()}`);
    });
  }
}

if (violations.length > 0) {
  console.error(
    [
      "Synthetic PopStateEvent dispatch found outside client/history-sync:",
      ...violations.map((violation) => `- ${violation}`),
      "",
      "Farm's routers treat popstate as real back/forward navigation, so faking",
      "it causes spurious full navigations (#415, #420, #424, #425). Announce",
      "programmatic history changes with notifyHistoryChange from",
      "packages/farm/src/client/history-sync.ts instead.",
    ].join("\n"),
  );
  process.exit(1);
}

console.log("No synthetic PopStateEvent dispatches outside client/history-sync.");
