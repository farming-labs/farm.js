// @vitest-environment node

import { NodeSDK } from "@opentelemetry/sdk-node";
import { SpanStatusCode } from "@opentelemetry/api";
import { InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
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
});
