import { describe, expect, it, vi } from "vitest";
import { emitFarmEvent } from "@farm.js/core/observability";
import {
  buildSentryInitOptions,
  isErrorEvent,
  registerSentry,
  sentryPlugin,
  spanNameFor,
  type SentryClientLike,
  type SentryScopeLike,
  type SentrySpanLike,
} from "./index";

interface RecordedSpan extends SentrySpanLike {
  name: string;
  forceTransaction?: boolean;
  ended: number;
  statuses: { code: number }[];
}

function createFakeClient() {
  const spans: RecordedSpan[] = [];
  const captured: unknown[] = [];
  const tags: Record<string, string> = {};
  const contexts: Record<string, unknown> = {};
  const inits: Record<string, unknown>[] = [];
  let flushes = 0;

  const client: SentryClientLike = {
    init(options) {
      inits.push(options);
    },
    captureException(error) {
      captured.push(error);
      return "event-id";
    },
    withScope(callback) {
      const scope: SentryScopeLike = {
        setTag(key, value) {
          tags[key] = value;
        },
        setContext(key, value) {
          contexts[key] = value;
        },
      };
      return callback(scope);
    },
    startInactiveSpan({ name, forceTransaction }) {
      const span: RecordedSpan = {
        name,
        forceTransaction,
        ended: 0,
        statuses: [],
        end() {
          span.ended += 1;
        },
        setStatus(status) {
          span.statuses.push(status);
        },
      };
      spans.push(span);
      return span;
    },
    async flush() {
      flushes += 1;
      return true;
    },
  };

  return {
    client,
    spans,
    captured,
    tags,
    contexts,
    inits,
    get flushes() {
      return flushes;
    },
  };
}

/** Builds the plugin plus its setup state, the way the plugin manager would. */
function createPlugin(options: Parameters<typeof sentryPlugin>[0] = {}) {
  const plugin = sentryPlugin(options);
  const state = plugin.setup?.({} as never) as ReturnType<
    NonNullable<ReturnType<typeof sentryPlugin>["setup"]>
  >;
  return { plugin, state };
}

function runtimeEvent(overrides: Record<string, unknown> = {}) {
  return {
    request: new Request("https://example.com/users/42"),
    route: { pathname: "/users/42", pattern: "/users/[id]" },
    kind: "page",
    waitUntil: vi.fn(),
    ...overrides,
  };
}

describe("spanNameFor", () => {
  it("prefers the route pattern so span names stay low cardinality", () => {
    expect(spanNameFor("GET", { pathname: "/users/42", pattern: "/users/[id]" }, "/users/42")).toBe(
      "GET /users/[id]",
    );
  });

  it("falls back to the pathname when there is no pattern", () => {
    expect(spanNameFor("POST", { pathname: "/webhook", pattern: null }, "/webhook")).toBe(
      "POST /webhook",
    );
    expect(spanNameFor("GET", undefined, "/health")).toBe("GET /health");
  });
});

describe("buildSentryInitOptions", () => {
  it("keeps PII off unless the application opts in", () => {
    expect(buildSentryInitOptions({ dsn: "https://key@example.com/1" })).toMatchObject({
      sendDefaultPii: false,
    });
    expect(buildSentryInitOptions({ sendDefaultPii: true })).toMatchObject({
      sendDefaultPii: true,
    });
  });

  it("merges sentryOptions, with explicit options winning", () => {
    const built = buildSentryInitOptions({
      dsn: "explicit",
      sentryOptions: { debug: true, dsn: "passthrough", ignoreErrors: ["x"] },
    });

    expect(built).toMatchObject({ debug: true, ignoreErrors: ["x"], dsn: "explicit" });
  });

  it("does not let an unset option clobber a passthrough key", () => {
    // `release` is undefined here, so the passthrough value has to survive.
    expect(buildSentryInitOptions({ sentryOptions: { release: "v1" } })).toMatchObject({
      release: "v1",
    });
  });

  it("falls back to the instrumentation mode for the environment", () => {
    expect(buildSentryInitOptions({}, { mode: "production" })).toMatchObject({
      environment: "production",
    });
    expect(
      buildSentryInitOptions({ environment: "staging" }, { mode: "production" }),
    ).toMatchObject({ environment: "staging" });
  });
});

describe("registerSentry", () => {
  const nodeContext = { root: "/app", mode: "production", runtime: "nodejs" } as const;

  it("initializes the client and returns a cleanup that flushes", async () => {
    const fake = createFakeClient();
    const cleanup = await registerSentry({ client: fake.client, dsn: "dsn" })(nodeContext);

    expect(fake.inits).toHaveLength(1);
    expect(fake.inits[0]).toMatchObject({ dsn: "dsn", environment: "production" });

    expect(typeof cleanup).toBe("function");
    await (cleanup as () => Promise<void>)();
    expect(fake.flushes).toBe(1);
  });

  it("does nothing on runtimes the Node SDK cannot run on", async () => {
    const fake = createFakeClient();

    for (const runtime of ["edge", "bun"] as const) {
      const cleanup = await registerSentry({ client: fake.client })({ ...nodeContext, runtime });
      expect(cleanup).toBeUndefined();
    }

    expect(fake.inits).toHaveLength(0);
  });

  it("does nothing when disabled", async () => {
    const fake = createFakeClient();
    await registerSentry({ client: fake.client, enabled: false })(nodeContext);
    expect(fake.inits).toHaveLength(0);
  });
});

