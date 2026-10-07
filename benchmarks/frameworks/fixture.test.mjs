import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, test } from "node:test";
import {
  requestPage,
  isValidFixtureResponse,
  isFreshFixtureResponse,
  measureRequests,
} from "./fixture.mjs";

const timestamp = 1791270000123;
const row = (id) =>
  `<li><span>${id}</span><strong>Benchmark item ${String(id).padStart(3, "0")}</strong></li>`;
const rows = Array.from({ length: 120 }, (_, index) => row(index + 1)).join("");
const fixture = (content = rows) =>
  `<main data-benchmark-marker="framework-benchmark-v1" data-item-count="120" data-rendered-at="${timestamp}"><header><h1>Framework benchmark fixture</h1></header><ul>${content}</ul></main>`;

let reply;
let baseUrl;
const server = createServer((_request, response) => {
  response.writeHead(reply.status ?? 200, { "content-type": "text/html; charset=utf-8" });
  response.end(typeof reply.body === "function" ? reply.body() : reply.body);
});
before(async () => {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/`;
});
after(
  () =>
    new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
);

async function read(body, status = 200) {
  reply = { body, status };
  return requestPage(baseUrl);
}

test("accepts the complete ordered workload and preserves response metadata", async () => {
  const body = `<!doctype html><html><body>${fixture()}</body></html>`;
  const response = await read(body);
  assert.equal(isValidFixtureResponse(response), true);
  assert.equal(response.renderedAt, timestamp);
  assert.equal(response.body, body);
  assert.equal(response.bytes, Buffer.byteLength(body));
  assert.ok(Number.isFinite(response.durationMs) && response.durationMs >= 0);
  assert.ok(Number.isSafeInteger(response.requestedAt));
  assert.ok(Number.isSafeInteger(response.receivedAt));
  assert.ok(response.receivedAt >= response.requestedAt);
});

for (const [name, body] of [
  ["empty list", fixture("")],
  ["missing row", fixture(rows.replace(row(60), ""))],
  ["extra row", fixture(rows + row(121))],
  ["duplicate row", fixture(rows.replace(row(60), row(59)))],
  ["reordered rows", fixture(rows.replace(row(1) + row(2), row(2) + row(1)))],
  ["wrong label", fixture().replace("Benchmark item 060", "Wrong item 060")],
  ["wrong identifier", fixture().replace("<span>60</span>", "<span>999</span>")],
  ["extra row text", fixture().replace("<span>60</span>", "<span>60</span>wrong")],
  ["extra list text", fixture(rows + "wrong")],
  ["rows outside the fixture", fixture("") + `<ul>${rows}</ul>`],
  ["comment-only fixture", `<!-- ${fixture()} -->`],
  ["script-only fixture", `<script type="application/json">${fixture()}</script>`],
  ["template-only fixture", `<template>${fixture()}</template>`],
  ["comment-only rows", fixture(`<!-- ${rows} -->`)],
  ["script-only rows", fixture(`<script type="application/json">${rows}</script>`)],
  ["template-only rows", fixture(`<template>${rows}</template>`)],
  ["duplicate fixture roots", fixture() + fixture()],
  ["marker on the wrong element", fixture().replaceAll("main", "section")],
  ["unsafe integer timestamp", fixture().replace(String(timestamp), "9007199254740992")],
  ["missing timestamp", fixture().replace(`data-rendered-at="${timestamp}"`, "")],
  [
    "wrong item-count attribute",
    fixture().replace('data-item-count="120"', 'data-item-count="119"'),
  ],
  [
    "nested label markup",
    fixture().replace("Benchmark item 060", "<script>Benchmark item 060</script>"),
  ],
]) {
  test(`rejects ${name}`, async () => {
    assert.equal(isValidFixtureResponse(await read(body)), false);
  });
}

test("ignores script and comment timestamps outside the real fixture", async () => {
  const response = await read(
    `<script>data-rendered-at="42"</script><!-- data-rendered-at="43" -->${fixture()}`,
  );
  assert.equal(isValidFixtureResponse(response), true);
  assert.equal(response.renderedAt, timestamp);
});

test("accepts framework comments, whitespace, attributes, and HTML entity text", async () => {
  const body = fixture(
    rows
      .replaceAll("<li>", '<!--[--><li data-v-fixture="">')
      .replaceAll("</li>", "</li><!--]-->")
      .replaceAll("<span>", "<span><!-- -->")
      .replaceAll("Benchmark item", "Benchmark&#32;item")
      .replaceAll("</span><strong>", "</span>\n  <strong>"),
  );
  assert.equal(isValidFixtureResponse(await read(body)), true);
});

test("accepts single-quoted and unquoted HTML attributes", async () => {
  const body = fixture()
    .replaceAll('="', "='")
    .replaceAll('">', "'>")
    .replaceAll('" ', "' ")
    .replace("data-item-count='120'", "data-item-count=120");
  assert.equal(isValidFixtureResponse(await read(body)), true);
});

test("keeps HTTP failure responses invalid", async () => {
  assert.equal(isValidFixtureResponse(await read(fixture(), 500)), false);
});

const freshResponse = {
  status: 200,
  renderedAt: timestamp,
  requestedAt: timestamp,
  receivedAt: timestamp + 2,
};

test("accepts inclusive request bounds and legitimate same-millisecond renders", () => {
  for (const renderedAt of [timestamp, timestamp + 1, timestamp + 2]) {
    assert.equal(isFreshFixtureResponse({ ...freshResponse, renderedAt }), true);
  }
  const sameMillisecond = { ...freshResponse, receivedAt: timestamp };
  assert.equal(isFreshFixtureResponse(sameMillisecond), true);
  assert.equal(isFreshFixtureResponse(sameMillisecond), true);
});

for (const [name, override] of [
  ["stale render", { renderedAt: timestamp - 1 }],
  ["future render", { renderedAt: timestamp + 3 }],
  ["backwards wall clock", { receivedAt: timestamp - 1 }],
  ["missing request time", { requestedAt: undefined }],
  ["missing completion time", { receivedAt: undefined }],
  ["non-finite request time", { requestedAt: NaN }],
  ["non-finite completion time", { receivedAt: Infinity }],
  ["unsafe request time", { requestedAt: -9007199254740992 }],
  ["unsafe completion time", { receivedAt: 9007199254740992 }],
  ["failed status", { status: 500 }],
  ["invalid fixture timestamp", { renderedAt: null }],
]) {
  test(`freshness rejects: ${name}`, () => {
    assert.equal(isFreshFixtureResponse({ ...freshResponse, ...override }), false);
  });
}

function clockedFixture(t, cacheAfter = Infinity) {
  let now = timestamp;
  let requests = 0;
  let renderedAt;
  t.mock.method(Date, "now", () => now);
  reply = {
    body() {
      if (requests++ < cacheAfter) renderedAt = now;
      // Advance deterministically after rendering but before body completion.
      // A frozen render is then older than the next request; no sleeps needed.
      now += 1;
      return fixture().replace(String(timestamp), String(renderedAt));
    },
  };
  return () => requests;
}

test("measures fresh responses with unchanged warm-up and sample counts", async (t) => {
  const requests = clockedFixture(t);
  const samples = await measureRequests(baseUrl, 2, 3);
  assert.equal(requests(), 5);
  assert.equal(samples.length, 3);
  assert.ok(samples.every((sample) => Number.isFinite(sample) && sample >= 0));
});

for (const [name, warmups, cacheAfter, expectedRequests, error] of [
  ["during warm-up", 2, 1, 2, /freshness check failed during warm-up/],
  ["after warm-up", 2, 2, 3, /freshness check failed during measured request/],
  ["midway through measurement", 1, 3, 4, /freshness check failed during measured request/],
  ["without warm-up", 0, 1, 2, /freshness check failed during measured request/],
]) {
  test(`rejects a fixture that starts caching ${name}`, async (t) => {
    const requests = clockedFixture(t, cacheAfter);
    await assert.rejects(measureRequests(baseUrl, warmups, 3), error);
    assert.equal(requests(), expectedRequests);
  });
}
