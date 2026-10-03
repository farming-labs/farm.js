import { describe, expect, it, vi } from "vitest";
import { createStrapiWebhookRoute, type StrapiWebhookInvalidation } from "./webhook.js";
import { DEFAULT_STRAPI_WEBHOOK_PATH, DEFAULT_STRAPI_WEBHOOK_SECRET_HEADER } from "./config.js";

const SECRET = "strapi-webhook-secret";

function fakeInvalidation(): StrapiWebhookInvalidation {
  return { invalidate: vi.fn(), revalidatePath: vi.fn() };
}

function request(payload: unknown, secret = SECRET, header = DEFAULT_STRAPI_WEBHOOK_SECRET_HEADER) {
  return new Request(`http://localhost${DEFAULT_STRAPI_WEBHOOK_PATH}`, {
    method: "POST",
    headers: { "content-type": "application/json", [header]: secret },
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
  });
}

function call(route: ReturnType<typeof createStrapiWebhookRoute>, input: Request) {
  return route.handler(input, {} as never);
}

describe("createStrapiWebhookRoute", () => {
  it("uses the default path and POST method", () => {
    const route = createStrapiWebhookRoute({ secret: SECRET, onChange: () => undefined });

    expect(route.path).toBe(DEFAULT_STRAPI_WEBHOOK_PATH);
    expect(route.method).toBe("POST");
  });

  it("rejects missing or incorrect secrets before parsing the payload", async () => {
    const onChange = vi.fn();
    const route = createStrapiWebhookRoute({ secret: SECRET, onChange });

    const missing = new Request("http://localhost/hook", { method: "POST", body: "not json" });
    expect((await call(route, missing)).status).toBe(401);
    expect((await call(route, request({ event: "entry.update" }, "wrong"))).status).toBe(401);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("supports the custom header Strapi is configured to send", async () => {
    const onChange = vi.fn();
    const route = createStrapiWebhookRoute({
      secret: SECRET,
      secretHeader: "x-strapi-secret",
      onChange,
    });

    const response = await call(
      route,
      request({ event: "entry.publish" }, SECRET, "x-strapi-secret"),
    );

    expect(response.status).toBe(200);
    expect(onChange).toHaveBeenCalledWith({ event: "entry.publish" });
  });

  it("rejects invalid custom header names during configuration", () => {
    expect(() =>
      createStrapiWebhookRoute({
        secret: SECRET,
        secretHeader: "bad header",
        onChange: () => undefined,
      }),
    ).toThrow(/valid HTTP header name/);
  });

  it("rejects malformed and non-object JSON", async () => {
    const route = createStrapiWebhookRoute({ secret: SECRET, onChange: () => undefined });

    expect((await call(route, request("not json"))).status).toBe(400);
    expect((await call(route, request(["entry.update"]))).status).toBe(400);
  });

  it("invalidates distinct query keys and paths", async () => {
    const invalidation = fakeInvalidation();
    const route = createStrapiWebhookRoute(
      {
        secret: SECRET,
        onChange: () => ({
          keys: [
            ["strapi", "articles"],
            ["strapi", "articles"],
            ["strapi", "article", "one"],
          ],
          paths: ["/articles", "/articles", "/articles/one"],
        }),
      },
      invalidation,
    );

    const response = await call(route, request({ event: "entry.publish" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ targets: 4 });
    expect(invalidation.invalidate).toHaveBeenCalledTimes(2);
    expect(invalidation.revalidatePath).toHaveBeenCalledTimes(2);
  });

  it("returns 500 without leaking application errors", async () => {
    const route = createStrapiWebhookRoute({
      secret: SECRET,
      onChange: () => {
        throw new Error("postgres://user:password@host");
      },
    });

    const response = await call(route, request({ event: "entry.publish" }));
    const body = await response.text();

    expect(response.status).toBe(500);
    expect(body).not.toContain("postgres://");
  });
});
