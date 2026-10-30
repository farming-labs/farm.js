import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { z } from "zod";
import { APIClientError, createAPIClient } from "../api/client";
import { createEndpoint, EndpointFailure } from "../api/endpoint";
import { invokeAPIRouteEndpoint } from "../api/runtime";

describe("typed endpoint errors", () => {
  const createProduct = createEndpoint(
    "/api/products",
    {
      method: "POST",
      body: z.object({
        name: z.string(),
      }),
      errors: {
        duplicate: {
          status: 409,
          message: "A product with this name already exists",
          data: z.object({
            existingId: z.string(),
          }),
        },
        forbidden: {
          status: 403,
          data: z.object({
            permission: z.string(),
          }),
        },
      },
    },
    async ({ body, error }) => {
      if (body.name === "__typecheck__") {
        // @ts-expect-error only declared endpoint error codes are accepted.
        error("missing", {});
        // @ts-expect-error duplicate errors require a string existingId.
        error("duplicate", { existingId: 123 });
      }

      if (body.name === "Existing") {
        return error("duplicate", {
          existingId: "product-1",
        });
      }

      return {
        id: "product-2",
        name: body.name,
      };
    },
  );

  it("serializes validated expected failures without exposing a stack", async () => {
    const response = await invokeAPIRouteEndpoint(
      createProduct,
      new Request("https://farm.test/api/products", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: "Existing",
        }),
      }),
    );

    expect(response.status).toBe(409);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "duplicate",
        message: "A product with this name already exists",
        data: {
          existingId: "product-1",
        },
      },
    });
  });

  it("rejects malformed JSON before an endpoint handler executes", async () => {
    let executed = false;
    const handler = createEndpoint({ method: "POST" }, (ctx) => {
      executed = true;
      return { body: ctx.body };
    });
    const response = await invokeAPIRouteEndpoint(
      handler,
      new Request("https://farm.test/api/products", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      }),
    );

    expect(executed).toBe(false);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid request body",
      message: "The request body is not valid JSON.",
    });
  });

  it("validates native urlencoded form submissions", async () => {
    const response = await invokeAPIRouteEndpoint(
      createProduct,
      new Request("https://farm.test/api/products", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
        },
        body: "name=From+a+native+form",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      id: "product-2",
      name: "From a native form",
    });
  });

  it("preserves the typed failure when an endpoint is called directly", async () => {
    await expect(
      createProduct({
        body: {
          name: "Existing",
        },
      }),
    ).rejects.toMatchObject({
      name: "EndpointFailure",
      code: "duplicate",
      status: 409,
      data: {
        existingId: "product-1",
      },
    });

    try {
      await createProduct({
        body: {
          name: "Existing",
        },
      });
    } catch (error) {
      expect(error).toBeInstanceOf(EndpointFailure);
    }
  });

  it("infers discriminated client errors from the endpoint contract", async () => {
    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) =>
      invokeAPIRouteEndpoint(createProduct, new Request(url, init)),
    ) as any;
    type Router = {
      products: {
        post: typeof createProduct;
      };
    };
    const api = createAPIClient<Router>({
      baseURL: "https://farm.test",
    });

    const result = await api.products.post({
      body: {
        name: "Existing",
      },
    });

    expect(result.error).toBeInstanceOf(APIClientError);
    expect(result.error).toMatchObject({
      code: "duplicate",
      status: 409,
      data: {
        existingId: "product-1",
      },
    });

    if (result.error?.code === "duplicate") {
      expectTypeOf(result.error.data).toEqualTypeOf<{
        existingId: string;
      }>();
      expectTypeOf(result.error.status).toEqualTypeOf<409>();
    }

    if (result.error?.code === "forbidden") {
      expectTypeOf(result.error.data).toEqualTypeOf<{
        permission: string;
      }>();
      expectTypeOf(result.error.status).toEqualTypeOf<403>();
    }
  });

  it("validates declared error definitions when the endpoint is created", () => {
    expect(() =>
      createEndpoint(
        {
          method: "POST",
          errors: {
            invalid: {
              status: 200,
              data: z.object({}),
            },
          },
        },
        async () => ({ ok: true }),
      ),
    ).toThrow('Endpoint error "invalid" status must be an integer between 400 and 599');
  });
  it("does not echo expected literal, enum, or pattern values in validation errors", async () => {
    const secret = "Bearer s3cr3t-cron-token";
    const endpoint = createEndpoint(
      {
        method: "POST",
        headers: z.object({ authorization: z.literal(secret) }),
        query: z.object({ plan: z.enum(["internal-x9", "pro"]) }).partial(),
        body: z.object({
          key: z.string().regex(/^sk_live_[a-z0-9]+$/),
          slug: z.string().refine((slug) => slug !== "taken", "Slug is taken"),
        }),
      },
      () => ({ ran: true }),
    );
    const invoke = (path: string, init: RequestInit) =>
      invokeAPIRouteEndpoint(
        endpoint,
        new Request(`https://farm.test${path}`, { method: "POST", ...init }),
      );
    const body = JSON.stringify({ key: "sk_live_ok", slug: "free" });

    const headers = await invoke("/api/cron", {
      headers: { authorization: "Bearer guess", "content-type": "application/json" },
      body,
    });
    const headersText = await headers.text();
    expect(headers.status).toBe(400);
    expect(headersText).not.toContain("s3cr3t");
    expect(JSON.parse(headersText)).toEqual({
      error: "Invalid request headers",
      details: [{ path: ["authorization"], code: "invalid_value", message: "Invalid value" }],
    });

    const query = await invoke("/api/cron?plan=free", {
      headers: { authorization: secret, "content-type": "application/json" },
      body,
    });
    expect(query.status).toBe(400);
    expect(await query.text()).not.toContain("internal-x9");

    const invalidBody = await invoke("/api/cron", {
      headers: { authorization: secret, "content-type": "application/json" },
      body: JSON.stringify({ key: "sk_test", slug: "taken" }),
    });
    expect(invalidBody.status).toBe(400);
    const bodyText = await invalidBody.text();
    expect(bodyText).not.toContain("sk_live");
    // A refinement message is the app's own text, so it still reaches the caller.
    expect(JSON.parse(bodyText).details).toEqual([
      { path: ["key"], code: "invalid_format", message: "Invalid value" },
      { path: ["slug"], code: "custom", message: "Slug is taken" },
    ]);
  });
});
