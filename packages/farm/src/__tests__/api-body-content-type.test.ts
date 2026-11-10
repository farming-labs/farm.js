// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createEndpoint } from "../api/endpoint";
import { multipart } from "../api/transport";
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

function schemaLessMutation(handler = vi.fn(async () => ({ mutated: true }))) {
  return {
    handler,
    endpoint: createEndpoint({ method: "POST" }, async ({ body }) => handler(body)),
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

  it("does not parse a typeless body from another origin as JSON", async () => {
    const { endpoint, handler } = deleteAccount();

    // A browser sends a Blob or byte body with no content type, and a cross-site
    // page can do so in a no-cors fetch with the visitor's cookies.
    const request = new Request("https://farm.test/api/account", {
      method: "POST",
      headers: { origin: "https://evil.example", "sec-fetch-site": "cross-site" },
      body: new TextEncoder().encode(JSON.stringify({ confirm: true })),
    });
    request.headers.delete("content-type");

    const response = await invokeAPIRouteEndpoint(endpoint, request);

    expect(response.status).toBe(400);
    expect(handler).not.toHaveBeenCalled();
  });

  it("still parses a typeless body from the app's own pages", async () => {
    const { endpoint, handler } = deleteAccount();

    const request = new Request("https://farm.test/api/account", {
      method: "POST",
      headers: { origin: "https://farm.test", "sec-fetch-site": "same-origin" },
      body: new TextEncoder().encode(JSON.stringify({ confirm: true })),
    });
    request.headers.delete("content-type");

    const response = await invokeAPIRouteEndpoint(endpoint, request);

    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledOnce();
  });

  it("still accepts a JSON body from a caller that declares no content type", async () => {
    const { endpoint, handler } = deleteAccount();

    // A server or script that omits the header keeps this permissive path.
    const request = new Request("https://farm.test/api/account", {
      method: "POST",
      body: JSON.stringify({ confirm: true }),
    });
    request.headers.delete("content-type");

    const response = await invokeAPIRouteEndpoint(endpoint, request);

    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledOnce();
  });

  it("keeps malformed untyped bodies on the permissive compatibility path", async () => {
    const { endpoint, handler } = schemaLessMutation();
    const request = new Request("https://farm.test/api/mutate", {
      method: "POST",
      body: "{",
    });
    request.headers.delete("content-type");

    const response = await invokeAPIRouteEndpoint(endpoint, request);

    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledWith(undefined);
  });

  it("keeps bodyless QUERY requests with their required JSON content type", async () => {
    const handler = vi.fn(async () => ({ results: [] }));
    const endpoint = createEndpoint({ method: "QUERY" }, async ({ body }) => handler(body));
    const response = await invokeAPIRouteEndpoint(
      endpoint,
      new Request("https://farm.test/api/search", {
        method: "QUERY",
        headers: { "content-type": "application/json" },
      }),
    );

    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledWith(undefined);
  });

  it("rejects an empty declared JSON body before a schema-less handler runs", async () => {
    const { endpoint, handler } = schemaLessMutation();
    const response = await invokeAPIRouteEndpoint(
      endpoint,
      new Request("https://farm.test/api/mutate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid request body",
      message: "The request body is not valid JSON.",
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it("parses an empty declared URL-encoded body as an empty form", async () => {
    const { endpoint, handler } = schemaLessMutation();
    const response = await invokeAPIRouteEndpoint(
      endpoint,
      new Request("https://farm.test/api/mutate", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "",
      }),
    );

    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledOnce();
    const body = handler.mock.calls[0]?.[0];
    expect(body).toEqual({});
    expect(Object.getPrototypeOf(body)).toBeNull();
  });

  it.each([
    ["schema-less", schemaLessMutation],
    ["schema-backed", deleteAccount],
  ])("rejects malformed multipart before a %s handler runs", async (_kind, createMutation) => {
    const { endpoint, handler } = createMutation();
    const response = await invokeAPIRouteEndpoint(
      endpoint,
      new Request("https://farm.test/api/mutate", {
        method: "POST",
        headers: { "content-type": "multipart/form-data; boundary=broken" },
        body: '--broken\r\nContent-Disposition: form-data; name="value"\r\n\r\nmissing close',
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid request body",
      message: "The request body is not valid multipart form data.",
    });
    expect(handler).not.toHaveBeenCalled();
  });
});

describe("cross-site bodies on endpoints with a JSON body schema", () => {
  const crossSite = { origin: "https://evil.example", "sec-fetch-site": "cross-site" };

  function createTodo(handler = vi.fn(async (_title: string) => ({ created: true }))) {
    return {
      handler,
      endpoint: createEndpoint(
        { method: "POST", body: z.object({ title: z.string() }) },
        async ({ body }) => handler(body.title),
      ),
    };
  }

  function post(headers: Record<string, string>, body: BodyInit) {
    return new Request("https://farm.test/api/todos", { method: "POST", headers, body });
  }

  // urlencoded, multipart, and text/plain are CORS "simple" types: a page on another site sends
  // them with the visitor's cookies and without a preflight, and a string-only schema accepts
  // the parsed form as valid input.
  it.each([
    ["application/x-www-form-urlencoded", "title=pwned"],
    ["text/plain", '{"title":"pwned"}'],
  ])("refuses a cross-site %s body before the handler runs", async (contentType, body) => {
    const { endpoint, handler } = createTodo();

    const response = await invokeAPIRouteEndpoint(
      endpoint,
      post({ ...crossSite, "content-type": contentType }, body),
    );

    expect(response.status).toBe(415);
    await expect(response.json()).resolves.toEqual({
      error: "Unsupported Media Type",
      message: expect.stringContaining("multipart()"),
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it("refuses a cross-site multipart body before the handler runs", async () => {
    const { endpoint, handler } = createTodo();
    const form = new FormData();
    form.set("title", "pwned");

    const response = await invokeAPIRouteEndpoint(endpoint, post(crossSite, form));

    expect(response.status).toBe(415);
    expect(handler).not.toHaveBeenCalled();
  });

  it("refuses a form post that names another site only in its Referer", async () => {
    const { endpoint, handler } = createTodo();

    const response = await invokeAPIRouteEndpoint(
      endpoint,
      post(
        {
          referer: "https://evil.example/attack",
          "content-type": "application/x-www-form-urlencoded",
        },
        "title=pwned",
      ),
    );

    expect(response.status).toBe(415);
    expect(handler).not.toHaveBeenCalled();
  });

  it("refuses a cross-site text/plain body when the schema allows no body", async () => {
    const handler = vi.fn(async () => ({ deleted: true }));
    const endpoint = createEndpoint(
      { method: "POST", body: z.object({ reason: z.string() }).optional() },
      async () => handler(),
    );

    const response = await invokeAPIRouteEndpoint(
      endpoint,
      post({ ...crossSite, "content-type": "text/plain" }, "anything"),
    );

    expect(response.status).toBe(415);
    expect(handler).not.toHaveBeenCalled();
  });

  it("still accepts a native form submission from the app's own page", async () => {
    const { endpoint, handler } = createTodo();

    // `<fetcher.Form>` falls back to a native POST to this URL before hydration.
    const response = await invokeAPIRouteEndpoint(
      endpoint,
      post(
        {
          origin: "https://farm.test",
          "sec-fetch-site": "same-origin",
          "content-type": "application/x-www-form-urlencoded",
        },
        "title=native",
      ),
    );

    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledWith("native");
  });

  it("still accepts a form body from a server caller that sends no Origin", async () => {
    const { endpoint, handler } = createTodo();

    // Webhooks such as Slack and Twilio post urlencoded bodies server to server.
    const response = await invokeAPIRouteEndpoint(
      endpoint,
      post({ "content-type": "application/x-www-form-urlencoded" }, "title=webhook"),
    );

    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledWith("webhook");
  });

  it("still accepts a cross-site JSON body, which a browser sends only after a CORS preflight", async () => {
    const { endpoint, handler } = createTodo();

    const response = await invokeAPIRouteEndpoint(
      endpoint,
      post(
        { origin: "https://partner.example", "content-type": "application/json" },
        JSON.stringify({ title: "partner" }),
      ),
    );

    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledWith("partner");
  });

  it("still accepts a cross-site form post to an endpoint that declares form input", async () => {
    const handler = vi.fn(async (_code: string) => ({ signedIn: true }));
    // An OAuth `response_mode=form_post` callback: the provider's page posts the form.
    const endpoint = createEndpoint(
      { method: "POST", body: multipart(z.object({ code: z.string(), state: z.string() })) },
      async ({ body }) => handler(body.code),
    );

    const response = await invokeAPIRouteEndpoint(
      endpoint,
      post(
        {
          origin: "https://appleid.apple.com",
          "sec-fetch-site": "cross-site",
          "content-type": "application/x-www-form-urlencoded",
        },
        "code=abc&state=xyz",
      ),
    );

    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledWith("abc");
  });
});