describe("sentryPlugin runtime hooks", () => {
  it("opens a span per request and closes it on the response", async () => {
    const fake = createFakeClient();
    const { plugin, state } = createPlugin({ client: fake.client });

    const event = runtimeEvent();
    const ctx = plugin.runtime?.context?.({ ...event, state } as never) as {
      sentry: { span?: SentrySpanLike; ended: boolean };
    };

    expect(fake.spans).toHaveLength(1);
    expect(fake.spans[0]!.name).toBe("GET /users/[id]");
    // Orphan spans are dropped, so the request span has to be a transaction.
    expect(fake.spans[0]!.forceTransaction).toBe(true);

    await plugin.runtime?.after?.({
      ...event,
      ctx,
      state,
      response: new Response(null, { status: 200 }),
      durationMs: 5,
    } as never);

    expect(fake.spans[0]!.ended).toBe(1);
    expect(fake.spans[0]!.statuses).toEqual([{ code: 1 }]);
  });

  it("marks the span as an error for a 5xx response", async () => {
    const fake = createFakeClient();
    const { plugin, state } = createPlugin({ client: fake.client });

    const event = runtimeEvent();
    const ctx = plugin.runtime?.context?.({ ...event, state } as never);

    await plugin.runtime?.after?.({
      ...event,
      ctx,
      state,
      response: new Response(null, { status: 503 }),
      durationMs: 5,
    } as never);

    expect(fake.spans[0]!.statuses).toEqual([{ code: 2 }]);
  });

  it("captures the error with route and request context", async () => {
    const fake = createFakeClient();
    const { plugin, state } = createPlugin({ client: fake.client });

    const event = runtimeEvent();
    const ctx = plugin.runtime?.context?.({ ...event, state } as never);
    const failure = new Error("boom");

    await plugin.runtime?.error?.({ ...event, ctx, state, error: failure, durationMs: 9 } as never);

    expect(fake.captured).toEqual([failure]);
    expect(fake.tags).toMatchObject({ "farm.route": "/users/[id]", "farm.kind": "page" });
    expect(fake.contexts.request).toMatchObject({ method: "GET", path: "/users/42" });
    expect(fake.spans[0]!.ended).toBe(1);
    expect(fake.spans[0]!.statuses).toEqual([{ code: 2 }]);
  });

  it("ends the span once when an error is followed by a response", async () => {
    const fake = createFakeClient();
    const { plugin, state } = createPlugin({ client: fake.client });

    const event = runtimeEvent();
    const ctx = plugin.runtime?.context?.({ ...event, state } as never);

    await plugin.runtime?.error?.({
      ...event,
      ctx,
      state,
      error: new Error("boom"),
      durationMs: 9,
    } as never);
    await plugin.runtime?.after?.({
      ...event,
      ctx,
      state,
      response: new Response(null, { status: 500 }),
      durationMs: 9,
    } as never);

    expect(fake.spans[0]!.ended).toBe(1);
  });

  it("flushes inside the request when flushOnResponse is set", async () => {
    const fake = createFakeClient();
    const { plugin, state } = createPlugin({ client: fake.client, flushOnResponse: true });

    const event = runtimeEvent();
    const ctx = plugin.runtime?.context?.({ ...event, state } as never);

    await plugin.runtime?.after?.({
      ...event,
      ctx,
      state,
      response: new Response(null, { status: 200 }),
      durationMs: 5,
    } as never);

    // Handed to waitUntil so the host keeps the process alive for the flush.
    expect(event.waitUntil).toHaveBeenCalledTimes(1);
    await (event.waitUntil.mock.calls[0]![0] as Promise<unknown>);
    expect(fake.flushes).toBe(1);
  });

  it("does not flush per response by default", async () => {
    const fake = createFakeClient();
    const { plugin, state } = createPlugin({ client: fake.client });

    const event = runtimeEvent();
    const ctx = plugin.runtime?.context?.({ ...event, state } as never);

    await plugin.runtime?.after?.({
      ...event,
      ctx,
      state,
      response: new Response(null, { status: 200 }),
      durationMs: 5,
    } as never);

    expect(event.waitUntil).not.toHaveBeenCalled();
    expect(fake.flushes).toBe(0);
  });

  it("flushes on shutdown", async () => {
    const fake = createFakeClient();
    const { plugin, state } = createPlugin({ client: fake.client });

    await plugin.runtime?.close?.({ state, reason: "sigterm" } as never);

    expect(fake.flushes).toBe(1);
  });

  it("reports nothing when disabled but still returns a usable context", async () => {
    const fake = createFakeClient();
    const { plugin, state } = createPlugin({ client: fake.client, enabled: false });

    const event = runtimeEvent();
    const ctx = plugin.runtime?.context?.({ ...event, state } as never) as {
      sentry: { span?: SentrySpanLike };
    };

    expect(ctx.sentry.span).toBeUndefined();
    expect(fake.spans).toHaveLength(0);

    await plugin.runtime?.error?.({
      ...event,
      ctx,
      state,
      error: new Error("boom"),
      durationMs: 1,
    } as never);
    expect(fake.captured).toHaveLength(0);
  });

  it("captures without a scope when the client does not support one", async () => {
    const fake = createFakeClient();
    const client: SentryClientLike = { ...fake.client, withScope: undefined };
    const { plugin, state } = createPlugin({ client });

    const event = runtimeEvent();
    const ctx = plugin.runtime?.context?.({ ...event, state } as never);
    const failure = new Error("boom");

    await plugin.runtime?.error?.({ ...event, ctx, state, error: failure, durationMs: 1 } as never);

    expect(fake.captured).toEqual([failure]);
  });
});

