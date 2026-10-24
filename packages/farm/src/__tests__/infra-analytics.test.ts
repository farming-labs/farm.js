import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PluginManager } from "../plugin";
import {
  emitFarmEvent,
  configureFarmObservability,
  resetFarmObservability,
} from "../observability";
import { _runWithCurrentRequest } from "../server/request";
import {
  classifyFarmInfraAgent,
  createFarmInfraAnalyticsExporter,
  createFarmInfraAnalyticsPlugin,
  defaultFarmInfraEnvironment,
  farmInfraAnalyticsPlugin,
  farmInfraAnalyticsRecorder,
  resolveFarmInfraAnalytics,
  type FarmInfraAnalyticsEvent,
} from "../plugins/infra-analytics";

const endpoint = "https://infra.example/api/telemetry/v1/events";
const ingestionKey = `fti_${"a".repeat(43)}`;
const apiKey = `farmjs_${"k".repeat(32)}`;
const projectId = "proj_0b8e2c7a-4c2e-4f7e-9a51-3d2f1c0b9e8d";
const options = { endpoint, key: ingestionKey };

const event = (): FarmInfraAnalyticsEvent => ({
  id: crypto.randomUUID(),
  requestId: crypto.randomUUID(),
  kind: "request",
  timestamp: new Date().toISOString(),
  route: "/users/:id",
  method: "GET",
  status: 200,
  durationMs: 5,
  agent: { family: "unknown", category: "unknown", identity: "unknown" },
});

const sentEvents = (send: { mock: { calls: unknown[][] } }) =>
  send.mock.calls.flatMap(
    ([, init]) =>
      JSON.parse((init as RequestInit).body as string).events as FarmInfraAnalyticsEvent[],
  );

