// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { generatePreloadResponseRuntimeSource } from "../nitro/universal-build";
import {
  manageFarmDocumentPreloads,
  manageFarmLinkHeaderPreloads,
  resolveFarmPerformanceConfig,
  type FarmPreloadMode,
} from "../preload";
import { applyFarmCspNonceToResponse, resolveFarmSecurityConfig } from "../security";

function runtime(mode: FarmPreloadMode = "enforce") {
  const config = resolveFarmPerformanceConfig({
    preload: { mode, maxImages: 1, maxFonts: 1 },
  }).preload;
  const report = vi.fn();
  const headerCopies = vi.fn();
  const generated = new Function(
    "manageFarmDocumentPreloads",
    "manageFarmLinkHeaderPreloads",
    "farmPreloadConfig",
    "reportFarmPreloadWarnings",
    "Headers",
    `${generatePreloadResponseRuntimeSource()}; return { getFarmBufferedPreloadMarker, applyFarmPreloadBudget };`,
  )(
    manageFarmDocumentPreloads,
    manageFarmLinkHeaderPreloads,
    config,
    report,
    new Proxy(Headers, {
      construct(target, args) {
        headerCopies();
        return Reflect.construct(target, args);
      },
    }),
  ) as {
    getFarmBufferedPreloadMarker(html: unknown): string;
    applyFarmPreloadBudget(response: Response, pathname: string): Promise<Response>;
  };
  return {
    ...generated,
    config,
    report,
    headerCopies,
    response(html: string, init: ResponseInit = {}) {
      const headers = new Headers(init.headers);
      headers.set("content-type", "text/html; charset=utf-8");
      headers.set("x-farm-preload-buffered", generated.getFarmBufferedPreloadMarker(html));
      return new Response(html, { ...init, headers });
    },
  };
}

