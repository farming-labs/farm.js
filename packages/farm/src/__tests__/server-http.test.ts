// @vitest-environment node

import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { invokeAPIRouteEndpoint } from "../api/runtime";
import {
  bufferFarmRequestBody,
  readNodeRequestBody,
  resolveFarmServerConfig,
} from "../server-http";

describe("Farm server HTTP policy", () => {
  it("resolves safe defaults and size strings", () => {
    expect(resolveFarmServerConfig(undefined)).toEqual({
      bodySizeLimit: 10_000_000,
      trustProxy: false,
    });
    expect(resolveFarmServerConfig({ bodySizeLimit: "2 MiB", trustProxy: true })).toEqual({
      bodySizeLimit: 2_097_152,
      trustProxy: true,
    });
  });

  it("rejects streamed Web request bodies above the limit", async () => {
    const request = new Request("https://example.com/upload", {
      method: "POST",
      body: "123456",
    });

    await expect(bufferFarmRequestBody(request, 5)).rejects.toMatchObject({
      code: "BODY_TOO_LARGE",
      status: 413,
    });
  });

  it("rejects Node request bodies above the limit", async () => {
    const request = Readable.from([Buffer.from("123"), Buffer.from("456")]) as Readable & {
      headers: Record<string, string>;
    };
    request.headers = {};

    await expect(readNodeRequestBody(request as any, 5)).rejects.toMatchObject({
      code: "BODY_TOO_LARGE",
      status: 413,
    });
  });

  it("returns 413 before invoking an API route or upload handler", async () => {
    let invoked = false;
    const response = await invokeAPIRouteEndpoint(
      async () => {
        invoked = true;
        return new Response("ok");
      },
      new Request("https://example.com/api/upload", {
        method: "POST",
        body: "123456",
      }),
      {},
      5,
    );

    expect(response.status).toBe(413);
    expect(invoked).toBe(false);
  });

  it("returns 400 for an invalid Content-Length before invoking the handler", async () => {
    let invoked = false;
    const response = await invokeAPIRouteEndpoint(
      async () => {
        invoked = true;
        return new Response("ok");
      },
      new Request("https://example.com/api/upload", {
        method: "POST",
        headers: { "content-length": "not-a-number" },
        body: "x",
      }),
    );

    expect(response.status).toBe(400);
    expect(invoked).toBe(false);
  });
});
