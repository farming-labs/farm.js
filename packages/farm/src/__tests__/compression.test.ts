import { brotliDecompressSync, gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { PluginManager } from "../plugin";
import { createCompressionPlugin } from "../plugins/compression";

function createManager() {
  const manager = new PluginManager({
    config: {},
    isDev: false,
    isProd: true,
  });
  manager.addPlugin(createCompressionPlugin());
  return manager;
}

describe("compression plugin", () => {
  it("compresses response bytes and removes the identity content length", async () => {
    const body = "farm-response-".repeat(128);
    const manager = createManager();
    const response = await manager.runRuntimeRequest(
      new Request("https://farm.test/", { headers: { "accept-encoding": "gzip" } }),
      () =>
        new Response(body, {
          headers: {
            "content-type": "text/plain",
            "content-length": String(Buffer.byteLength(body)),
            etag: '"identity"',
          },
        }),
    );

    expect(response.headers.get("content-encoding")).toBe("gzip");
    expect(response.headers.get("content-length")).toBeNull();
    expect(response.headers.get("vary")).toBe("Accept-Encoding");
    expect(response.headers.get("etag")).toBe('W/"identity"');
    expect(gunzipSync(Buffer.from(await response.arrayBuffer())).toString()).toBe(body);
  });

  it("honors encoding quality values and never selects a disabled encoding", async () => {
    const body = "quality-negotiation".repeat(64);
    const manager = createManager();
    const response = await manager.runRuntimeRequest(
      new Request("https://farm.test/", {
        headers: { "accept-encoding": "gzip;q=0, br;q=0.8" },
      }),
      () => new Response(body),
    );

    expect(response.headers.get("content-encoding")).toBe("br");
    expect(brotliDecompressSync(Buffer.from(await response.arrayBuffer())).toString()).toBe(body);
  });

  it("varies eligible identity responses by Accept-Encoding", async () => {
    const manager = createManager();
    const response = await manager.runRuntimeRequest(
      new Request("https://farm.test/", {
        headers: { "accept-encoding": "br;q=0, gzip;q=0" },
      }),
      () =>
        new Response("identity", {
          headers: { vary: "Accept-Language" },
        }),
    );

    expect(response.headers.get("content-encoding")).toBeNull();
    expect(response.headers.get("vary")).toBe("Accept-Language, Accept-Encoding");
    expect(await response.text()).toBe("identity");
  });

  it("preserves a wildcard Vary value", async () => {
    const manager = createManager();
    const response = await manager.runRuntimeRequest(
      new Request("https://farm.test/", {
        headers: { "accept-encoding": "gzip" },
      }),
      () => new Response("wildcard", { headers: { vary: "*" } }),
    );

    expect(response.headers.get("content-encoding")).toBe("gzip");
    expect(response.headers.get("vary")).toBe("*");
    expect(gunzipSync(Buffer.from(await response.arrayBuffer())).toString()).toBe("wildcard");
  });

  it("leaves existing encodings and streaming event responses untouched", async () => {
    const manager = createManager();
    const encoded = await manager.runRuntimeRequest(
      new Request("https://farm.test/", { headers: { "accept-encoding": "br, gzip" } }),
      () =>
        new Response("already encoded", {
          headers: { "content-encoding": "custom" },
        }),
    );
    const eventStream = await manager.runRuntimeRequest(
      new Request("https://farm.test/events", { headers: { "accept-encoding": "gzip" } }),
      () =>
        new Response("data: ready\n\n", {
          headers: { "content-type": "text/event-stream" },
        }),
    );

    expect(encoded.headers.get("content-encoding")).toBe("custom");
    expect(await encoded.text()).toBe("already encoded");
    expect(eventStream.headers.get("content-encoding")).toBeNull();
    expect(await eventStream.text()).toBe("data: ready\n\n");
  });
});
