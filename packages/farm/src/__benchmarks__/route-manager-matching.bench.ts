import assert from "node:assert/strict";
import { bench, describe } from "vitest";
import {
  matchRoute,
  matchRouteParts,
  matchRoutePrefix,
  matchRoutePrefixParts,
  parseRoutePath,
  splitRoutePath,
} from "../utils";

const pathname = "/catalog-99/farm%20benchmark";
const routes = Array.from(
  { length: 100 },
  (_, index) => parseRoutePath(`catalog-${index}/[id]/page.tsx`).segments,
);
const layouts = Array.from({ length: 50 }, (_, index) => ({
  depth: 50 - index,
  segments: parseRoutePath(`catalog-${index}/layout.tsx`).segments,
}));
const orderedLayouts = [...layouts].sort((left, right) => left.depth - right.depth);

assert.deepEqual(scanWithSharedParts(), scanWithRepeatedParsing());
assert.deepEqual(findLayoutsWithSharedParts(), findLayoutsWithRequestSort());
let _benchmarkSink: unknown;

describe("route table scan", () => {
  bench("shared decoded pathname", () => {
    _benchmarkSink = scanWithSharedParts();
  });
  bench("per-candidate pathname parsing control", () => {
    _benchmarkSink = scanWithRepeatedParsing();
  });
});

describe("layout matching", () => {
  bench("discovery-time layout order", () => {
    _benchmarkSink = findLayoutsWithSharedParts();
  });
  bench("per-request layout sort control", () => {
    _benchmarkSink = findLayoutsWithRequestSort();
  });
});

function scanWithSharedParts() {
  const parts = splitRoutePath(pathname);
  for (let index = 0; index < routes.length; index += 1) {
    const match = matchRouteParts(parts, routes[index]);
    if (match.matches) return { index, params: match.params };
  }
  return null;
}

function scanWithRepeatedParsing() {
  for (let index = 0; index < routes.length; index += 1) {
    const match = matchRoute(pathname, routes[index]);
    if (match.matches) return { index, params: match.params };
  }
  return null;
}

function findLayoutsWithSharedParts() {
  const parts = splitRoutePath(pathname);
  return orderedLayouts.filter((entry) => matchRoutePrefixParts(parts, entry.segments)).length;
}

function findLayoutsWithRequestSort() {
  return [...layouts]
    .sort((left, right) => left.depth - right.depth)
    .filter((entry) => matchRoutePrefix(pathname, entry.segments)).length;
}
