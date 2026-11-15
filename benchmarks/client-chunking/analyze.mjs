// Static metrics of a built fixture's client output: chunk sizes, each route's static JS, and its
// modulepreload list (see README.md).
import fs from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";

const STATIC_IMPORT = /(?:\bimport|\bexport)\s*(?:[\w$*{}\s,]+?\bfrom\s*)?["'`]([^"'`]+\.js)["'`]/g;
const DYNAMIC_IMPORT = /\bimport\(\s*["'`]([^"'`]+\.js)["'`]\s*\)/g;

export function percentile(values, fraction) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (sorted.length - 1) * fraction;
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  return sorted[low] + (sorted[high] - sorted[low]) * (rank - low);
}

function readGraph(publicDir) {
  const files = new Map();
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.name.endsWith(".js")) {
        const code = fs.readFileSync(full, "utf8");
        const relative = path.relative(publicDir, full).replace(/\\/g, "/");
        const resolve = (specifier) =>
          path.posix.normalize(path.posix.join(path.posix.dirname(relative), specifier));
        files.set(relative, {
          bytes: Buffer.byteLength(code),
          gzip: gzipSync(code, { level: 9 }).length,
          imports: [...code.matchAll(STATIC_IMPORT)].map((match) => resolve(match[1])),
          dynamicImports: [...code.matchAll(DYNAMIC_IMPORT)].map((match) => resolve(match[1])),
        });
      }
    }
  };
  visit(publicDir);
  return files;
}

function staticClosure(graph, start, into = new Set()) {
  if (into.has(start) || !graph.has(start)) return into;
  into.add(start);
  for (const imported of graph.get(start).imports) staticClosure(graph, imported, into);
  return into;
}

/** Metrics for one fixture build. `routes` are pathnames; each maps to src/app<path>/page.tsx. */
export function analyzeBuild(appRoot, routes) {
  const buildDir = path.join(appRoot, ".farm");
  const publicDir = path.join(buildDir, ".output/public");
  const graph = readGraph(publicDir);
  const manifest = JSON.parse(
    fs.readFileSync(path.join(buildDir, "client-module-preloads.json"), "utf8"),
  );
  const entryFile = [...graph.keys()].find((file) => /^farm-client-h[0-9a-f]+\.js$/.test(file));
  if (!entryFile) throw new Error("No fingerprinted client entry in the output");
  const chunkFiles = [...graph.keys()].filter((file) => file.startsWith("chunks/"));
  const chunkBytes = chunkFiles.map((file) => graph.get(file).bytes);

  // A route's page chunk is the one whose dynamic import the entry names for its module.
  const missingPreloads = manifest.files.filter((file) => !graph.has(file));
  const entryClosure = staticClosure(graph, entryFile);
  const perRoute = {};
  for (const route of routes) {
    const moduleId = `/src/app${route === "/" ? "" : route}/page.tsx`;
    const preloadIndexes = [...manifest.entry, ...(manifest.modules[moduleId] ?? [])];
    const preloads = [...new Set(preloadIndexes.map((index) => manifest.files[index]))];
    const pageChunk = manifest.modules[moduleId]
      ? manifest.files[manifest.modules[moduleId][0]]
      : undefined;
    const closure = new Set(entryClosure);
    if (pageChunk) staticClosure(graph, pageChunk, closure);
    const files = [...closure];
    perRoute[route] = {
      // The entry script tag itself plus each modulepreload link.
      modulepreloads: preloads.length + 1,
      staticChunks: files.length,
      staticJsBytes: files.reduce((sum, file) => sum + graph.get(file).bytes, 0),
      staticJsGzip: files.reduce((sum, file) => sum + graph.get(file).gzip, 0),
      // Preloads outside the route's static closure would be wasted downloads.
      preloadsOutsideClosure: preloads.filter((file) => !closure.has(file)).length,
      closureNotPreloaded: files.filter((file) => file !== entryFile && !preloads.includes(file))
        .length,
    };
  }
  const routeValues = (key) => Object.values(perRoute).map((value) => value[key]);
  const summary = (key) => ({
    median: percentile(routeValues(key), 0.5),
    p95: percentile(routeValues(key), 0.95),
    max: Math.max(...routeValues(key)),
  });
  return {
    chunks: {
      count: chunkFiles.length,
      totalBytes: chunkBytes.reduce((sum, value) => sum + value, 0),
      totalGzip: chunkFiles.reduce((sum, file) => sum + graph.get(file).gzip, 0),
      medianBytes: percentile(chunkBytes, 0.5),
      p10Bytes: percentile(chunkBytes, 0.1),
      p90Bytes: percentile(chunkBytes, 0.9),
      under2k: chunkBytes.filter((value) => value < 2048).length,
      under10k: chunkBytes.filter((value) => value < 10240).length,
    },
    entryClosureChunks: entryClosure.size,
    missingPreloads,
    routes: {
      modulepreloads: summary("modulepreloads"),
      staticChunks: summary("staticChunks"),
      staticJsGzip: summary("staticJsGzip"),
      preloadsOutsideClosure: summary("preloadsOutsideClosure"),
      closureNotPreloaded: summary("closureNotPreloaded"),
    },
    perRoute,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [appRoot, ...routes] = process.argv.slice(2);
  const result = analyzeBuild(appRoot, routes.length ? routes : ["/"]);
  const { perRoute: _perRoute, ...rest } = result;
  console.log(JSON.stringify(rest, null, 2));
}
