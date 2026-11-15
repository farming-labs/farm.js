import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { brotliCompressSync, gzipSync } from "node:zlib";
import { requestPage, isFreshFixtureResponse, measureRequests } from "./fixture.mjs";

function fixture() {
  const rows = Array.from(
    { length: 120 },
    (_, index) =>
      `<li><span>${index + 1}</span><strong>Benchmark item ${String(index + 1).padStart(3, "0")}</strong></li>`,
  ).join("");
  return `<main data-benchmark-marker="framework-benchmark-v1" data-item-count="120" data-rendered-at="${Date.now()}"><ul>${rows}</ul></main>`;
}

async function serve(t, handler) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  );
  return `http://127.0.0.1:${server.address().port}/`;
}

for (const encoding of ["identity", "gzip", "br"]) {
  for (const chunked of [false, true]) {
    test(`records ${encoding} encoded and decoded body bytes (chunked=${chunked})`, async (t) => {
      let body, encoded, requestHeaders;
      const url = await serve(t, (request, response) => {
        requestHeaders = request.headers;
        body = fixture();
        encoded =
          encoding === "gzip"
            ? gzipSync(body)
            : encoding === "br"
              ? brotliCompressSync(body)
              : Buffer.from(body);
        response.writeHead(200, {
          "content-type": "text/html",
          ...(encoding === "identity" ? {} : { "content-encoding": encoding }),
          ...(!chunked ? { "content-length": String(encoded.length) } : {}),
        });
        response.write(encoded.subarray(0, 9));
        response.end(encoded.subarray(9));
      });
      const result = await requestPage(url, 60000, encoding);
      assert.equal(requestHeaders["accept-encoding"], encoding);
      assert.equal(requestHeaders.connection, "close");
      assert.equal(result.body, body);
      assert.equal(result.contentEncoding, encoding);
      assert.equal(result.encodedBodyBytes, encoded.length);
      assert.equal(result.decodedBodyBytes, Buffer.byteLength(body));
      assert.equal(result.bytes, result.decodedBodyBytes);
      assert.equal(isFreshFixtureResponse(result), true);
    });
  }
}

test("records identity fallback rather than claiming the requested compression", async (t) => {
  const url = await serve(t, (_request, response) => response.end(fixture()));
  const result = await requestPage(url, 60000, "br");
  assert.equal(result.contentEncoding, "identity");
  assert.equal(result.encodedBodyBytes, result.decodedBodyBytes);
});

test("retains metadata for every warm-up and measured response outside timing", async (t) => {
  const requested = [];
  const url = await serve(t, (request, response) => {
    requested.push(request.headers["accept-encoding"]);
    response.end(fixture());
  });
  const observed = [];
  const samples = await measureRequests(url, 2, 3, {
    encoding: "gzip",
    onResponse: (response, phase) => observed.push({ response, phase }),
  });
  assert.deepEqual(requested, Array(5).fill("gzip"));
  assert.deepEqual(
    observed.map(({ phase }) => phase),
    ["warmup", "warmup", "measured", "measured", "measured"],
  );
  assert.deepEqual(
    observed.slice(2).map(({ response }) => response.durationMs),
    samples,
  );
  assert.ok(observed.every(({ response }) => response.contentEncoding === "identity"));
});

test("rejects unsupported requested encodings before dispatch", async () => {
  await assert.rejects(requestPage("http://127.0.0.1:1", 60000, "deflate"), /encoding/i);
});

for (const encoding of ["deflate", "gzip, br", "gzip"]) {
  test(`rejects unrequested response encoding ${encoding}`, async (t) => {
    const url = await serve(t, (_request, response) => {
      response.writeHead(200, { "content-encoding": encoding });
      response.end("not identity");
    });
    await assert.rejects(requestPage(url), /encoding/i);
  });
}

test("rejects corrupt compressed bodies", async (t) => {
  const url = await serve(t, (_request, response) => {
    response.writeHead(200, { "content-encoding": "gzip" });
    response.end("not gzip");
  });
  await assert.rejects(requestPage(url, 60000, "gzip"));
});

test("rejects truncated HTTP bodies", async (t) => {
  const url = await serve(t, (_request, response) => {
    response.writeHead(200, { "content-length": "1000" });
    response.end("short");
  });
  await assert.rejects(requestPage(url, 1000));
});

test("deadline includes a response body that never completes", async (t) => {
  const url = await serve(t, (_request, response) => {
    response.writeHead(200, { "content-type": "text/html" });
    response.write("pending");
  });
  await assert.rejects(requestPage(url, 30), { name: "TimeoutError" });
});