describe("Farm Infra link from the environment", () => {
  it("stays off, silently, unless the environment names a project", () => {
    expect(resolveFarmInfraAnalytics({})).toEqual({ off: null });
    // FARMJS_API_KEY alone also authorizes other Infra APIs (site checks), so it isn't a link.
    expect(resolveFarmInfraAnalytics({ FARMJS_API_KEY: apiKey })).toEqual({ off: null });
    const warn = vi.fn();
    expect(createFarmInfraAnalyticsPlugin({ FARMJS_API_KEY: apiKey }, warn)).toBeNull();
    // The build's prerender worker renders pages; those requests aren't traffic.
    expect(
      createFarmInfraAnalyticsPlugin({ FARMJS_API_KEY: ingestionKey, FARM_PRERENDER: "1" }, warn),
    ).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it("links with an API key and project ID, or a write-only key alone", () => {
    expect(
      resolveFarmInfraAnalytics({
        FARMJS_API_KEY: apiKey,
        FARMJS_PROJECT_ID: projectId,
        VERCEL_ENV: "preview",
      }),
    ).toEqual({
      options: {
        endpoint: "https://app.farmjs.dev/api/telemetry/v1/events",
        key: apiKey,
        projectId,
        environment: "staging",
      },
    });
    expect(
      resolveFarmInfraAnalytics({
        FARMJS_API_KEY: ingestionKey,
        FARMJS_API_URL: "http://localhost:3013/",
      }),
    ).toEqual({
      options: { endpoint: "http://localhost:3013/api/telemetry/v1/events", key: ingestionKey },
    });
    expect(
      resolveFarmInfraAnalytics({
        FARMJS_API_KEY: apiKey,
        FARMJS_PROJECT_ID: projectId,
        FARMJS_API_URL: "https://infra.example/ignored?token=x#y",
      }),
    ).toMatchObject({ options: { endpoint } });
  });

  it("warns and stays off for a misconfiguration instead of stopping the app", () => {
    for (const [env, reason] of [
      [{ FARMJS_API_KEY: "preview_key", FARMJS_PROJECT_ID: projectId }, /FARMJS_API_KEY/],
      [{ FARMJS_API_KEY: apiKey, FARMJS_PROJECT_ID: "my-app" }, /FARMJS_PROJECT_ID/],
      [{ FARMJS_API_KEY: ingestionKey, FARMJS_API_URL: "not a url" }, /FARMJS_API_URL/],
      [{ FARMJS_API_KEY: ingestionKey, FARMJS_API_URL: "http://infra.example" }, /HTTPS/],
      [{ FARMJS_API_KEY: ingestionKey, FARMJS_API_URL: "https://u:p@infra.example" }, /HTTPS/],
      [
        { FARMJS_API_KEY: apiKey, FARMJS_PROJECT_ID: projectId, FARMJS_ENVIRONMENT: "qa" },
        /FARMJS_ENVIRONMENT/,
      ],
    ] as const) {
      const warn = vi.fn();
      expect(createFarmInfraAnalyticsPlugin(env, warn)).toBeNull();
      expect(warn).toHaveBeenCalledOnce();
      expect(warn.mock.calls[0]![0]).toMatch(reason);
      expect(warn.mock.calls[0]![0]).not.toContain(apiKey);
    }
  });

  it("defaults the environment from FARMJS_ENVIRONMENT, then Vercel, then NODE_ENV", () => {
    expect(
      defaultFarmInfraEnvironment({ FARMJS_ENVIRONMENT: "staging", VERCEL_ENV: "production" }),
    ).toBe("staging");
    expect(defaultFarmInfraEnvironment({ VERCEL_ENV: "production" })).toBe("production");
    expect(defaultFarmInfraEnvironment({ VERCEL_ENV: "preview", NODE_ENV: "production" })).toBe(
      "staging",
    );
    expect(defaultFarmInfraEnvironment({ VERCEL_ENV: "development" })).toBe("development");
    expect(defaultFarmInfraEnvironment({ NODE_ENV: "production" })).toBe("production");
    expect(defaultFarmInfraEnvironment({ NODE_ENV: "test" })).toBe("development");
  });
});

describe("agent classification", () => {
  it.each([
    ["Mozilla/5.0 (compatible; ChatGPT-User/1.0; +https://openai.com/bot)", "openai", "agent"],
    ["OAI-SearchBot/1.4", "openai", "crawler"],
    ["GPTBot/1.4", "openai", "crawler"],
    ["Claude-User/1.0", "anthropic", "agent"],
    ["Claude-SearchBot/1.0", "anthropic", "crawler"],
    ["ClaudeBot/1.0", "anthropic", "crawler"],
  ])("classifies %s as self-reported, never verified", (ua, family, category) => {
    expect(classifyFarmInfraAgent(ua)).toEqual({ family, category, identity: "self-reported" });
  });

  it.each([
    null,
    "Mozilla/5.0",
    "GPTBot-fake",
    "NotClaudeBot/1",
    "GPTBot/1 ClaudeBot/1",
    "curl/8.0",
  ])("does not guess %s", (ua) => {
    expect(classifyFarmInfraAgent(ua)).toEqual({
      family: "unknown",
      category: "unknown",
      identity: "unknown",
    });
  });
});

describe("runtime plugin", () => {
  const managers: PluginManager[] = [];
  const manager = () => {
    const value = new PluginManager({ config: {}, isDev: true, isProd: false });
    value.addPlugin(farmInfraAnalyticsPlugin(options));
    managers.push(value);
    return value;
  };
  afterEach(async () => {
    await Promise.all(managers.splice(0).map((value) => value.closeRuntime("test")));
    vi.restoreAllMocks();
    resetFarmObservability();
  });

  it("collects only route templates and correlates a tool error under HTTP 200", async () => {
    const send = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 202 }));
    configureFarmObservability({ events: ["request.start"] });
    const value = manager();
    const work: Promise<unknown>[] = [];
    const request = new Request("https://app.example/users/private-customer?secret=private-query", {
      headers: {
        "user-agent": "ChatGPT-User/1.0",
        authorization: "Bearer private-credential",
        cookie: "private-cookie",
      },
    });
    const response = await value.runRuntimeRequest(
      request,
      async (activeRequest) =>
        _runWithCurrentRequest(activeRequest, () => {
          emitFarmEvent({
            type: "mcp.tool.complete",
            tool: "lookup",
            outcome: "error",
            durationMs: 3,
            input: "private-input",
            result: "private-result",
            error: "private-error",
          } as never);
          // A tool name that could carry data is not a tool name.
          emitFarmEvent({
            type: "mcp.tool.complete",
            tool: "lookup?value=private-tool",
            outcome: "success",
            durationMs: 1,
          } as never);
          return new Response("private-body");
        }),
      {
        kind: "api",
        route: { pathname: "/users/private-customer", pattern: "/users/:id" },
        waitUntil: (job) => work.push(job),
      },
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("private-body");
    await Promise.all(work);
    expect(send).toHaveBeenCalledTimes(1);
    const body = send.mock.calls[0]![1]!.body as string;
    const events = sentEvents(send);
    expect(events.map((item) => item.kind)).toEqual(["mcp.tool", "request"]);
    expect(events[0]).toMatchObject({ outcome: "error", tool: "lookup", route: "/users/:id" });
    expect(events[1]).toMatchObject({
      status: 200,
      method: "GET",
      route: "/users/:id",
      agent: { family: "openai", category: "agent", identity: "self-reported" },
    });
    expect(events[0]!.requestId).toBe(events[1]!.requestId);
    expect(body).not.toContain("private-");
    expect(send.mock.calls[0]![0]).toBe(endpoint);
    expect(send.mock.calls[0]![1]).toMatchObject({ method: "POST", redirect: "error" });
  });

  it("keeps correlation for a streamed tool finishing after the response", async () => {
    const send = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 202 }));
    const value = manager();
    const work: Promise<unknown>[] = [];
    let release: () => void = () => {};
    const ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    let completion: Promise<unknown> = Promise.resolve();
    await value.runRuntimeRequest(
      new Request("https://app.example/api/mcp"),
      (request) => {
        completion = _runWithCurrentRequest(request, async () => {
          await ready;
          emitFarmEvent({
            type: "mcp.tool.complete",
            tool: "streamed",
            outcome: "error",
            durationMs: 1,
          } as never);
        });
        return new Response("data: pending\n\n", {
          headers: { "content-type": "text/event-stream" },
        });
      },
      {
        kind: "api",
        route: { pathname: "/api/mcp", pattern: "/api/mcp" },
        waitUntil: (job) => work.push(job),
      },
    );
    release();
    await completion;
    await Promise.all(work);
    const events = sentEvents(send);
    expect(events.map((item) => item.kind)).toEqual(["request", "mcp.tool"]);
    expect(events[0]!.requestId).toBe(events[1]!.requestId);
  });

  it("does not mix app instances, unmatched URLs or unscoped MCP events", async () => {
    const send = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 202 }));
    const first = manager();
    const second = manager();
    await second.startRuntime();
    const work: Promise<unknown>[] = [];
    await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        first.runRuntimeRequest(
          new Request(`https://app.example/${index}?token=private`),
          async (request) =>
            _runWithCurrentRequest(request, async () => {
              await Promise.resolve();
              emitFarmEvent({
                type: "mcp.tool.complete",
                tool: `tool_${index}`,
                outcome: "success",
                durationMs: 1,
              } as never);
              return new Response();
            }),
          {
            kind: "api",
            route: { pathname: `/${index}`, pattern: index ? "//private" : undefined },
            waitUntil: (job) => work.push(job),
          },
        ),
      ),
    );
    emitFarmEvent({
      type: "mcp.tool.complete",
      tool: "unscoped",
      outcome: "success",
      durationMs: 1,
    } as never);
    await Promise.all(work);
    const events = sentEvents(send);
    expect(events).toHaveLength(12);
    expect(new Set(events.map((item) => item.requestId)).size).toBe(6);
    expect(events.every((item) => item.route === "/[unmatched]")).toBe(true);
    await first.closeRuntime("reload");
    await second.closeRuntime("reload");
    emitFarmEvent({
      type: "mcp.tool.complete",
      tool: "closed",
      outcome: "success",
      durationMs: 1,
    } as never);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("never delays a response for the network", async () => {
    let finish: (response: Response) => void = () => {};
    const send = vi.spyOn(globalThis, "fetch").mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const value = manager();
    const work: Promise<unknown>[] = [];
    const result = await value.runRuntimeRequest(
      new Request("https://app.example"),
      () => new Response("ready"),
      { waitUntil: (job) => work.push(job) },
    );
    expect(await result.text()).toBe("ready");
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    finish(new Response(null, { status: 202 }));
    await Promise.all(work);
  });

  it("does not record assets or invent status codes for exceptions", async () => {
    const send = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response());
    const value = manager();
    await value.runRuntimeRequest(
      new Request("https://app.example/asset.js"),
      () => new Response(),
      {
        kind: "asset",
      },
    );
    await expect(
      value.runRuntimeRequest(new Request("https://app.example/error"), () => {
        throw new Error("private");
      }),
    ).rejects.toThrow("private");
    await value.closeRuntime("test");
    expect(send).not.toHaveBeenCalled();
  });

  it("warns once, without the key, when Farm Infra rejects the credentials", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 401 }));
    const warn = vi.fn();
    const plugin = createFarmInfraAnalyticsPlugin(
      { FARMJS_API_KEY: apiKey, FARMJS_PROJECT_ID: projectId },
      warn,
    );
    const value = new PluginManager({ config: {}, isDev: false, isProd: true });
    value.addPlugin(plugin!);
    managers.push(value);
    const work: Promise<unknown>[] = [];
    for (let i = 0; i < 2; i++) {
      await value.runRuntimeRequest(new Request("https://app.example"), () => new Response(), {
        waitUntil: (job) => work.push(job),
      });
      await Promise.all(work);
    }
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]![0]).toMatch(/answered 401/);
    expect(warn.mock.calls[0]![0]).not.toContain(apiKey);
  });
});

