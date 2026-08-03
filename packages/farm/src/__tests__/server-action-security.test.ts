// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  ServerActionRequestError,
  createServerActionRequestErrorResponse,
  getServerActionExecutionContext,
  prepareServerActionRequest,
  resolveServerActionsConfig,
  runWithServerActionRequest,
  sanitizeServerActionError,
  validateServerActionRequest,
} from "../server-action-security";
import {
  createServerFnTransportError,
  ServerFnFailure,
  ServerActionError,
} from "../server-fn-error";

const defaultConfig = resolveServerActionsConfig(undefined);

describe("server action security config", () => {
  it("uses same-origin-only and a 1mb body limit by default", () => {
    expect(defaultConfig).toEqual({
      allowedOrigins: [],
      bodySizeLimit: 1_000_000,
    });
  });

  it("parses decimal and binary body size strings", () => {
    expect(resolveServerActionsConfig({ bodySizeLimit: "500kb" }).bodySizeLimit).toBe(500_000);
    expect(resolveServerActionsConfig({ bodySizeLimit: "2 MiB" }).bodySizeLimit).toBe(2_097_152);
  });

  it("normalizes trusted origins and wildcard host patterns", () => {
    expect(
      resolveServerActionsConfig({
        allowedOrigins: ["HTTPS://APP.EXAMPLE.COM/", "*.Proxy.Example.com"],
      }).allowedOrigins,
    ).toEqual(["https://app.example.com", "*.proxy.example.com"]);
  });

  it("rejects unsafe config values", () => {
    expect(() => resolveServerActionsConfig({ bodySizeLimit: 0 })).toThrow("positive safe integer");
    expect(() => resolveServerActionsConfig({ bodySizeLimit: "lots" })).toThrow("size string");
    expect(() =>
      resolveServerActionsConfig({ allowedOrigins: ["https://example.com/path"] }),
    ).toThrow("without paths");
    expect(() => resolveServerActionsConfig({ allowedOrigins: ["*example.com"] })).toThrow(
      "Invalid",
    );
  });
});

describe("validateServerActionRequest", () => {
  it("accepts an exact same-origin request", () => {
    const request = createActionRequest({ origin: "https://app.example.com" });
    expect(() => validateServerActionRequest(request, defaultConfig)).not.toThrow();
  });

  it("accepts trusted proxy origins and wildcard subdomains", () => {
    const exact = createActionRequest({ origin: "https://proxy.example.com" });
    const wildcard = createActionRequest({ origin: "https://edge.proxy.example.com" });
    const config = resolveServerActionsConfig({
      allowedOrigins: ["https://proxy.example.com", "https://*.proxy.example.com"],
    });

    expect(() => validateServerActionRequest(exact, config)).not.toThrow();
    expect(() => validateServerActionRequest(wildcard, config)).not.toThrow();
  });

  it("does not let a wildcard match its root domain or another scheme", () => {
    const config = resolveServerActionsConfig({
      allowedOrigins: ["https://*.proxy.example.com"],
    });

    expect(() =>
      validateServerActionRequest(
        createActionRequest({ origin: "https://proxy.example.com" }),
        config,
      ),
    ).toThrow(ServerActionRequestError);
    expect(() =>
      validateServerActionRequest(
        createActionRequest({ origin: "http://edge.proxy.example.com" }),
        config,
      ),
    ).toThrow(ServerActionRequestError);
  });

  it("matches an explicitly configured default wildcard port", () => {
    const request = createActionRequest({ origin: "https://edge.proxy.example.com" });
    const config = resolveServerActionsConfig({
      allowedOrigins: ["https://*.proxy.example.com:443"],
    });

    expect(() => validateServerActionRequest(request, config)).not.toThrow();
  });

  it("rejects cross-origin, opaque-origin, and protocol-downgrade requests", () => {
    expect(() =>
      validateServerActionRequest(
        createActionRequest({ origin: "https://attacker.example" }),
        defaultConfig,
      ),
    ).toThrow(expect.objectContaining({ code: "INVALID_ORIGIN", status: 403 }));

    expect(() =>
      validateServerActionRequest(createActionRequest({ origin: "null" }), defaultConfig),
    ).toThrow(expect.objectContaining({ code: "INVALID_ORIGIN", status: 403 }));

    expect(() =>
      validateServerActionRequest(
        createActionRequest({ origin: "http://app.example.com" }),
        defaultConfig,
      ),
    ).toThrow(expect.objectContaining({ code: "INVALID_ORIGIN", status: 403 }));
  });

  it("uses Referer when Origin is unavailable", () => {
    const request = createActionRequest({
      origin: null,
      referer: "https://app.example.com/products/1",
    });

    expect(() => validateServerActionRequest(request, defaultConfig)).not.toThrow();
  });

  it("requires browser origin evidence by default", () => {
    const missing = createActionRequest({ origin: null });
    expect(() => validateServerActionRequest(missing, defaultConfig)).toThrow(
      expect.objectContaining({ code: "MISSING_ORIGIN", status: 403 }),
    );

    const fetchMetadata = createActionRequest({
      origin: null,
      fetchSite: "same-origin",
    });
    expect(() => validateServerActionRequest(fetchMetadata, defaultConfig)).not.toThrow();
  });

  it("rejects cross-site Fetch Metadata unless its origin was explicitly trusted", () => {
    const sameOriginMarkedCrossSite = createActionRequest({
      origin: "https://app.example.com",
      fetchSite: "cross-site",
    });
    expect(() => validateServerActionRequest(sameOriginMarkedCrossSite, defaultConfig)).toThrow(
      expect.objectContaining({ code: "INVALID_ORIGIN", status: 403 }),
    );

    const proxy = createActionRequest({
      origin: "https://proxy.example.com",
      fetchSite: "cross-site",
    });
    expect(() =>
      validateServerActionRequest(
        proxy,
        resolveServerActionsConfig({ allowedOrigins: ["https://proxy.example.com"] }),
      ),
    ).not.toThrow();
  });
});

