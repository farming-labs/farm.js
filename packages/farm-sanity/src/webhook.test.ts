import { encodeSignatureHeader, SIGNATURE_HEADER_NAME } from "@sanity/webhook";
import { describe, expect, it, vi } from "vitest";
import {
  createSanityWebhookRoute,
  DEFAULT_SANITY_WEBHOOK_PATH,
  type SanityWebhookInvalidation,
} from "./webhook.js";

const SECRET = "whsec_test";

function fakeInvalidation() {
  const invalidation: SanityWebhookInvalidation = {
    invalidate: vi.fn(),
    revalidatePath: vi.fn(),
  };
  return invalidation;
}

async function signedRequest(payload: unknown, secret = SECRET, method = "POST") {
  const body = JSON.stringify(payload);
  const signature = await encodeSignatureHeader(body, Date.now(), secret);
  return new Request(`http://localhost${DEFAULT_SANITY_WEBHOOK_PATH}`, {
    method,
    headers: { "content-type": "application/json", [SIGNATURE_HEADER_NAME]: signature },
    body,
  });
}

function call(route: ReturnType<typeof createSanityWebhookRoute>, request: Request) {
  return route.handler(request, {} as never);
}

describe("createSanityWebhookRoute", () => {
  it("uses the default path and only accepts POST", () => {
    const route = createSanityWebhookRoute({ secret: SECRET, onChange: () => undefined });

    expect(route.path).toBe(DEFAULT_SANITY_WEBHOOK_PATH);
    expect(route.method).toBe("POST");
    expect(route.rawBody).toBe(true);
  });

  it("honours a custom path", () => {
    const route = createSanityWebhookRoute({
      secret: SECRET,
      path: "/hooks/cms",
      onChange: () => undefined,
    });

    expect(route.path).toBe("/hooks/cms");
  });

  it("rejects a request with no signature", async () => {
    const route = createSanityWebhookRoute({ secret: SECRET, onChange: () => undefined });
    const request = new Request("http://localhost/x", {
      method: "POST",
      body: JSON.stringify({ _type: "post" }),
    });

    const response = await call(route, request);

    expect(response.status).toBe(401);
  });

  it("rejects a signature made with a different secret", async () => {
    const onChange = vi.fn();
    const route = createSanityWebhookRoute({ secret: SECRET, onChange });

    const response = await call(route, await signedRequest({ _type: "post" }, "other-secret"));

    expect(response.status).toBe(401);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("rejects a body that was changed after signing", async () => {
    const route = createSanityWebhookRoute({ secret: SECRET, onChange: () => undefined });
    const signed = await signedRequest({ _type: "post" });
    const tampered = new Request(signed.url, {
      method: "POST",
      headers: signed.headers,
      body: JSON.stringify({ _type: "author" }),
    });

    const response = await call(route, tampered);

    expect(response.status).toBe(401);
  });

  it("returns 400 when the signed body is not JSON", async () => {
    const route = createSanityWebhookRoute({ secret: SECRET, onChange: () => undefined });
    const body = "not json";
    const request = new Request("http://localhost/x", {
      method: "POST",
      headers: { [SIGNATURE_HEADER_NAME]: await encodeSignatureHeader(body, Date.now(), SECRET) },
      body,
    });

    const response = await call(route, request);

    expect(response.status).toBe(400);
  });

  it("hands the parsed payload to onChange", async () => {
    const onChange = vi.fn(() => undefined);
    const route = createSanityWebhookRoute({ secret: SECRET, onChange });
    const payload = { _id: "post.a", _type: "post", slug: "a" };

    await call(route, await signedRequest(payload));

    expect(onChange).toHaveBeenCalledWith(payload);
  });

  it("invalidates every key and path onChange returns", async () => {
    const invalidation = fakeInvalidation();
    const route = createSanityWebhookRoute(
      {
        secret: SECRET,
        onChange: () => ({
          keys: [
            ["sanity", "post", "list"],
            ["sanity", "post", "a"],
          ],
          paths: ["/posts", "/posts/a"],
        }),
      },
      invalidation,
    );

    const response = await call(route, await signedRequest({ _type: "post", slug: "a" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ targets: 4 });
    expect(invalidation.invalidate).toHaveBeenCalledTimes(2);
    expect(invalidation.invalidate).toHaveBeenCalledWith(["sanity", "post", "list"]);
    expect(invalidation.invalidate).toHaveBeenCalledWith(["sanity", "post", "a"]);
    expect(invalidation.revalidatePath).toHaveBeenCalledWith("/posts");
    expect(invalidation.revalidatePath).toHaveBeenCalledWith("/posts/a");
  });

  it("requests a repeated key or path only once", async () => {
    const invalidation = fakeInvalidation();
    const route = createSanityWebhookRoute(
      {
        secret: SECRET,
        onChange: () => ({
          keys: [
            ["sanity", "post", "list"],
            ["sanity", "post", "list"],
          ],
          paths: ["/posts", "/posts"],
        }),
      },
      invalidation,
    );

    const response = await call(route, await signedRequest({ _type: "post" }));

    expect(await response.json()).toEqual({ targets: 2 });
    expect(invalidation.invalidate).toHaveBeenCalledTimes(1);
    expect(invalidation.revalidatePath).toHaveBeenCalledTimes(1);
  });

  it("treats a void return as nothing to invalidate", async () => {
    const invalidation = fakeInvalidation();
    const route = createSanityWebhookRoute(
      { secret: SECRET, onChange: () => undefined },
      invalidation,
    );

    const response = await call(route, await signedRequest({ _type: "system" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ targets: 0 });
    expect(invalidation.invalidate).not.toHaveBeenCalled();
    expect(invalidation.revalidatePath).not.toHaveBeenCalled();
  });

  it("awaits an async onChange", async () => {
    const invalidation = fakeInvalidation();
    const route = createSanityWebhookRoute(
      { secret: SECRET, onChange: async () => ({ paths: ["/posts"] }) },
      invalidation,
    );

    const response = await call(route, await signedRequest({ _type: "post" }));

    expect(await response.json()).toEqual({ targets: 1 });
  });

  it("returns 500 when onChange throws so Sanity retries", async () => {
    const invalidation = fakeInvalidation();
    const route = createSanityWebhookRoute(
      {
        secret: SECRET,
        onChange: () => {
          throw new Error("database down");
        },
      },
      invalidation,
    );

    const response = await call(route, await signedRequest({ _type: "post" }));

    expect(response.status).toBe(500);
    expect(invalidation.invalidate).not.toHaveBeenCalled();
  });

  it("does not leak the error message to the caller", async () => {
    const route = createSanityWebhookRoute({
      secret: SECRET,
      onChange: () => {
        throw new Error("postgres://user:pass@host");
      },
    });

    const response = await call(route, await signedRequest({ _type: "post" }));
    const text = await response.text();

    expect(text).not.toContain("postgres://");
  });
});
