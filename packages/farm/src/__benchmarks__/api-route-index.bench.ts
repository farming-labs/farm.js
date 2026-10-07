// @vitest-environment node
import assert from "node:assert/strict";
import { bench, describe } from "vitest";
import { createStaticAPIRouteMatcher, matchAPIRoute } from "../api/route-pattern";

let _sink: unknown;
const startupRoutes = Array.from({ length: 500 }, (_, index) => ({
  path: `/api/resources-${index}/[id]`,
}));
describe("prepare a 500-route production table once at startup", () => {
  bench("previous Map construction (metadata deferred to requests)", () => {
    _sink = new Map(startupRoutes.map((route) => [route.path, route]));
  });
  bench("snapshot and static index construction", () => {
    _sink = createStaticAPIRouteMatcher(startupRoutes);
  });
});
for (const [count, sharedPrefix] of [
  [50, false],
  [500, false],
  [2_000, false],
  [500, true],
] as const) {
  const routes = Array.from({ length: count }, (_, index) => ({
    path: sharedPrefix ? `/api/resources/[id]/item-${index}` : `/api/resources-${index}/[id]`,
  }));
  const table = new Map(routes.map((route) => [route.path, route]));
  const indexed = createStaticAPIRouteMatcher(routes);
  const requests = sharedPrefix
    ? [
        `/api/resources/first/item-0`,
        `/api/resources/last/item-${count - 1}`,
        "/api/resources/missing",
      ]
    : ["/api/resources-0/first", `/api/resources-${count - 1}/a%2Fb`, "/api/missing"];
  for (const pathname of requests)
    assert.deepEqual(indexed(pathname), matchAPIRoute(table, pathname));
  describe(`${count} routes, ${sharedPrefix ? "shared dynamic prefix" : "distinct static prefixes"}, first/last/miss batch`, () => {
    bench("live Map matcher control", () => {
      for (const pathname of requests) _sink = matchAPIRoute(table, pathname);
    });
    bench("static production index", () => {
      for (const pathname of requests) _sink = indexed(pathname);
    });
  });
}
