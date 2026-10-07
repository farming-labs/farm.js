// @vitest-environment node
import assert from "node:assert/strict";
import { bench, describe } from "vitest";
import { matchesMiddlewareRoute, compileMiddlewareRoute } from "../middleware/matcher";
import { matchRoutePath } from "./controls/file-middleware";

const entries = Array.from({ length: 100 }, (_, index) => ({ path: `/resource-${index}/[id]` }));
for (const entry of entries) compileMiddlewareRoute(entry);
let _sink: unknown;
for (const pathname of ["/missing", "/resource-99/value/nested", "/resource-99/%2541BC"]) {
  for (const entry of entries) {
    assert.deepEqual(matchesMiddlewareRoute(pathname, entry), matchRoutePath(pathname, entry.path));
  }
  describe(`100 file middleware entries against ${pathname}`, () => {
    bench("previous per-request compilation", () => {
      for (const entry of entries) _sink = matchRoutePath(pathname, entry.path);
    });
    bench("reused compiled patterns", () => {
      for (const entry of entries) _sink = matchesMiddlewareRoute(pathname, entry);
    });
  });
}