describe("isErrorEvent", () => {
  it("matches error bearing events and ignores the rest", () => {
    expect(isErrorEvent({ type: "render.error", error: new Error("x") } as never)).toBe(true);
    expect(isErrorEvent({ type: "error", error: new Error("x") } as never)).toBe(true);
    expect(isErrorEvent({ type: "request.error", error: new Error("x") } as never)).toBe(true);

    expect(isErrorEvent({ type: "render.complete" } as never)).toBe(false);
    expect(isErrorEvent({ type: "cache.hit", key: "a" } as never)).toBe(false);
    // An error shaped type with nothing attached is not reportable.
    expect(isErrorEvent({ type: "render.error" } as never)).toBe(false);
  });
});

describe("sentryPlugin observability stream", () => {
  it("captures errors Farm handles internally, which never reach runtime.error", async () => {
    const fake = createFakeClient();
    const { plugin, state } = createPlugin({ client: fake.client });

    await plugin.runtime?.start?.({ state } as never);

    // A page that throws during render becomes this event plus a 500 response.
    const failure = new Error("render blew up");
    emitFarmEvent({ type: "render.error", route: "/users/[id]", error: failure } as never);

    expect(fake.captured).toEqual([failure]);
    expect(fake.tags).toMatchObject({
      "farm.event": "render.error",
      "farm.route": "/users/[id]",
    });

    await plugin.runtime?.close?.({ state, reason: "test" } as never);
  });

  it("reports an error once when it arrives from both paths", async () => {
    const fake = createFakeClient();
    const { plugin, state } = createPlugin({ client: fake.client });

    await plugin.runtime?.start?.({ state } as never);

    const failure = new Error("boom");
    emitFarmEvent({ type: "request.error", error: failure } as never);

    const event = runtimeEvent();
    const ctx = plugin.runtime?.context?.({ ...event, state } as never);
    await plugin.runtime?.error?.({ ...event, ctx, state, error: failure, durationMs: 3 } as never);

    expect(fake.captured).toEqual([failure]);

    await plugin.runtime?.close?.({ state, reason: "test" } as never);
  });

  it("ignores events that are not errors", async () => {
    const fake = createFakeClient();
    const { plugin, state } = createPlugin({ client: fake.client });

    await plugin.runtime?.start?.({ state } as never);
    emitFarmEvent({ type: "render.complete", route: "/", durationMs: 1 } as never);

    expect(fake.captured).toHaveLength(0);
    await plugin.runtime?.close?.({ state, reason: "test" } as never);
  });

  it("stops listening after close", async () => {
    const fake = createFakeClient();
    const { plugin, state } = createPlugin({ client: fake.client });

    await plugin.runtime?.start?.({ state } as never);
    await plugin.runtime?.close?.({ state, reason: "test" } as never);

    emitFarmEvent({ type: "render.error", error: new Error("late") } as never);
    expect(fake.captured).toHaveLength(0);
  });
});

describe("sentryPlugin build hooks", () => {
  it("enables source maps only when asked", () => {
    const withMaps = createPlugin({ sourceMaps: true });
    expect(
      withMaps.plugin.build?.configure?.({ preset: "node-server" }, {
        state: withMaps.state,
      } as never),
    ).toMatchObject({ preset: "node-server", sourceMap: true });

    const withoutMaps = createPlugin({});
    expect(
      withoutMaps.plugin.build?.configure?.({ preset: "node-server" }, {
        state: withoutMaps.state,
      } as never),
    ).toBeUndefined();
  });
});