describe("prepareServerActionRequest", () => {
  it("accepts the React JavaScript action content types", async () => {
    const text = createActionRequest({ body: "hello", contentType: "text/plain" });
    await expect(
      prepareServerActionRequest(text, defaultConfig, "javascript", "action-id"),
    ).resolves.toMatchObject({ body: "hello", contentType: "text/plain" });

    const binary = createActionRequest({
      body: "encoded",
      contentType: "application/octet-stream",
    });
    await expect(
      prepareServerActionRequest(binary, defaultConfig, "javascript", "action-id"),
    ).resolves.toMatchObject({ body: "encoded", contentType: "application/octet-stream" });
  });

  it("parses progressive enhancement form bodies after enforcing the limit", async () => {
    const request = createActionRequest({
      body: "name=Ada&role=admin",
      contentType: "application/x-www-form-urlencoded",
    });

    const prepared = await prepareServerActionRequest(request, defaultConfig, "form");
    expect(prepared.body).toBeInstanceOf(FormData);
    expect((prepared.body as FormData).get("name")).toBe("Ada");
    expect((prepared.body as FormData).get("role")).toBe("admin");
  });

  it("rejects unsupported content types and invalid action ids", async () => {
    await expect(
      prepareServerActionRequest(
        createActionRequest({ contentType: "application/json" }),
        defaultConfig,
        "javascript",
        "action-id",
      ),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_CONTENT_TYPE", status: 415 });

    await expect(
      prepareServerActionRequest(createActionRequest({}), defaultConfig, "javascript", ""),
    ).rejects.toMatchObject({ code: "INVALID_ACTION_ID", status: 400 });
  });

  it("rejects a declared body larger than the configured limit", async () => {
    const request = createActionRequest({
      body: "small",
      contentLength: "100",
    });

    await expect(
      prepareServerActionRequest(
        request,
        resolveServerActionsConfig({ bodySizeLimit: 10 }),
        "javascript",
        "action-id",
      ),
    ).rejects.toMatchObject({ code: "BODY_TOO_LARGE", status: 413 });
  });

  it("enforces the body limit while streaming when Content-Length is absent", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("12345"));
        controller.enqueue(encoder.encode("67890"));
        controller.close();
      },
    });
    const request = new Request("https://app.example.com/action", {
      method: "POST",
      headers: {
        "content-type": "text/plain",
        origin: "https://app.example.com",
      },
      body: stream,
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    await expect(
      prepareServerActionRequest(
        request,
        resolveServerActionsConfig({ bodySizeLimit: 9 }),
        "javascript",
        "action-id",
      ),
    ).rejects.toMatchObject({ code: "BODY_TOO_LARGE", status: 413 });
  });

  it("stops before reading an already aborted request", async () => {
    const controller = new AbortController();
    controller.abort(new DOMException("cancelled", "AbortError"));
    const request = createActionRequest({ signal: controller.signal });

    await expect(
      prepareServerActionRequest(request, defaultConfig, "javascript", "action-id"),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("cancels an in-flight body read when the request is aborted", async () => {
    const controller = new AbortController();
    let bodyCancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(streamController) {
        streamController.enqueue(new TextEncoder().encode("partial"));
        return new Promise(() => {});
      },
      cancel() {
        bodyCancelled = true;
      },
    });
    const request = new Request("https://app.example.com/action", {
      method: "POST",
      headers: {
        "content-type": "text/plain",
        origin: "https://app.example.com",
      },
      body: stream,
      duplex: "half",
      signal: controller.signal,
    } as RequestInit & { duplex: "half" });

    const prepared = prepareServerActionRequest(request, defaultConfig, "javascript", "action-id");
    await Promise.resolve();
    controller.abort(new DOMException("cancelled", "AbortError"));

    await expect(prepared).rejects.toMatchObject({ name: "AbortError" });
    expect(bodyCancelled).toBe(true);
  });
});

