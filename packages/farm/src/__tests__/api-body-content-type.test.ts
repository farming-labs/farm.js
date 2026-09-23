// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createEndpoint } from "../api/endpoint";
import { invokeAPIRouteEndpoint } from "../api/runtime";

function deleteAccount(handler = vi.fn(async () => ({ deleted: true }))) {
  return {
    handler,
    endpoint: createEndpoint(
      "/api/account",
      {
        method: "POST",
        body: z.object({ confirm: z.boolean() }),
      },
      async () => handler(),
    ),
  };
}

describe("API route body content types", () => {
  it("does not parse a declared text/plain body as JSON", async () => {
    const { endpoint, handler } = deleteAccount();

    // text/plain is a CORS "simple" content type: a cross-site page can send it
    // with credentials and without a preflight. Parsing it as JSON would let
    // that request arrive as a valid, schema-passing call.
    const response = await invokeAPIRouteEndpoint(
      endpoint,
      new Request("https://farm.test/api/account", {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: JSON.stringify({ confirm: true }),
      }),
    );

    expect(response.status).toBe(400);
    expect(handler).not.toHaveBeenCalled();
  });

  it("still accepts a declared JSON body", async () => {
    const { endpoint, handler } = deleteAccount();

    const response = await invokeAPIRouteEndpoint(
      endpoint,
      new Request("https://farm.test/api/account", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      }),
    );

    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledOnce();
  });

  it("still accepts a JSON body from a caller that declares no content type", async () => {
    const { endpoint, handler } = deleteAccount();

    // Browsers always attach a content type, so this path is only reachable by
    // non-browser clients; it stays permissive for them.
    const request = new Request("https://farm.test/api/account", {
      method: "POST",
      body: JSON.stringify({ confirm: true }),
    });
    request.headers.delete("content-type");

    const response = await invokeAPIRouteEndpoint(endpoint, request);

    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledOnce();
  });
});
