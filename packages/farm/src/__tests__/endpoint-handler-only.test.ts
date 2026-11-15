import { describe, expect, expectTypeOf, it } from "vitest";
import { createEndpoint, GET } from "../api/endpoint";
import { invokeAPIRouteEndpoint } from "../api/route-manager";

describe("createEndpoint(handler)", () => {
  it("runs a handler without an options object", async () => {
    const endpoint = createEndpoint(async () =>
      Response.json(
        { stars: 300 },
        { headers: { "cache-control": "public, s-maxage=600, stale-while-revalidate=3600" } },
      ),
    );

    const response = await invokeAPIRouteEndpoint(
      endpoint,
      new Request("https://app.example.com/api/stars"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      "public, s-maxage=600, stale-while-revalidate=3600",
    );
    await expect(response.json()).resolves.toEqual({ stars: 300 });
  });

  it("serializes a returned value like other endpoints", async () => {
    const endpoint = createEndpoint(() => ({ ok: true }));

    const response = await invokeAPIRouteEndpoint(
      endpoint,
      new Request("https://app.example.com/api/ok"),
    );

    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("types the endpoint like the GET helper's handler-only form", () => {
    const endpoint = createEndpoint(async () => ({ stars: 300 }));
    const helper = GET(async () => ({ stars: 300 }));

    expectTypeOf(endpoint).toEqualTypeOf(helper);
  });

  it("still rejects a non-function second argument", () => {
    // @ts-expect-error An options object needs a handler.
    expect(() => createEndpoint({})).toThrow("createEndpoint requires a handler function");
  });
});
