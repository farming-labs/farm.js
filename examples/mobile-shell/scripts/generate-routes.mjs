#!/usr/bin/env node
// Generates android/app/src/main/assets/farm-routes.json from the app's routes
// and mobile.config.mjs (RFC 0004, section 7.2).
//
// Routes come from the patterns `farm generate` writes into src/farm.d.ts, so
// route groups, private folders and slots follow Farm's own scanner. Run
// `farm generate` (or `farm dev`) first when routes change.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * @typedef {"push" | "modal" | "replace"} Presentation
 * @typedef {{ path: string, title: string, icon: string }} MobileTab
 * @typedef {{
 *   server: string,
 *   tabs: MobileTab[],
 *   routes?: Record<string, { presentation: Presentation }>,
 *   pool?: { size?: number, warmPath?: string },
 *   native?: string[],
 * }} MobileShellConfig
 */

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const output = join(root, "android/app/src/main/assets/farm-routes.json");

/** @type {MobileShellConfig} */
const config = (await import(join(root, "mobile.config.mjs"))).default;

const declarations = await readFile(join(root, "src/farm.d.ts"), "utf8").catch(() => {
  throw new Error("src/farm.d.ts is missing. Run `farm generate` first.");
});
const union = declarations.match(/export type RoutePattern =([^;]+);/);
if (!union) throw new Error("No RoutePattern union in src/farm.d.ts.");
const patterns = [...union[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);

/** Segment weight for ordering: static before dynamic before catch-all. */
function weight(segment) {
  if (segment.startsWith("[[...")) return 3;
  if (segment.startsWith("[...")) return 2;
  if (segment.startsWith("[")) return 1;
  return 0;
}

function compare(a, b) {
  const left = a.split("/").filter(Boolean);
  const right = b.split("/").filter(Boolean);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    if (left[i] === undefined) return -1;
    if (right[i] === undefined) return 1;
    const diff = weight(left[i]) - weight(right[i]);
    if (diff !== 0) return diff;
  }
  return 0;
}

const escape = (value) => value.replace(/[.*+?^${}()|\\]/g, "\\$&");

function toRegex(pattern) {
  if (pattern === "/") return "^/$";
  let source = "^";
  for (const segment of pattern.split("/").filter(Boolean)) {
    if (segment.startsWith("[[...")) source += "(?:/.*)?";
    else if (segment.startsWith("[...")) source += "/.+";
    else if (segment.startsWith("[")) source += "/[^/]+";
    else source += `/${escape(segment)}`;
  }
  return `${source}/?$`;
}

for (const path of Object.keys(config.routes ?? {})) {
  if (!patterns.includes(path)) {
    throw new Error(`mobile.config.mjs routes["${path}"] does not match an app route.`);
  }
}
for (const tab of config.tabs) {
  if (!patterns.includes(tab.path)) {
    throw new Error(`mobile.config.mjs tab "${tab.path}" does not match an app route.`);
  }
}

const rules = [...patterns].sort(compare).map((route) => {
  const tab = config.tabs.findIndex((item) => item.path === route);
  return {
    route,
    pattern: toRegex(route),
    presentation: tab >= 0 ? "tab" : (config.routes?.[route]?.presentation ?? "push"),
    ...(tab >= 0 ? { tab } : {}),
  };
});
// Same-origin paths that are not app routes (server 404s, API documents) still push.
rules.push({ route: null, pattern: "^/", presentation: "push" });

const manifest = {
  version: 1,
  server: config.server,
  tabs: config.tabs,
  rules,
  pool: { size: config.pool?.size ?? 2, warmPath: config.pool?.warmPath ?? config.tabs[0].path },
  native: config.native ?? [],
};

await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`farm-routes.json: ${rules.length - 1} routes, ${config.tabs.length} tabs -> ${output}`);
