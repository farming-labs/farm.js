import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { restoreUnpreparedHeaders, summarizePairs } from "./production-source.mjs";

const source = readFileSync(
  new URL("../../packages/farm/src/nitro/universal-build.ts", import.meta.url),
  "utf8",
);
function generated(name) {
  const start = source.indexOf(`export function ${name}(): string {`),
    marker = "\n`.trim();\n}",
    end = source.indexOf(marker, start);
  assert.ok(start >= 0 && end > start);
  return new Function(
    source
      .slice(start, end + marker.length)
      .replace("export ", "")
      .replace("(): string {", "() {") + `\nreturn ${name}();`,
  )();
}
const matcher = generated("generateRuntimePathMatcherSource");
const headers = generated("generateConfiguredResponseHeadersRuntimeSource");

test("ablation restores per-rule matching without changing response contents", async () => {
  const baseline = restoreUnpreparedHeaders(headers);
  const routes = [{ source: "/a/:id", headers: [{ key: "x-test", value: "yes" }] }];
  const results = [];
  for (const code of [headers, baseline]) {
    const run = new Function(
      "configuredHeaderRoutes",
      `${matcher}\n${code}\nreturn applyConfiguredResponseHeaders;`,
    )(routes);
    const output = run(new Response("unchanged"), "/a/%252F");
    results.push({ headers: [...output.headers], body: await output.text() });
  }
  assert.deepEqual(results[0], results[1]);
  assert.equal(results[0].headers.find(([name]) => name === "x-test")[1], "yes");
});

test("ablation rejects stale, duplicate, or already-ablated source", () => {
  assert.throws(() => restoreUnpreparedHeaders("unrelated module"));
  assert.throws(() => restoreUnpreparedHeaders(headers + "\n" + headers));
  assert.throws(() => restoreUnpreparedHeaders(restoreUnpreparedHeaders(headers)));
  assert.throws(() =>
    restoreUnpreparedHeaders(headers.replace("map(decodeRouteSegment)", "map(otherDecoder)")),
  );
});

test("summary retains regressions and same-code noise without dropping outliers", () => {
  const pairs = [
    {
      baseline: { meanUs: 100 },
      candidate: { meanUs: 110 },
      controlA: { meanUs: 100 },
      controlB: { meanUs: 150 },
    },
    {
      baseline: { meanUs: 100 },
      candidate: { meanUs: 90 },
      controlA: { meanUs: 100 },
      controlB: { meanUs: 100 },
    },
  ];
  const result = summarizePairs(pairs);
  assert.deepEqual(result.medianProcessMeanUs, {
    baseline: 100,
    candidate: 100,
    controlA: 100,
    controlB: 125,
  });
  assert.equal(result.pairedChangePercent.length, 2);
  assert.ok(result.pairedChangePercent[0] > 0 && result.pairedChangePercent[1] < 0);
  assert.deepEqual(result.sameCodeControlChangePercent, [50, 0]);
});
