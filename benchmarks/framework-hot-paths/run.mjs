import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";

import {
  defineIntegration,
  matchIntegrationRoute,
} from "../../packages/farm/dist/integrations.mjs";
import { createFarmRouter } from "../../packages/farm/dist/router.mjs";

const routeCount = readPositiveInteger("FARM_HOT_PATH_BENCH_ROUTES", 100);
const iterations = readPositiveInteger("FARM_HOT_PATH_BENCH_ITERATIONS", 5_000);
const rounds = readPositiveInteger("FARM_HOT_PATH_BENCH_ROUNDS", 7);
const warmupIterations = Math.max(250, Math.floor(iterations / 5));

const browserRoutes = Array.from({ length: routeCount }, (_, index) => `/products/${index}`);
const compiledBrowserRouter = createFarmRouter(browserRoutes);
const scanBrowserRouter = createStaticScanControl(browserRoutes);

const integration = defineIntegration({
  category: "custom",
  type: "hot-path-benchmark",
  instance: {},
  routes: Array.from({ length: routeCount }, (_, index) => ({
    path: `/api/resources/${index}/[id]`,
    method: "GET",
    handler: async () => new Response("ok"),
  })),
});
const integrationConfig = { benchmark: integration };

verifyCorrectness();

const browserCompiled = benchmark("browser: compiled matcher", (count) => {
  for (let index = 0; index < count; index += 1) {
    const routeIndex = index % routeCount;
    compiledBrowserRouter.match(`/products/${routeIndex}?source=benchmark`);
  }
});
const browserScan = benchmark("browser: linear scan control", (count) => {
  for (let index = 0; index < count; index += 1) {
    const routeIndex = index % routeCount;
    scanBrowserRouter.match(`/products/${routeIndex}?source=benchmark`);
  }
});
const integrationCompiled = benchmark("integration: compiled table", (count) => {
  for (let index = 0; index < count; index += 1) {
    matchIntegrationRoute(integrationConfig, {
      pathname: `/api/resources/${routeCount - 1}/${index}`,
      method: "get",
    });
  }
});
const integrationPerRequest = benchmark("integration: per-request compile control", (count) => {
  for (let index = 0; index < count; index += 1) {
    integration.routes = [...integration.routes];
    matchIntegrationRoute(integrationConfig, {
      pathname: `/api/resources/${routeCount - 1}/${index}`,
      method: "get",
    });
  }
});

const results = [browserCompiled, browserScan, integrationCompiled, integrationPerRequest];

console.table(
  results.map((result) => ({
    workload: result.name,
    "median ms": result.medianMs.toFixed(2),
    "ops/sec": result.operationsPerSecond.toFixed(0),
  })),
);
console.log(
  `Browser matcher speedup: ${(browserScan.medianMs / browserCompiled.medianMs).toFixed(2)}x`,
);
console.log(
  `Integration matcher speedup: ${(integrationPerRequest.medianMs / integrationCompiled.medianMs).toFixed(2)}x`,
);
console.log(
  JSON.stringify(
    {
      environment: {
        node: process.version,
        platform: `${process.platform}-${process.arch}`,
        routeCount,
        iterations,
        rounds,
        warmupIterations,
      },
      results,
    },
    null,
    2,
  ),
);

function verifyCorrectness() {
  for (const index of [0, Math.floor(routeCount / 2), routeCount - 1]) {
    const pathname = `/products/${index}?source=correctness`;
    assert.deepEqual(scanBrowserRouter.match(pathname), compiledBrowserRouter.match(pathname));
  }
  assert.equal(scanBrowserRouter.match("/missing"), null);
  assert.equal(compiledBrowserRouter.match("/missing"), null);

  const pathname = `/api/resources/${routeCount - 1}/farm%20benchmark`;
  const compiled = matchIntegrationRoute(integrationConfig, { pathname, method: "get" });
  integration.routes = [...integration.routes];
  const cold = matchIntegrationRoute(integrationConfig, { pathname, method: "get" });
  assert.deepEqual(pickIntegrationMatch(compiled), pickIntegrationMatch(cold));
  assert.deepEqual(pickIntegrationMatch(compiled), {
    key: "benchmark",
    path: `/api/resources/${routeCount - 1}/[id]`,
    methods: ["GET"],
    params: { id: "farm benchmark" },
  });
}

function pickIntegrationMatch(match) {
  if (!match) return null;
  return {
    key: match.key,
    path: match.route.path,
    methods: [...match.route.methods],
    params: match.params,
  };
}

function benchmark(name, run) {
  run(warmupIterations);
  const samples = [];
  for (let round = 0; round < rounds; round += 1) {
    const started = performance.now();
    run(iterations);
    samples.push(performance.now() - started);
  }
  const sorted = samples.toSorted((left, right) => left - right);
  const medianMs = sorted[Math.floor(sorted.length / 2)];
  return {
    name,
    medianMs,
    operationsPerSecond: iterations / (medianMs / 1_000),
    samplesMs: samples,
  };
}

function createStaticScanControl(routes) {
  const entries = routes.map((path) => ({
    route: { path },
    segments: normalizePathname(path).split("/").filter(Boolean).map(decodePathSegment),
  }));
  return {
    match(value) {
      const normalizedPathname = normalizePathname(value);
      for (const entry of entries) {
        // This repeated normalization and split mirrors the previous matcher,
        // which delegated every candidate to matchSegments(pathname).
        const parts = normalizePathname(normalizedPathname).split("/").filter(Boolean);
        if (parts.length !== entry.segments.length) continue;
        let matches = true;
        for (let index = 0; index < entry.segments.length; index += 1) {
          if (decodePathSegment(parts[index]) !== entry.segments[index]) {
            matches = false;
            break;
          }
        }
        if (matches) {
          return { route: entry.route, pathname: normalizedPathname, params: {} };
        }
      }
      return null;
    },
  };
}

function normalizePathname(value) {
  const raw = value || "/";
  let pathname = raw;
  try {
    pathname = new URL(raw, "http://farm.local").pathname;
  } catch {
    pathname = raw.split(/[?#]/, 1)[0] || "/";
  }
  pathname = pathname.replace(/\\/g, "/").replace(/\/+/g, "/");
  if (!pathname.startsWith("/")) pathname = `/${pathname}`;
  if (pathname.length > 1) pathname = pathname.replace(/\/+$/, "");
  return pathname || "/";
}

function decodePathSegment(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function readPositiveInteger(name, fallback) {
  const value = Number(process.env[name] || fallback);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
}