describe("recorder for servers without a plugin runtime", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reports the route template, method and status, not the URL", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 202 }));
    const recorder = farmInfraAnalyticsRecorder(options, send);
    const work: Promise<unknown>[] = [];
    const response = await recorder.record(
      new Request("https://app.example/users/private-customer?secret=private-query", {
        method: "POST",
        headers: { "user-agent": "GPTBot/1.4", cookie: "private-cookie" },
      }),
      { kind: "page", route: { pattern: "/users/[id]" } },
      (job) => work.push(job),
      async () => new Response("private-body", { status: 201 }),
    );
    expect(await response.text()).toBe("private-body");
    await Promise.all(work);
    const body = send.mock.calls[0]![1]!.body as string;
    expect(body).not.toContain("private");
    expect(sentEvents(send)).toEqual([
      expect.objectContaining({
        kind: "request",
        route: "/users/[id]",
        method: "POST",
        status: 201,
        agent: { family: "openai", category: "crawler", identity: "self-reported" },
      }),
    ]);
    await recorder.close();
  });

  it("skips assets, keeps exceptions unreported, and flushes on close without waitUntil", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 202 }));
    const recorder = farmInfraAnalyticsRecorder(options, send);
    await recorder.record(
      new Request("https://app.example/a.js"),
      { kind: "asset" },
      undefined,
      async () => new Response(),
    );
    await expect(
      recorder.record(new Request("https://app.example/x"), {}, undefined, async () => {
        throw new Error("private");
      }),
    ).rejects.toThrow("private");
    expect(send).not.toHaveBeenCalled();
    await recorder.record(
      new Request("https://app.example/nope"),
      {},
      undefined,
      async () => new Response(null, { status: 404 }),
    );
    await recorder.close();
    expect(sentEvents(send)).toEqual([
      expect.objectContaining({ route: "/[unmatched]", status: 404 }),
    ]);
  });

  it("ties each MCP tool call to its request, even one an API route rewrote", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 202 }));
    const recorder = farmInfraAnalyticsRecorder(options, send);
    const work: Promise<unknown>[] = [];
    const tool = (name: string, outcome: "success" | "error") =>
      emitFarmEvent({
        type: "mcp.tool.complete",
        route: "/api/mcp",
        server: "store",
        tool: name,
        outcome,
        durationMs: 4,
      });
    const request = new Request("https://app.example/api/mcp", {
      method: "POST",
      headers: { "user-agent": "Claude-User/1.0" },
    });
    await recorder.record(
      request,
      { route: { pattern: "/api/mcp" } },
      (job) => work.push(job),
      () =>
        // The route handles a copy of the request, as API routes may.
        _runWithCurrentRequest(new Request(request), async () => {
          await Promise.resolve();
          tool("list_orders", "success");
          tool("refund_order", "error");
          return new Response("{}");
        }),
    );
    // Outside any request, and after close, a tool call isn't reported.
    tool("outside", "success");
    await Promise.all(work);
    await recorder.close();
    tool("after_close", "success");
    const events = sentEvents(send);
    const recorded = events.find(({ kind }) => kind === "request")!;
    expect(events.filter(({ kind }) => kind === "mcp.tool")).toEqual(
      ["list_orders:success", "refund_order:error"].map((call) =>
        expect.objectContaining({
          tool: call.split(":")[0],
          outcome: call.split(":")[1],
          requestId: recorded.requestId,
          route: "/api/mcp",
          agent: { family: "anthropic", category: "agent", identity: "self-reported" },
        }),
      ),
    );
  });
});

