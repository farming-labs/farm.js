// @vitest-environment node

import { createRequire } from "node:module";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { SpanStatusCode } from "@opentelemetry/api";
import { InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { _runWithFarmRequestSpan } from "../tracing";
import {
  configureFarmObservability,
  emitFarmEvent,
  onFarmEvent,
  resetFarmObservability,
  runWithFarmRequestSpan,
  type FarmEvent,
} from "../observability";

const exporter = new InMemorySpanExporter();
const processor = new SimpleSpanProcessor(exporter);
const sdk = new NodeSDK({ spanProcessors: [processor] });

describe("observability", () => {
  beforeAll(() => {
    sdk.start();
  });

  afterEach(() => {
    resetFarmObservability();
    exporter.reset();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  afterAll(async () => {
    await sdk.shutdown();
  });

  it("emits events to config and runtime handlers", () => {
    const configEvents: FarmEvent[] = [];
    const runtimeEvents: FarmEvent[] = [];

    configureFarmObservability({ onEvent: (event) => configEvents.push(event) });
    const unsubscribe = onFarmEvent((event) => runtimeEvents.push(event));

    emitFarmEvent({ type: "cache.hit", key: "product:1" });
    unsubscribe();
    emitFarmEvent({ type: "cache.miss", key: "product:2" });

    expect(configEvents.map((event) => event.type)).toEqual(["cache.hit", "cache.miss"]);
    expect(runtimeEvents.map((event) => event.type)).toEqual(["cache.hit"]);
  });

  it("shares listeners, filters and trace configuration across source, ESM and CJS entries", async () => {
    const esm = await import(
      /* @vite-ignore */ new URL("../../dist/observability.mjs", import.meta.url).href
    );
    const cjs = createRequire(import.meta.url)("../../dist/observability.cjs");
    const events: FarmEvent[] = [];
    const listener = vi.fn();
    const unfiltered = vi.fn();
    configureFarmObservability({
      tracing: true,
      events: ["mcp.tool.complete"],
      onEvent: (event) => {
        events.push(event);
      },
    });
    const dispose = esm.onFarmEvent(listener);
    cjs.onFarmEvent(unfiltered, { unfiltered: true });
    const input = {
      type: "mcp.tool.complete" as const,
      route: "/api/mcp",
      server: "tools",
      tool: "search",
      outcome: "error" as const,
      durationMs: 1,
    };
    await runWithFarmRequestSpan(new Request("https://farm.test/api/mcp"), () => {
      cjs.emitFarmEvent(input);
      return new Response("ok");
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ ...input, traceId: expect.stringMatching(/^[0-9a-f]{32}$/) });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(unfiltered).toHaveBeenCalledTimes(3);
    await processor.forceFlush();
    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0].events.find((event) => event.name === input.type)?.attributes).toMatchObject({
      "farm.tool": "search",
      "farm.outcome": "error",
    });
    dispose();
    emitFarmEvent(input);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(events).toHaveLength(2);
    cjs.resetFarmObservability();
    esm.emitFarmEvent(input);
    expect(events).toHaveLength(2);
    expect(unfiltered).toHaveBeenCalledTimes(4);
    await runWithFarmRequestSpan(
      new Request("https://farm.test/after-reset"),
      () => new Response("ok"),
    );
    await processor.forceFlush();
    expect(exporter.getFinishedSpans()).toHaveLength(1);
    const afterReset = vi.fn();
    onFarmEvent(afterReset);
    cjs.emitFarmEvent({ type: "cache.hit", key: "safe" });
    expect(afterReset).toHaveBeenCalledTimes(1);
  });

  it.each([false, { spans: ["render"] }] as const)(
    "does not parse a tracing URL when request spans are disabled: %j",
    async (tracing) => {
      configureFarmObservability({ tracing });
      const request = new Request("https://farm.test/path?x=1");
      const response = new Response("ok", { status: 201 });
      const NativeURL = globalThis.URL;
      const construct = vi.fn((target, args, newTarget) =>
        Reflect.construct(target, args, newTarget),
      );
      vi.stubGlobal("URL", new Proxy(NativeURL, { construct }));
      const onStart = vi.fn(),
        onComplete = vi.fn(),
        onError = vi.fn();
      const result = await _runWithFarmRequestSpan(request, async () => response, {
        onStart,
        onComplete,
        onError,
      });
      expect(result).toBe(response);
      expect(construct).not.toHaveBeenCalled();
      expect(onStart).toHaveBeenCalledOnce();
      expect(onComplete).toHaveBeenCalledWith(201, expect.any(Number));
      expect(onError).not.toHaveBeenCalled();
      const failure = new Error("handler failure");
      await expect(
        _runWithFarmRequestSpan(
          request,
          () => {
            throw failure;
          },
          { onError },
        ),
      ).rejects.toBe(failure);
      expect(onError).toHaveBeenCalledWith(failure, expect.any(Number));
      expect(construct).not.toHaveBeenCalled();
    },
  );

  it("retains request lifecycle events and status resolution when tracing is off", async () => {
    const events: FarmEvent[] = [];
    configureFarmObservability({ tracing: false, onEvent: (event) => events.push(event) });
    const response = new Response("accepted");
    await runWithFarmRequestSpan(new Request("https://farm.test/rewritten?q=1"), () => response, {
      getStatusCode: () => 202,
    });
    expect(events.map(({ type }) => type)).toEqual(["request.start", "request.complete"]);
    expect(events[1]).toMatchObject({ pathname: "/rewritten", status: 200, method: "GET" });
    await runWithFarmRequestSpan(new Request("https://farm.test/adapter"), () => undefined, {
      getStatusCode: () => 202,
    });
    expect(events[3]).toMatchObject({ pathname: "/adapter", status: 202, method: "GET" });
  });

  it("honors ignored paths and fresh request URLs after tracing is re-enabled", async () => {
    configureFarmObservability({ tracing: false });
    await runWithFarmRequestSpan(new Request("https://farm.test/old"), () => new Response("ok"));
    configureFarmObservability({ tracing: { ignorePaths: ["/ignored"] } });
    await Promise.all([
      runWithFarmRequestSpan(
        new Request("https://farm.test/ignored/path"),
        () => new Response("ignored"),
      ),
      runWithFarmRequestSpan(
        new Request("https://one.test:8443/rewritten?q=1"),
        async () => new Response("one"),
      ),
      runWithFarmRequestSpan(new Request("http://two.test/other"), async () => new Response("two")),
    ]);
    await processor.forceFlush();
    const spans = exporter.getFinishedSpans();
    expect(spans.map(({ name }) => name).sort()).toEqual(["GET /other", "GET /rewritten"]);
    expect(spans.find(({ name }) => name === "GET /rewritten")?.attributes).toMatchObject({
      "url.path": "/rewritten",
      "url.scheme": "https",
      "server.address": "one.test",
      "server.port": 8443,
    });
    expect(spans.find(({ name }) => name === "GET /other")?.attributes).toMatchObject({
      "url.path": "/other",
      "url.scheme": "http",
      "server.address": "two.test",
    });
  });

  it("filters events when event types are configured", () => {
    const events: FarmEvent[] = [];

    configureFarmObservability({
      events: ["ppr.shell.cached"],
      onEvent: (event) => events.push(event),
    });

    emitFarmEvent({ type: "cache.hit", key: "ignored" });
    emitFarmEvent({ type: "ppr.shell.cached", route: "/dashboard", key: "ppr:dashboard" });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "ppr.shell.cached",
      route: "/dashboard",
      level: "info",
    });
  });

  it("allows internal subscribers to receive filtered events without changing user delivery", () => {
    const configEvents: FarmEvent[] = [];
    const runtimeEvents: FarmEvent[] = [];
    const unfilteredEvents: FarmEvent[] = [];

    configureFarmObservability({
      events: ["cache.hit"],
      onEvent: (event) => configEvents.push(event),
    });
    onFarmEvent((event) => runtimeEvents.push(event));
    onFarmEvent((event) => unfilteredEvents.push(event), { unfiltered: true });

    emitFarmEvent({ type: "render.error", error: new Error("render failed") });

    expect(configEvents).toEqual([]);
    expect(runtimeEvents).toEqual([]);
    expect(unfilteredEvents.map((event) => event.type)).toEqual(["render.error"]);
  });

  it("writes compact logs when observability logs are enabled", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    configureFarmObservability({ logs: true });
    emitFarmEvent({
      type: "render.complete",
      route: "/dashboard",
      pathname: "/dashboard",
      status: 200,
      durationMs: 12,
    });

    expect(log).toHaveBeenCalledWith(
      "[farm:info] render.complete route=/dashboard pathname=/dashboard status=200 durationMs=12",
    );
  });

  it("creates correlated request and lifecycle spans with propagated trace context", async () => {
    const events: FarmEvent[] = [];
    configureFarmObservability({
      tracing: true,
      onEvent: (event) => events.push(event),
    });
    const traceId = "0af7651916cd43dd8448eb211c80319c";
    const parentSpanId = "b7ad6b7169203331";

    const response = await runWithFarmRequestSpan(
      new Request("https://farm.test/products/42", {
        headers: { traceparent: `00-${traceId}-${parentSpanId}-01` },
      }),
      async () => {
        emitFarmEvent({
          type: "route.matched",
          pathname: "/products/42",
          route: "/products/:id",
          params: { id: "42" },
        });
        emitFarmEvent({
          type: "middleware.complete",
          route: "/products/:id",
          name: "auth",
          durationMs: 4,
        });
        return new Response("ok", { status: 201 });
      },
    );

    expect(response.status).toBe(201);
    await processor.forceFlush();
    const spans = exporter.getFinishedSpans();
    const requestSpan = spans.find((span) => span.name === "GET /products/:id");
    const middlewareSpan = spans.find((span) => span.name === "farm.middleware auth");
    expect(requestSpan).toBeDefined();
    expect(requestSpan?.spanContext().traceId).toBe(traceId);
    expect(requestSpan?.parentSpanContext?.spanId).toBe(parentSpanId);
    expect(requestSpan?.attributes).toMatchObject({
      "http.request.method": "GET",
      "http.response.status_code": 201,
      "http.route": "/products/:id",
      "url.path": "/products/42",
    });
    expect(requestSpan?.events.map((event) => event.name)).toEqual(
      expect.arrayContaining([
        "request.start",
        "route.matched",
        "middleware.complete",
        "request.complete",
      ]),
    );
    expect(middlewareSpan?.parentSpanContext?.spanId).toBe(requestSpan?.spanContext().spanId);
    expect(events.every((event) => event.traceId === traceId)).toBe(true);
    expect(events.every((event) => Boolean(event.spanId))).toBe(true);
  });

  it("marks errors while tracing even when event delivery is filtered", async () => {
    const delivered: FarmEvent[] = [];
    configureFarmObservability({
      tracing: true,
      events: ["cache.hit"],
      onEvent: (event) => delivered.push(event),
    });

    await expect(
      runWithFarmRequestSpan(new Request("https://farm.test/failure"), async () => {
        emitFarmEvent({
          type: "render.error",
          route: "/failure",
          error: new Error("render failed"),
        });
        throw new Error("request failed");
      }),
    ).rejects.toThrow("request failed");

    await processor.forceFlush();
    const requestSpan = exporter.getFinishedSpans().find((span) => span.name === "GET /failure");
    expect(delivered).toEqual([]);
    expect(requestSpan?.status.code).toBe(SpanStatusCode.ERROR);
    expect(requestSpan?.events.map((event) => event.name)).toContain("render.error");
  });

  it("does not fail the request trace for a recovered render error", async () => {
    configureFarmObservability({ tracing: true });

    await runWithFarmRequestSpan(new Request("https://farm.test/recovered"), async () => {
      emitFarmEvent({
        type: "render.error",
        route: "/recovered",
        error: new Error("an error boundary recovered this"),
      });
      return new Response("ok", { status: 200 });
    });

    await processor.forceFlush();
    const span = exporter.getFinishedSpans().find((s) => s.name === "GET /recovered");
    expect(span).toBeDefined();
    // A 200 response must not be reported as a failed trace just because a
    // render error was caught and recovered by an error boundary mid-stream.
    expect(span?.status.code).not.toBe(SpanStatusCode.ERROR);
    // The error is still recorded on the span for visibility.
    expect(span?.events.map((event) => event.name)).toContain("render.error");
    expect(span?.events.map((event) => event.name)).toContain("exception");
  });

  it("creates completed lifecycle spans outside a request context", async () => {
    configureFarmObservability({ tracing: { spans: ["build"] } });

    const event = emitFarmEvent({
      type: "build.complete",
      target: "server",
      durationMs: 12,
    });

    await processor.forceFlush();
    const buildSpan = exporter.getFinishedSpans().find((span) => span.name === "farm.build server");
    expect(buildSpan).toBeDefined();
    expect(event.traceId).toBe(buildSpan?.spanContext().traceId);
    expect(event.spanId).toBe(buildSpan?.spanContext().spanId);
  });

  it("redacts cache keys from exported span events", async () => {
    configureFarmObservability({ tracing: true });
    await runWithFarmRequestSpan(new Request("https://farm.test/u"), async () => {
      emitFarmEvent({
        type: "cache.hit",
        key: 'unstable_cache:["getUser",["alice@example.com"]]',
        tags: [],
        revalidate: false,
        stale: false,
      });
      return new Response("ok");
    });
    await processor.forceFlush();

    const cacheEvent = exporter
      .getFinishedSpans()
      .flatMap((span) => span.events)
      .find((event) => event.name === "cache.hit");
    expect(cacheEvent).toBeDefined();
    // The raw key (which contains the email argument) must never be exported.
    expect(cacheEvent?.attributes).not.toHaveProperty("farm.key");
    expect(JSON.stringify(cacheEvent?.attributes ?? {})).not.toContain("alice@example.com");
    // A stable digest is exported instead so traces stay correlatable.
    expect(typeof cacheEvent?.attributes?.["farm.key_hash"]).toBe("string");
  });
});