describe("server action failures and execution context", () => {
  it("returns cache-safe generic request rejection responses", async () => {
    const response = createServerActionRequestErrorResponse(
      new ServerActionRequestError("INVALID_ORIGIN", 403, "attacker.example did not match"),
    );

    expect(response?.status).toBe(403);
    expect(await response?.text()).toBe("Forbidden");
    expect(response?.headers.get("cache-control")).toBe("no-store");
    expect(response?.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("never exposes thrown error messages or properties", () => {
    expect(
      sanitizeServerActionError(
        Object.assign(new Error("database password leaked"), { secret: "top-secret" }),
      ),
    ).toEqual({
      name: "ServerActionError",
      message: "Server function failed",
    });
  });

  it("serializes only explicitly marked server function failures", () => {
    const failure = new ServerFnFailure(
      "NOT_FOUND",
      { id: "product-1" },
      {
        status: 404,
        message: "Product not found",
      },
    );
    const serialized = sanitizeServerActionError(failure);

    expect(serialized).toEqual({
      name: "ServerFnFailure",
      message: "Product not found",
      code: "NOT_FOUND",
      status: 404,
      data: { id: "product-1" },
    });

    const transported = createServerFnTransportError(serialized);
    expect(transported).toBeInstanceOf(ServerFnFailure);
    expect(transported).toMatchObject({
      code: "NOT_FOUND",
      status: 404,
      data: { id: "product-1" },
    });

    const spoofed = sanitizeServerActionError({
      name: "ServerFnFailure",
      message: "leak",
      code: "LEAK",
      status: 400,
      data: { secret: "must-not-cross" },
    });
    expect(spoofed).toEqual({
      name: "ServerActionError",
      message: "Server function failed",
    });
    expect(createServerFnTransportError(spoofed)).toBeInstanceOf(ServerActionError);
  });

  it("makes the request and its cancellation signal available during execution", async () => {
    const controller = new AbortController();
    const request = createActionRequest({ signal: controller.signal });

    await runWithServerActionRequest(request, async () => {
      const context = getServerActionExecutionContext();
      expect(context?.request).toBe(request);
      expect(context?.signal).toBe(request.signal);
      controller.abort();
      expect(context?.signal.aborted).toBe(true);
    });

    expect(getServerActionExecutionContext()).toBeUndefined();
  });
});

function createActionRequest(options: {
  body?: BodyInit;
  contentLength?: string;
  contentType?: string;
  fetchSite?: string;
  origin?: string | null;
  referer?: string;
  signal?: AbortSignal;
}): Request {
  const headers = new Headers({
    "content-type": options.contentType ?? "text/plain",
    host: "app.example.com",
  });
  if (options.origin !== null) {
    headers.set("origin", options.origin ?? "https://app.example.com");
  }
  if (options.referer) headers.set("referer", options.referer);
  if (options.fetchSite) headers.set("sec-fetch-site", options.fetchSite);
  if (options.contentLength) headers.set("content-length", options.contentLength);

  return new Request("https://app.example.com/action", {
    method: "POST",
    headers,
    body: options.body ?? "action-body",
    signal: options.signal,
  });
}
