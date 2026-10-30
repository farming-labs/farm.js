// What two RFC 0003 ideas would save on the islands build, measured before building them.
//
//   node benchmarks/server-components-payload/what-if.mjs   (after measure.mjs built app/)
//
// - Island manifest: every island's props in one script instead of one script per island.
// - Shared value files: values that two or more pages share served as a cached file
//   (`/_farm/v/<hash>.json`) instead of inline.
// Both are simulated on the real HTML the production server sends. Brotli quality 5.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.join(here, "app");
const PAGES = ["/docs/p0", "/docs/p40", "/docs/p120", "/docs/p200", "/docs/p299"];
const br = (text) =>
  zlib.brotliCompressSync(Buffer.from(text), {
    params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 },
  }).length;
const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;
const average = (values) => values.reduce((total, value) => total + value, 0) / values.length;

const PROPS =
  /<script type="application\/json" data-farm-client-props="([^"]+)">([^<]*)<\/script>/g;
const VALUE =
  /<script type="application\/json" data-farm-value="([0-9a-z]{14})">([^<]*)<\/script>/g;

const port = 4283;
const server = spawn(
  process.execPath,
  [path.join(app, ".farm", ".output-islands", "server", "index.mjs")],
  { env: { ...process.env, NODE_ENV: "production", HOST: "127.0.0.1", PORT: String(port) } },
);
const base = `http://127.0.0.1:${port}`;
try {
  for (let attempt = 0; ; attempt++) {
    try {
      if ((await fetch(`${base}/docs/p0`)).ok) break;
    } catch {
      if (attempt > 100) throw new Error("islands server did not start");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  const documents = await Promise.all(PAGES.map(async (page) => (await fetch(base + page)).text()));
  const segment = await (
    await fetch(`${base}/docs/p121`, { headers: { "x-farm-layout-chain": '["/docs"]' } })
  ).text();

  // Island manifest.
  const manifest = (html) => {
    const islands = {};
    for (const [, id, json] of html.matchAll(PROPS)) islands[id] = JSON.parse(json);
    return html
      .replace(PROPS, "")
      .replace(
        "</body>",
        `<script type="application/json" data-farm-islands>${JSON.stringify(islands)}</script></body>`,
      );
  };
  const manifestRows = [...documents, segment].map((html) => br(manifest(html)) - br(html));

  // Shared value files: the values on two or more sampled pages.
  const pagesByKey = new Map();
  const jsonByKey = new Map();
  for (const html of documents) {
    for (const [, key, json] of html.matchAll(VALUE)) {
      jsonByKey.set(key, json);
      pagesByKey.set(key, new Set([...(pagesByKey.get(key) ?? []), html]));
    }
  }
  const shared = new Set([...pagesByKey].filter(([, pages]) => pages.size > 1).map(([key]) => key));
  const external = (html) =>
    html.replace(VALUE, (script, key) =>
      shared.has(key)
        ? `<script type="application/json" data-farm-value="${key}" data-farm-value-src></script>`
        : script,
    );
  const file = br(
    JSON.stringify(
      Object.fromEntries([...shared].map((key) => [key, JSON.parse(jsonByKey.get(key))])),
    ),
  );
  const today = average(documents.map(br));
  const withFiles = average(documents.map((html) => br(external(html))));

  console.log("Island manifest (one script instead of one per island)");
  console.log(
    `  change per response: ${manifestRows.map((delta) => `${delta >= 0 ? "+" : ""}${delta} B`).join(", ")}`,
  );
  console.log("Shared value files");
  console.log(`  values shared by sampled pages: ${shared.size}`);
  console.log(`  document today:              ${kb(today)}`);
  console.log(`  document with value files:   ${kb(withFiles)}`);
  console.log(`  value file:                  ${kb(file)}`);
  console.log(
    `  first visit:  ${kb(today)} -> ${kb(withFiles + file)} (${((100 * (withFiles + file - today)) / today).toFixed(0)}%), plus a request before islands hydrate`,
  );
  console.log(
    `  later full load, file cached: ${kb(today)} -> ${kb(withFiles)} (${((100 * (withFiles - today)) / today).toFixed(0)}%)`,
  );
  console.log(
    `  break-even: ${((withFiles + file - today) / (today - withFiles)).toFixed(1)} cached full loads per first visit`,
  );
} finally {
  server.kill();
}
