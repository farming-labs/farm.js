import assert from "node:assert/strict";
import { test } from "vitest";
import { matchAPIRoute } from "../api/route-pattern";
import { matchAPIRoute as matchPreviousAPIRoute } from "./controls/api-route-pattern";

const routes = new Map(
  Array.from({ length: 500 }, (_, index) => {
    const route = { path: `/api/resources-${index}/[id]` };
    return [route.path, route] as const;
  }),
);
const pathname = "/api/resources-499/farm%20benchmark";
for (const path of [pathname, "/api/resources-0/first", "/api/resources-250/a%2Fb", "/missing"]) {
  assert.deepEqual(matchAPIRoute(routes, path), matchPreviousAPIRoute(routes, path));
}
let _benchmarkSink: unknown;

test("API route matching", async ({ bench }) => {
  await bench.compare(
    bench("cached route metadata", () => {
      _benchmarkSink = matchAPIRoute(routes, pathname);
    }),
    bench("previous API matcher control", () => {
      _benchmarkSink = matchPreviousAPIRoute(routes, pathname);
    }),
  );
});
