import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createEndpoint } from "../api/endpoint";
import { invokeAPIRouteEndpoint } from "../api/runtime";

/** Calls the endpoint and returns the query object the handler was given. */
async function queryGivenToHandler(
  schema: z.ZodTypeAny | undefined,
  search: string,
): Promise<{ status: number; query: any }> {
  let query: any;
  const endpoint = createEndpoint(
    { method: "GET", ...(schema ? { query: schema } : {}) } as any,
    async (ctx: any) => {
      query = ctx.query;
      return Response.json({ ok: true });
    },
  );

  const response = await invokeAPIRouteEndpoint(
    endpoint as any,
    new Request(`http://localhost/api/posts${search}`),
    {},
  );
  return { status: response.status, query };
}

describe("API route query parameters", () => {
  it("collects a repeated parameter into an array", async () => {
    const { status, query } = await queryGivenToHandler(
      z.object({ tag: z.array(z.string()), page: z.string() }),
      "?tag=react&tag=vite&tag=zod&page=2",
    );

    expect(status).toBe(200);
    expect(query).toEqual({ tag: ["react", "vite", "zod"], page: "2" });
  });

  it("keeps a single value a string", async () => {
    const { status, query } = await queryGivenToHandler(
      z.object({ tag: z.string() }),
      "?tag=react",
    );

    expect(status).toBe(200);
    expect(query).toEqual({ tag: "react" });
  });

  it("preserves the order of a repeated parameter", async () => {
    const { query } = await queryGivenToHandler(
      z.object({ tag: z.array(z.string()) }),
      "?tag=c&tag=a&tag=b",
    );

    expect(query.tag).toEqual(["c", "a", "b"]);
  });

  it("passes a repeated parameter through when there is no query schema", async () => {
    const { status, query } = await queryGivenToHandler(undefined, "?tag=react&tag=vite");

    expect(status).toBe(200);
    expect(query).toEqual({ tag: ["react", "vite"] });
  });

  it("ignores query keys that would poison the prototype", async () => {
    const { status, query } = await queryGivenToHandler(
      undefined,
      "?__proto__=polluted&constructor=x&prototype=y&safe=ok",
    );

    expect(status).toBe(200);
    expect(query).toEqual({ safe: "ok" });
    expect(Object.getPrototypeOf({})).toBe(Object.prototype);
    expect(({} as any).polluted).toBeUndefined();
  });

  it("still rejects a query that does not match its schema", async () => {
    const endpoint = createEndpoint(
      { method: "GET", query: z.object({ page: z.string() }) },
      async () => Response.json({ ok: true }),
    );

    const response = await invokeAPIRouteEndpoint(
      endpoint as any,
      new Request("http://localhost/api/posts"),
      {},
    );

    expect(response.status).toBe(400);
  });
});
