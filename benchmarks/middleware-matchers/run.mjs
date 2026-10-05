import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";

import { matchesMiddlewareConfig } from "../../packages/farm/dist/middleware.mjs";

const matcherCount = readPositiveInteger("FARM_MIDDLEWARE_BENCH_MATCHERS", 100);
const iterations = readPositiveInteger("FARM_MIDDLEWARE_BENCH_ITERATIONS", 10_000);
const rounds = readPositiveInteger("FARM_MIDDLEWARE_BENCH_ROUNDS", 7);
const warmupIterations = Math.max(500, Math.floor(iterations / 5));
const config = {
  exclude: ["/resource-99/private/:path*"],
  matcher: Array.from({ length: matcherCount }, (_, index) => `/resource-${index}/:id`),
};
const ctx = { pathname: "/resource-99/value" };

verifyCorrectness();

// Prime the setup cache before timing the request path.
matchesMiddlewareConfig(ctx.pathname, config, ctx);
const compiled = benchmark("compiled config", (count) => {
  for (let index = 0; index < count; index += 1) {
    matchesMiddlewareConfig(`/resource-${matcherCount - 1}/${index}`, config, ctx);
  }
});
const perRequest = benchmark("per-request compile control", (count) => {
  for (let index = 0; index < count; index += 1) {
    matchConfigPerRequest(`/resource-${matcherCount - 1}/${index}`, config);
  }
});

console.table(
  [compiled, perRequest].map((result) => ({
    workload: result.name,
    "median ms": result.medianMs.toFixed(2),
    "ops/sec": result.operationsPerSecond.toFixed(0),
  })),
);
console.log(`Matcher speedup: ${(perRequest.medianMs / compiled.medianMs).toFixed(2)}x`);

function verifyCorrectness() {
  for (const pathname of [
    "/resource-99/value",
    "/resource-99/private/settings",
    "/%72esource-99/encoded",
    "/missing",
  ]) {
    assert.deepEqual(
      matchesMiddlewareConfig(pathname, config, { ...ctx, pathname }),
      matchConfigPerRequest(pathname, config),
    );
  }
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
  };
}

function matchConfigPerRequest(pathname, middlewareConfig) {
  if (middlewareConfig.exclude?.some((pattern) => matchPattern(pattern, pathname).matched)) {
    return { matched: false };
  }
  for (const matcher of middlewareConfig.matcher || []) {
    const result = matchPattern(matcher, pathname);
    if (result.matched) return result;
  }
  return { matched: false };
}

function matchPattern(pattern, pathname) {
  const canonicalPathname = canonicalize(pathname);
  if (pattern === "*" || pattern === "/(.*)") return { matched: true };
  const params = [];
  const parts = pattern
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      if (segment.startsWith(":")) {
        const raw = segment.slice(1);
        const modifier = "*+?".includes(raw.at(-1)) ? raw.at(-1) : undefined;
        params.push(modifier ? raw.slice(0, -1) : raw);
        if (modifier === "*") return "(?:/(.*))?";
        if (modifier === "+") return "/(.+)";
        return "/([^/]+)";
      }
      return `/${segment.replace(/[|\\{}()[\]^$+?.]/g, "\\$&").replace(/\\\*/g, "[^/]*")}`;
    });
  const match = new RegExp(`^${parts.join("")}$`).exec(canonicalPathname);
  if (!match) return { matched: false };
  const values = Object.fromEntries(params.map((param, index) => [param, match[index + 1] || ""]));
  return { matched: true, params: params.length > 0 ? values : undefined };
}

function canonicalize(pathname) {
  return pathname
    .split("/")
    .map((segment, index) => {
      if (index === 0) return "";
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    })
    .join("/");
}

function readPositiveInteger(name, fallback) {
  const value = Number(process.env[name] || fallback);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
}