describe("bounded sender", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends at most 50 per batch, coalesces flushes and keeps at most 500 events", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 202 }));
    const onDiagnostic = vi.fn();
    const exporter = createFarmInfraAnalyticsExporter({ ...options, onDiagnostic }, send);
    for (let i = 0; i < 560; i++) exporter.enqueue(event());
    const first = exporter.flush();
    expect(exporter.flush()).toBe(first);
    await vi.runAllTimersAsync();
    await first;
    expect(send).toHaveBeenCalledTimes(10);
    expect(onDiagnostic).toHaveBeenCalledTimes(60);
    for (const [, init] of send.mock.calls) {
      expect(JSON.parse(init!.body as string).events).toHaveLength(50);
      expect(init!.headers).toEqual({
        "content-type": "application/json",
        authorization: `Bearer ${ingestionKey}`,
      });
    }
    await exporter.close();
    exporter.enqueue(event());
    await exporter.flush();
    expect(send).toHaveBeenCalledTimes(10);
  });

  it("names the project and environment for an API key", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 202 }));
    const exporter = createFarmInfraAnalyticsExporter(
      { endpoint, key: apiKey, projectId, environment: "staging" },
      send,
    );
    exporter.enqueue(event());
    const flushed = exporter.flush();
    await vi.runAllTimersAsync();
    await flushed;
    expect(send.mock.calls[0]![1]!.headers).toEqual({
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
      "x-farm-project": projectId,
      "x-farm-environment": "staging",
    });
    await exporter.close();
  });

  it("honors Retry-After without holding the request lifetime open", async () => {
    const send = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(null, { status: 429, headers: { "retry-after": "3600" } }),
      )
      .mockResolvedValue(new Response(null, { status: 202 }));
    const exporter = createFarmInfraAnalyticsExporter(options, send);
    exporter.enqueue(event());
    const first = exporter.flush();
    await vi.runAllTimersAsync();
    await first;
    await exporter.flush();
    expect(send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3_600_000);
    const fresh = event();
    exporter.enqueue(fresh);
    const second = exporter.flush();
    await vi.runAllTimersAsync();
    await second;
    expect(send).toHaveBeenCalledTimes(2);
    expect(JSON.parse(send.mock.calls[1]![1]!.body as string).events).toEqual([fresh]);
    await exporter.close();
  });

  it("keeps IDs stable across a transient failure", async () => {
    const at = new Date(Date.now() + 2000).toUTCString();
    const send = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 503, headers: { "retry-after": at } }))
      .mockResolvedValue(new Response(null, { status: 202 }));
    const exporter = createFarmInfraAnalyticsExporter(options, send);
    exporter.enqueue(event());
    const flushing = exporter.flush();
    await vi.advanceTimersByTimeAsync(1000);
    expect(send).toHaveBeenCalledTimes(1);
    await vi.runAllTimersAsync();
    await flushing;
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0]![1]!.body).toBe(send.mock.calls[1]![1]!.body);
    await exporter.close();
  });

  it.each([400, 401, 403, 404, 413, 415, 302])(
    "stops sending for a rejected credential or configuration (%s)",
    async (status) => {
      const send = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status }));
      const exporter = createFarmInfraAnalyticsExporter(options, send);
      exporter.enqueue(event());
      const flushing = exporter.flush();
      await vi.runAllTimersAsync();
      await flushing;
      exporter.enqueue(event());
      await exporter.flush();
      await exporter.close();
      expect(send).toHaveBeenCalledTimes(1);
    },
  );

  it("never reads the receiver's response body", async () => {
    const cancelled = vi.fn();
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("private-receiver-secret"));
        },
        cancel: cancelled,
      }),
      { status: 503, headers: { "retry-after": "3600" } },
    );
    const readers = [vi.spyOn(response, "text"), vi.spyOn(response, "json")];
    const onDiagnostic = vi.fn();
    const exporter = createFarmInfraAnalyticsExporter(
      { ...options, onDiagnostic },
      vi.fn<typeof fetch>().mockResolvedValue(response),
    );
    exporter.enqueue(event());
    const flushing = exporter.flush();
    await vi.runAllTimersAsync();
    await flushing;
    expect(cancelled).toHaveBeenCalledOnce();
    for (const reader of readers) expect(reader).not.toHaveBeenCalled();
    expect(onDiagnostic.mock.calls).toEqual([[{ code: "retry", status: 503 }]]);
    await exporter.close();
  });

  it("limits retries and absorbs observer failures", async () => {
    const send = vi.fn<typeof fetch>().mockRejectedValue(new Error("network"));
    const exporter = createFarmInfraAnalyticsExporter(
      {
        ...options,
        onDiagnostic: async () => {
          throw new Error("observer");
        },
      },
      send,
    );
    exporter.enqueue(event());
    for (let i = 0; i < 8; i++) {
      const flushing = exporter.flush();
      await vi.runAllTimersAsync();
      await flushing;
      await vi.advanceTimersByTimeAsync(30_000);
    }
    expect(send).toHaveBeenCalledTimes(5);
    await exporter.close();
  });

  it("times out slow sends within the flush budget", async () => {
    const send = vi.fn<typeof fetch>().mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init!.signal!.addEventListener("abort", () => reject(new Error("timeout")), {
            once: true,
          });
        }),
    );
    const exporter = createFarmInfraAnalyticsExporter(options, send);
    exporter.enqueue(event());
    const startedAt = Date.now();
    const flushing = exporter.flush();
    await vi.runAllTimersAsync();
    await flushing;
    expect(Date.now() - startedAt).toBeLessThanOrEqual(5000);
    expect(send).toHaveBeenCalledTimes(2);
    const closed = exporter.close();
    await vi.runAllTimersAsync();
    await closed;
  });

  it("does not drop arrivals when an older batch completes", async () => {
    let finish: (response: Response) => void = () => {};
    const send = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValue(new Response(null, { status: 202 }));
    const exporter = createFarmInfraAnalyticsExporter(options, send);
    exporter.enqueue(event());
    const flushing = exporter.flush();
    await vi.advanceTimersByTimeAsync(25);
    const recent = event();
    exporter.enqueue(recent);
    finish(new Response(null, { status: 202 }));
    await vi.runAllTimersAsync();
    await flushing;
    expect(send).toHaveBeenCalledTimes(2);
    expect(JSON.parse(send.mock.calls[1]![1]!.body as string).events).toEqual([recent]);
    await exporter.close();
  });
});