describe("production preload response processing", () => {
  it("skips header copies for non-HTML responses without managed markers", async () => {
    const r = runtime();
    const original = Response.json({ ok: true });
    expect(await r.applyFarmPreloadBudget(original, "/api")).toBe(original);
    expect(r.headerCopies).not.toHaveBeenCalled();
    expect(await original.json()).toEqual({ ok: true });
  });

  it.each([undefined, '</alternate>; rel="alternate"'])(
    "reuses unknown HTML streams when header processing is a no-op (%s)",
    async (link) => {
      const r = runtime();
      const cancel = vi.fn();
      const stream = new ReadableStream({ cancel });
      const original = new Response(stream, {
        status: 201,
        statusText: "Created",
        headers: { "content-type": "text/html", ...(link ? { link } : {}) },
      });
      original.headers.append("set-cookie", "first=1; Path=/");
      original.headers.append("set-cookie", "second=2; Path=/");
      const output = await r.applyFarmPreloadBudget(original, "/");
      expect(output).toBe(original);
      expect(r.headerCopies).not.toHaveBeenCalled();
      expect(r.report).toHaveBeenCalledExactlyOnceWith([], "route /");
      expect(output.statusText).toBe("Created");
      expect(output.headers.getSetCookie()).toEqual(["first=1; Path=/", "second=2; Path=/"]);
      expect(original.bodyUsed).toBe(false);
      await output.body!.cancel("navigation");
      expect(cancel).toHaveBeenCalledExactlyOnceWith("navigation");
    },
  );

  it("accepts immutable no-op responses and copies when headers need changing", async () => {
    const r = runtime();
    const immutable = await fetch("data:text/html,<p>immutable</p>");
    expect(() => immutable.headers.set("x-test", "no")).toThrow();
    expect(await r.applyFarmPreloadBudget(immutable, "/")).toBe(immutable);
    expect(r.headerCopies).not.toHaveBeenCalled();
    expect(await immutable.text()).toBe("<p>immutable</p>");

    const original = new Response("html", { headers: { "content-type": "text/html", link: "" } });
    const output = await r.applyFarmPreloadBudget(original, "/");
    expect(output).not.toBe(original);
    expect(original.headers.get("link")).toBe("");
    expect(output.headers.has("link")).toBe(false);
    expect(await output.text()).toBe("html");
  });

  it("still strips unrecognized internal markers from HTML responses", async () => {
    const r = runtime();
    const original = new Response("html", {
      headers: { "content-type": "text/html", "x-farm-preload-buffered": "future" },
    });
    const output = await r.applyFarmPreloadBudget(original, "/");
    expect(output.headers.has("x-farm-preload-buffered")).toBe(false);
    expect(original.headers.get("x-farm-preload-buffered")).toBe("future");
    expect(await output.text()).toBe("html");
  });

  it.each([
    "<p>hello 🌱</p>",
    '<link rel="modulepreload" href="/client.js">',
    '<link rel="stylesheet" href="/app.css">',
  ])("reuses a proven preload-free body: %s", async (html) => {
    const r = runtime();
    const original = r.response(html, {
      status: 201,
      statusText: "Created",
      headers: {
        "content-length": String(Buffer.byteLength(html)),
        link: '</a>; rel="alternate",</b>; rel="alternate"',
        "set-cookie": "a=1; Path=/",
      },
    });
    original.headers.append("set-cookie", "b=2; Path=/");
    const text = vi.spyOn(original, "text");
    const output = await r.applyFarmPreloadBudget(original, "/");
    expect(text).not.toHaveBeenCalled();
    expect(output.body).toBe(original.body);
    expect(original.bodyUsed).toBe(false);
    expect(output.status).toBe(201);
    expect(output.statusText).toBe("Created");
    expect(output.headers.get("content-length")).toBe(String(Buffer.byteLength(html)));
    expect(output.headers.get("link")).toBe(original.headers.get("link"));
    expect(output.headers.getSetCookie()).toEqual(["a=1; Path=/", "b=2; Path=/"]);
    expect(output.headers.has("x-farm-preload-buffered")).toBe(false);
    expect(await output.text()).toBe(html);
  });

  it.each(["enforce", "warn"] as const)(
    "retains header budgets and warnings in %s mode",
    async (mode) => {
      const r = runtime(mode);
      const html = "<p>no hints</p>";
      const link =
        "</ordinary>; rel=preload; as=image, </hero>; rel=preload; as=image; fetchpriority=high, </f1>; rel=preload; as=font, </f2>; rel=preload; as=font";
      const original = r.response(html, { headers: { link } });
      const expected = manageFarmDocumentPreloads(html, link, r.config);
      const output = await r.applyFarmPreloadBudget(original, "/route");
      expect(output.body).toBe(original.body);
      expect(output.headers.get("link")).toBe(expected.linkHeader);
      expect(r.report).toHaveBeenCalledWith(expected.warnings, "route /route");
      expect(await output.text()).toBe(expected.html);
    },
  );

  it.each([
    '<link rel="PrElOaD" as="image" href="/a"><link rel="preload" as="image" href="/b">',
    '<script>"<link rel=preload as=image href=/fake>"</script><link rel=preload as=image href=/real>',
    '<div title="<link rel=preload as=image href=/fake>"><link rel=preload as=image href=/real></div>',
    '<!-- preload --><link rel="preload" as="image" href="/real">',
  ])("keeps full combined parsing for candidate-bearing HTML", async (html) => {
    const r = runtime();
    const link = "</header>; rel=preload; as=image; fetchpriority=high";
    const original = r.response(html, {
      headers: { link, "content-length": String(Buffer.byteLength(html)) },
    });
    const expected = manageFarmDocumentPreloads(html, link, r.config);
    const output = await r.applyFarmPreloadBudget(original, "/");
    expect(original.bodyUsed).toBe(true);
    expect(await output.text()).toBe(expected.html);
    expect(output.headers.get("link") || "").toBe(expected.linkHeader);
    if (expected.html !== html) expect(output.headers.has("content-length")).toBe(false);
  });

  it("does not grant eligibility to unknown bodies", () => {
    const r = runtime();
    expect(r.getFarmBufferedPreloadMarker(undefined)).toBe("1");
    expect(r.getFarmBufferedPreloadMarker({ toString: () => "safe" })).toBe("1");
  });

  it("preserves the existing leading-BOM normalization", async () => {
    const r = runtime();
    const original = r.response("\uFEFF<p>hello</p>");
    const result = await r.applyFarmPreloadBudget(original, "/");
    expect(original.bodyUsed).toBe(true);
    expect(Buffer.from(await result.arrayBuffer()).toString()).toBe("<p>hello</p>");
  });

  it("preserves nonce rewriting without buffering the rewritten stream", async () => {
    const r = runtime();
    const original = r.response("<script>hello()</script><p>🌱</p>");
    const secured = applyFarmCspNonceToResponse(
      original,
      resolveFarmSecurityConfig({
        csp: { policy: "script-src 'self'", nonce: true },
      }),
    );
    const output = await r.applyFarmPreloadBudget(secured, "/");
    expect(output.body).toBe(secured.body);
    const nonce = output.headers.get("content-security-policy")!.match(/'nonce-([^']+)'/)![1];
    expect(await output.text()).toBe(`<script nonce="${nonce}">hello()</script><p>🌱</p>`);
  });

  it("forwards cancellation and late errors without eagerly consuming streams", async () => {
    const r = runtime();
    const cancel = vi.fn();
    const source = new ReadableStream({ cancel });
    const original = new Response(source, {
      headers: {
        "content-type": "text/html",
        "x-farm-preload-streaming": "1",
      },
    });
    const output = await r.applyFarmPreloadBudget(original, "/");
    expect(output.body).toBe(source);
    expect(output.headers.has("x-farm-preload-streaming")).toBe(false);
    await output.body!.cancel("navigation");
    expect(cancel).toHaveBeenCalledWith("navigation");

    let controller!: ReadableStreamDefaultController;
    const errored = new ReadableStream({
      start(value) {
        controller = value;
      },
    });
    const result = await r.applyFarmPreloadBudget(
      new Response(errored, {
        headers: {
          "content-type": "text/html",
          "x-farm-preload-streaming": "1",
        },
      }),
      "/",
    );
    const failure = new Error("late failure");
    controller.error(failure);
    await expect(result.text()).rejects.toBe(failure);
  });

  it("handles empty and non-HTML bodies and retains the legacy buffered fallback", async () => {
    const r = runtime();
    for (const type of ["text/html", "application/json"]) {
      const result = await r.applyFarmPreloadBudget(
        new Response(null, {
          status: 204,
          headers: {
            "content-type": type,
            "x-farm-preload-buffered": "none",
          },
        }),
        "/",
      );
      expect(result.status).toBe(204);
      expect(result.body).toBeNull();
      expect(result.headers.has("x-farm-preload-buffered")).toBe(false);
    }
    const legacy = new Response("<p>legacy</p>", {
      headers: {
        "content-type": "text/html",
        "x-farm-preload-buffered": "1",
      },
    });
    const result = await r.applyFarmPreloadBudget(legacy, "/");
    expect(legacy.bodyUsed).toBe(true);
    expect(await result.text()).toBe("<p>legacy</p>");
  });
});
