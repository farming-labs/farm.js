import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PluginManager } from "../plugin";
import {
  _withFarmToolCallPayload,
  emitFarmEvent,
  configureFarmObservability,
  onFarmEvent,
  resetFarmObservability,
} from "../observability";
import { _runWithCurrentRequest } from "../server/request";
import { setFarmBasePath } from "../base-path";
import {
  classifyFarmInfraAgent,
  createFarmInfraAnalyticsExporter,
  createFarmInfraAnalyticsPlugin,
  createFarmInfraAnalyticsRecorder,
  defaultFarmInfraEnvironment,
  farmInfraAnalyticsPlugin,
  farmInfraAnalyticsRecorder,
  resolveFarmInfraAnalytics,
  _farmWebMCPReportsEnabled,
  FARM_WEBMCP_REPORT_PATH,
  type FarmInfraAnalyticsEvent,
} from "../plugins/infra-analytics";
import { setFarmRouteLabel } from "../route-label";

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

// MCP's Streamable HTTP transport: an initialize POST, then calls carrying the session ID.
const MCP_HEADERS = {
  "user-agent": "node",
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
};
const initialize = (name: unknown) =>
  JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name, version: "1" } },
  });
const toolsCall = JSON.stringify({
  jsonrpc: "2.0",
  id: 2,
  method: "tools/call",
  params: { name: "search_docs", arguments: {} },
});
const CURSOR = {
  family: "other",
  category: "harness",
  identity: "self-reported",
  name: "Cursor",
} as const;
/** A stateless MCP server: reads the whole body, answers JSON, and calls a tool for tools/call. */
const mcpServer = (headers: HeadersInit = {}, status = 200) =>
  vi.fn(async (request: Request) => {
    const body = await request.text();
    return _runWithCurrentRequest(request, () => {
      if (body.includes('"tools/call"'))
        emitFarmEvent({
          type: "mcp.tool.complete",
          tool: "search_docs",
          outcome: "success",
          durationMs: 2,
        } as never);
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { body } }), {
        status,
        headers: { "content-type": "application/json", ...headers },
      });
    });
  });

const sentEvents = (send: { mock: { calls: unknown[][] } }) =>
  send.mock.calls.flatMap(
    ([, init]) =>
      JSON.parse((init as RequestInit).body as string).events as FarmInfraAnalyticsEvent[],
  );

describe("Farm Infra link from the environment", () => {
  it("stays off, silently, without a key or while prerendering", () => {
    expect(resolveFarmInfraAnalytics({})).toEqual({ off: null });
    expect(resolveFarmInfraAnalytics({ FARMJS_PROJECT_ID: projectId })).toEqual({ off: null });
    const warn = vi.fn();
    expect(createFarmInfraAnalyticsPlugin({ FARMJS_PROJECT_ID: projectId }, warn)).toBeNull();
    expect(
      createFarmInfraAnalyticsPlugin({ FARMJS_API_KEY: apiKey, FARM_PRERENDER: "1" }, warn),
    ).toBeNull();
    // The build's prerender worker renders pages; those requests aren't traffic.
    expect(
      createFarmInfraAnalyticsPlugin({ FARMJS_API_KEY: ingestionKey, FARM_PRERENDER: "1" }, warn),
    ).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it("links with an API key alone, naming its environment", () => {
    // Farm Infra resolves the project of a key scoped to exactly one.
    expect(resolveFarmInfraAnalytics({ FARMJS_API_KEY: apiKey, NODE_ENV: "production" })).toEqual({
      options: {
        endpoint: "https://app.farmjs.dev/api/telemetry/v1/events",
        key: apiKey,
        environment: "production",
      },
    });
    const warn = vi.fn();
    expect(createFarmInfraAnalyticsPlugin({ FARMJS_API_KEY: apiKey }, warn)).not.toBeNull();
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
      // A switch for what leaves the app sends nothing until it reads on or off.
      [{ FARMJS_API_KEY: ingestionKey, FARMJS_TOOL_PAYLOADS: "false" }, /FARMJS_TOOL_PAYLOADS/],
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

  it("sends the route template and path, never the query, headers or body, and correlates a tool error under HTTP 200", async () => {
    const send = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 202 }));
    configureFarmObservability({ events: ["request.start"] });
    const value = manager();
    const work: Promise<unknown>[] = [];
    const request = new Request("https://app.example/users/42?secret=private-query#private-hash", {
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
        route: { pathname: "/users/42", pattern: "/users/:id" },
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
    expect(events[0]).toMatchObject({
      outcome: "error",
      tool: "lookup",
      route: "/users/:id",
      path: "/users/42",
    });
    expect(events[1]).toMatchObject({
      status: 200,
      method: "GET",
      route: "/users/:id",
      path: "/users/42",
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

  it("names an MCP client in a session ID on its initialize, and each request after it", async () => {
    const send = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 202 }));
    const value = manager();
    const work: Promise<unknown>[] = [];
    const server = mcpServer();
    const post = (body: string, headers: Record<string, string> = {}) =>
      value.runRuntimeRequest(
        new Request("https://app.example/mcp", {
          method: "POST",
          headers: { ...MCP_HEADERS, ...headers },
          body,
        }),
        server,
        {
          kind: "api",
          route: { pathname: "/mcp", pattern: "/mcp" },
          waitUntil: (job) => work.push(job),
        },
      );
    const initialized = await post(initialize("cursor-vscode"));
    const session = initialized.headers.get("mcp-session-id")!;
    expect(session).toMatch(/^farm\.cursor\.[0-9a-f]{32}$/);
    // The server read the whole body and its answer passes through.
    expect(initialized.status).toBe(200);
    expect(initialized.headers.get("content-type")).toBe("application/json");
    expect(JSON.parse(await initialized.text()).result.body).toBe(initialize("cursor-vscode"));
    // The client sends the ID with each request after it, as MCP's transport requires.
    const called = await post(toolsCall, {
      "mcp-session-id": session,
      "mcp-protocol-version": "2025-06-18",
    });
    expect(called.headers.has("mcp-session-id")).toBe(false);
    await Promise.all(work);
    const events = sentEvents(send);
    expect(events.map(({ kind }) => kind).sort()).toEqual(["mcp.tool", "request", "request"]);
    for (const item of events) expect(item.agent).toEqual(CURSOR);
    expect(JSON.stringify(events)).not.toContain(session);
  });

  it("leaves an MCP response alone unless Farm can name the client and the server has no session", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 202 }));
    const value = manager();
    const sessionOf = async (
      body: string,
      server = mcpServer(),
      headers: Record<string, string> = MCP_HEADERS,
    ) => {
      const response = await value.runRuntimeRequest(
        new Request("https://app.example/mcp", { method: "POST", headers, body }),
        server,
        { kind: "api", route: { pathname: "/mcp", pattern: "/mcp" } },
      );
      // Whatever Farm does, the server always reads the body it was sent.
      expect(JSON.parse(await response.text()).result.body).toBe(body);
      return response.headers.get("mcp-session-id");
    };
    // A client Farm doesn't list.
    expect(await sessionOf(initialize("my-agent"))).toBeNull();
    // A server with sessions of its own keeps its ID.
    expect(
      await sessionOf(initialize("cursor-vscode"), mcpServer({ "mcp-session-id": "own" })),
    ).toBe("own");
    // A failed initialize.
    expect(await sessionOf(initialize("cursor-vscode"), mcpServer({}, 500))).toBeNull();
    // Not MCP's transport: a plain JSON POST is never read.
    expect(
      await sessionOf(initialize("cursor-vscode"), mcpServer(), {
        "content-type": "application/json",
      }),
    ).toBeNull();
    // Not JSON, larger than an initialize, or not JSON-RPC.
    expect(
      await sessionOf(initialize("cursor-vscode"), mcpServer(), {
        ...MCP_HEADERS,
        "content-type": "text/plain",
      }),
    ).toBeNull();
    const large = JSON.stringify({
      ...JSON.parse(initialize("cursor-vscode")),
      pad: "x".repeat(70_000),
    });
    expect(await sessionOf(large)).toBeNull();
    expect(await sessionOf("{not json")).toBeNull();
    // A batch names its client as a single message does.
    expect(await sessionOf(`[${initialize("claude-ai")}]`)).toMatch(/^farm\.claude\./);
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

describe("Farm Infra refusals", () => {
  const refused = (status: number, body?: unknown) =>
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Sends three requests' events through the recorder, so a refusal can repeat. */
  async function run(response: () => Response, env: Record<string, string> = {}) {
    const send = vi.spyOn(globalThis, "fetch").mockImplementation(async () => response());
    const warn = vi.fn();
    const recorder = createFarmInfraAnalyticsRecorder({ FARMJS_API_KEY: apiKey, ...env }, warn)!;
    for (let i = 0; i < 3; i++) {
      const work: Promise<unknown>[] = [];
      await recorder.record(
        new Request("https://app.example/"),
        { route: { pattern: "/" } },
        (job) => work.push(job),
        async () => new Response("ok"),
      );
      await Promise.all(work);
    }
    await recorder.close();
    for (const [message] of warn.mock.calls) expect(String(message)).not.toContain(apiKey);
    return { send, warn };
  }

  it("asks once for FARMJS_PROJECT_ID when the key reaches several projects", async () => {
    const { send, warn } = await run(() =>
      refused(400, { error: "project", message: "Send x-farm-project" }),
    );
    expect(send).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]![0]).toMatch(/Set FARMJS_PROJECT_ID or use a key scoped to one/);
  });

  it("points a key without analytics:write, such as farm login's, to a Site analytics key", async () => {
    const { send, warn } = await run(() =>
      refused(403, { error: "api_key_permission", message: "This API key can't send analytics." }),
    );
    expect(send).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]![0]).toMatch(/this key can't send analytics/);
    expect(warn.mock.calls[0]![0]).toMatch(/Site analytics key/);
    expect(warn.mock.calls[0]![0]).toMatch(/app\.farmjs\.dev/);
  });

  it("stops quietly for a key restricted to another environment", async () => {
    const { send, warn } = await run(
      () => refused(403, { error: "api_key_environment", message: "only production" }),
      { FARMJS_ENVIRONMENT: "development" },
    );
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]![1]!.headers).toMatchObject({
      "x-farm-environment": "development",
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it("says once that a revoked or expired key was refused", async () => {
    const { send, warn } = await run(() => refused(401, { error: "api_key" }));
    expect(send).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]![0]).toMatch(/401: FARMJS_API_KEY was revoked or has expired/);
  });

  it("keeps the generic warning for an unknown or unreadable refusal", async () => {
    for (const response of [
      () => refused(403, { error: "server_only" }),
      () => refused(403, { error: "__proto__" }),
      () => new Response("not json", { status: 400 }),
      () => refused(404),
    ]) {
      const { send, warn } = await run(response);
      expect(send).toHaveBeenCalledOnce();
      expect(warn).toHaveBeenCalledOnce();
      expect(warn.mock.calls[0]![0]).toMatch(/Farm Infra answered 40[034]\. Check FARMJS_API_KEY/);
      vi.restoreAllMocks();
    }
  });

  it("never lets a refusal or a failed send break the request", async () => {
    for (const fails of [
      () => {
        throw new Error("network");
      },
      () => refused(403, { error: "api_key_permission" }),
    ]) {
      const send = vi.spyOn(globalThis, "fetch").mockImplementation(async () => fails());
      const recorder = createFarmInfraAnalyticsRecorder({ FARMJS_API_KEY: apiKey }, vi.fn())!;
      const response = await recorder.record(
        new Request("https://app.example/"),
        {},
        undefined,
        async () => new Response("ok", { status: 201 }),
      );
      expect(response.status).toBe(201);
      await expect(recorder.close()).resolves.toBeUndefined();
      expect(send).toHaveBeenCalled();
      vi.restoreAllMocks();
    }
  });

  it("reads at most a bounded prefix of a refusal, without waiting on a stalled body", async () => {
    vi.useFakeTimers();
    try {
      const cancelled = vi.fn();
      const stalled = new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{"error":"api_key_permission"'));
          },
          cancel: cancelled,
        }),
        { status: 403 },
      );
      const onDiagnostic = vi.fn();
      const exporter = createFarmInfraAnalyticsExporter(
        { endpoint, key: apiKey, environment: "production", onDiagnostic },
        vi.fn<typeof fetch>().mockResolvedValue(stalled),
      );
      exporter.enqueue(event());
      const flushing = exporter.flush();
      await vi.runAllTimersAsync();
      await flushing;
      expect(cancelled).toHaveBeenCalled();
      expect(onDiagnostic.mock.calls).toEqual([[{ code: "disabled", status: 403 }]]);
      await exporter.close();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("recorder for servers without a plugin runtime", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reports the route template, path, method and status, never the query string", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 202 }));
    const recorder = farmInfraAnalyticsRecorder(options, send);
    const work: Promise<unknown>[] = [];
    const response = await recorder.record(
      new Request("https://app.example/users/42?secret=private-query", {
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
        path: "/users/42",
        method: "POST",
        status: 201,
        agent: {
          family: "openai",
          category: "crawler",
          identity: "self-reported",
          name: "GPTBot",
        },
      }),
    ]);
    await recorder.close();
  });

  it("reports which kind of client sent each request, never its user-agent", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 202 }));
    const recorder = farmInfraAnalyticsRecorder(options, send);
    const work: Promise<unknown>[] = [];
    const chrome =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
    for (const headers of [
      { "user-agent": chrome, "sec-fetch-site": "none", "sec-fetch-dest": "document" },
      { "user-agent": "curl/8.7.1" },
      { "user-agent": "node", "mcp-protocol-version": "2025-06-18" },
      { "user-agent": chrome },
    ])
      await recorder.record(
        new Request("https://app.example/", { headers }),
        { kind: "page", route: { pattern: "/" } },
        (job) => work.push(job),
        async () => new Response("ok"),
      );
    await Promise.all(work);
    await recorder.close();
    const body = send.mock.calls.map((call) => call[1]!.body as string).join("\n");
    expect(body).not.toContain("Macintosh");
    expect(body).not.toContain("curl/8");
    expect(sentEvents(send).map(({ agent }) => agent)).toEqual([
      { family: "unknown", category: "browser", identity: "self-reported", name: "Chrome" },
      { family: "unknown", category: "script", identity: "self-reported", name: "curl" },
      { family: "unknown", category: "harness", identity: "self-reported", name: "MCP client" },
      { family: "unknown", category: "unknown", identity: "unknown" },
    ]);
  });

  it("reports the path below the base path, and leaves out one Farm Infra would refuse", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 202 }));
    const recorder = farmInfraAnalyticsRecorder(options, send);
    const record = (url: string) =>
      recorder.record(
        new Request(url),
        { route: { pattern: "/products/[id]" } },
        undefined,
        async () => new Response(),
      );
    setFarmBasePath("/shop");
    try {
      await record("https://app.example/shop/products/42");
      await record("https://app.example/shop/caf%C3%A9");
      await record("https://app.example/shop/products/caf\u00e9");
      // A leading `//` fails Infra's rule, so the event goes with its template alone.
      await record("https://app.example//products/42");
      await record(`https://app.example/shop/${"a".repeat(1024)}`);
    } finally {
      setFarmBasePath("");
    }
    await recorder.close();
    expect(sentEvents(send).map((item) => item.path ?? null)).toEqual([
      "/products/42",
      "/caf%C3%A9",
      "/products/caf%C3%A9",
      null,
      null,
    ]);
    expect(sentEvents(send).every((item) => item.route === "/products/[id]")).toBe(true);
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
          agent: {
            family: "anthropic",
            category: "agent",
            identity: "self-reported",
            name: "Claude-User",
          },
        }),
      ),
    );
  });
});

describe("tool call payloads", () => {
  afterEach(() => {
    resetFarmObservability();
  });
  const call = (tool: string, payload: { arguments?: unknown; result?: unknown }) =>
    emitFarmEvent(
      _withFarmToolCallPayload(
        {
          type: "mcp.tool.complete",
          route: "/api/mcp",
          server: "store",
          tool,
          outcome: "success",
          durationMs: 4,
        },
        payload,
      ),
    );
  const run = async (env: Record<string, string>, calls: () => void) => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 202 }));
    const resolved = resolveFarmInfraAnalytics({ FARMJS_API_KEY: ingestionKey, ...env });
    if (!("options" in resolved)) throw new Error("expected a link");
    const recorder = farmInfraAnalyticsRecorder({ ...resolved.options, endpoint }, send);
    const work: Promise<unknown>[] = [];
    await recorder.record(
      new Request("https://app.example/api/mcp", { method: "POST" }),
      { route: { pattern: "/api/mcp" } },
      (job) => work.push(job),
      async () => {
        calls();
        return new Response("{}");
      },
    );
    await Promise.all(work);
    await recorder.close();
    return sentEvents(send).filter(({ kind }) => kind === "mcp.tool");
  };

  it("sends a call's arguments and result, with secret-looking keys redacted", async () => {
    const result = { content: [{ type: "text", text: "Signed in." }], isError: false };
    const [sent] = await run({}, () =>
      call("sign_in", {
        arguments: {
          email: "ada@example.com",
          password: "hunter2",
          nested: [{ apiKey: "k-1", "x-session-token": "s-1", tokens: 3 }],
          when: new Date("2026-01-01T00:00:00Z"),
        },
        result,
      }),
    );
    expect(sent).toMatchObject({
      tool: "sign_in",
      arguments: {
        email: "ada@example.com",
        password: "[redacted]",
        nested: [{ apiKey: "[redacted]", "x-session-token": "[redacted]", tokens: "[redacted]" }],
        when: "2026-01-01T00:00:00.000Z",
      },
      result,
    });
    expect(sent).not.toHaveProperty("omitted");
  });

  it("leaves out a payload larger or deeper than Farm Infra keeps, and one that isn't JSON", async () => {
    const deep = JSON.parse("[".repeat(40) + "]".repeat(40));
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const sent = await run({}, () => {
      call("large", { arguments: { text: "x".repeat(8 * 1024) }, result: "ok" });
      call("deep", { arguments: {}, result: deep });
      call("cyclic", { arguments: cyclic });
      call("thrown", { arguments: { id: 1 } });
    });
    expect(sent.map(({ tool, ...event }) => [tool, event])).toEqual([
      ["large", expect.objectContaining({ result: "ok", omitted: ["arguments"] })],
      ["deep", expect.objectContaining({ arguments: {}, omitted: ["result"] })],
      ["cyclic", expect.not.objectContaining({ arguments: expect.anything() })],
      ["thrown", expect.not.objectContaining({ result: expect.anything() })],
    ]);
    expect(sent[0]).not.toHaveProperty("arguments");
    expect(sent[1]).not.toHaveProperty("result");
  });

  it("sends none with FARMJS_TOOL_PAYLOADS=off", async () => {
    const [sent] = await run({ FARMJS_TOOL_PAYLOADS: "off" }, () =>
      call("search", { arguments: { query: "boots" }, result: "2 products" }),
    );
    expect(Object.keys(sent!).sort()).toEqual(
      [
        "agent",
        "durationMs",
        "id",
        "kind",
        "outcome",
        "path",
        "requestId",
        "route",
        "timestamp",
        "tool",
      ].sort(),
    );
    expect(
      resolveFarmInfraAnalytics({ FARMJS_API_KEY: ingestionKey, FARMJS_TOOL_PAYLOADS: "on" }),
    ).toEqual({
      options: { endpoint: expect.any(String), key: ingestionKey },
    });
  });

  it("never shows the payload to logs or onEvent handlers", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    configureFarmObservability({ logs: true });
    const seen: unknown[] = [];
    const unsubscribe = onFarmEvent((event) => {
      seen.push(JSON.stringify(event), { ...event }, Object.keys(event));
    });
    await run({}, () =>
      call("search", { arguments: { query: "private-query" }, result: "private-result" }),
    );
    unsubscribe();
    expect(JSON.stringify(seen)).not.toContain("private-");
    expect(log.mock.calls.flat().join(" ")).toContain("mcp.tool.complete");
    expect(log.mock.calls.flat().join(" ")).not.toContain("private-");
    log.mockRestore();
  });
});

describe("recorder: MCP clients", () => {
  it("names an MCP client in a session ID on its initialize, and its tool calls after it", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 202 }));
    const recorder = farmInfraAnalyticsRecorder(options, send);
    const work: Promise<unknown>[] = [];
    const server = mcpServer();
    const post = (body: string, headers: Record<string, string> = {}) => {
      const request = new Request("https://app.example/api/mcp", {
        method: "POST",
        headers: { ...MCP_HEADERS, ...headers },
        body,
      });
      return recorder.record(
        request,
        { route: { pattern: "/api/mcp" } },
        (job) => work.push(job),
        () => server(request),
      );
    };
    const initialized = await post(initialize("cursor-vscode"));
    const session = initialized.headers.get("mcp-session-id")!;
    expect(session).toMatch(/^farm\.cursor\.[0-9a-f]{32}$/);
    expect(JSON.parse(await initialized.text()).result.body).toBe(initialize("cursor-vscode"));
    await post(toolsCall, { "mcp-session-id": session });
    expect((await post(initialize("my-agent"))).headers.has("mcp-session-id")).toBe(false);
    await Promise.all(work);
    await recorder.close();
    expect(sentEvents(send).map(({ kind, agent }) => [kind, agent.name])).toEqual([
      ["request", "Cursor"],
      ["mcp.tool", "Cursor"],
      ["request", "Cursor"],
      ["request", "MCP client"],
    ]);
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

  it("fits batches of uneven events into one request body each, dropping none", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 202 }));
    const onDiagnostic = vi.fn();
    const exporter = createFarmInfraAnalyticsExporter({ ...options, onDiagnostic }, send);
    // Each tool event carries two payloads close to Farm Infra's 8 KiB limit.
    const text = "x".repeat(8 * 1024 - 32);
    for (let i = 0; i < 50; i++)
      exporter.enqueue({
        ...event(),
        kind: "mcp.tool",
        tool: "large",
        outcome: "success",
        arguments: { text },
        result: { text },
      } as never);
    const flushed = exporter.flush();
    await vi.runAllTimersAsync();
    await flushed;
    const bodies = send.mock.calls.map(([, init]) => init!.body as string);
    expect(bodies.length).toBeGreaterThan(1);
    for (const body of bodies)
      expect(new TextEncoder().encode(body).length).toBeLessThanOrEqual(128 * 1024);
    expect(sentEvents(send)).toHaveLength(50);
    expect(onDiagnostic).not.toHaveBeenCalledWith(expect.objectContaining({ code: "dropped" }));
    await exporter.close();
  });

  it("names only the environment for an API key without a project ID", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 202 }));
    const exporter = createFarmInfraAnalyticsExporter(
      { endpoint, key: apiKey, environment: "development" },
      send,
    );
    exporter.enqueue(event());
    const flushed = exporter.flush();
    await vi.runAllTimersAsync();
    await flushed;
    expect(send.mock.calls[0]![1]!.headers).toEqual({
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
      "x-farm-environment": "development",
    });
    expect(send.mock.calls[0]![1]!.headers).not.toHaveProperty("x-farm-project");
    await exporter.close();
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

describe("WebMCP tool call reports", () => {
  const CHROME =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
  // The path @farm.js/webmcp's browser runtime posts to.
  const reportURL = "https://app.example/_farm/webmcp/tool-calls";
  const browserHeaders = {
    "content-type": "application/json",
    origin: "https://app.example",
    host: "app.example",
    "sec-fetch-site": "same-origin",
    "sec-fetch-dest": "empty",
    "user-agent": CHROME,
  };
  const call = {
    tool: "search_docs",
    outcome: "success",
    durationMs: 12,
    path: "/docs/webmcp",
    arguments: { query: "webmcp", apiKey: "private-key" },
    result: { results: [{ title: "WebMCP" }] },
  };
  const report = (body: unknown, init: RequestInit = {}) =>
    new Request(reportURL, {
      method: "POST",
      ...init,
      headers: { ...browserHeaders, ...(init.headers as Record<string, string>) },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  // The route a request for the page would get, labeled as the docs engine labels it. Like
  // Farm's own matchers, it takes the path with the base path.
  const route = vi.fn((pathname: string) =>
    /^(\/console)?\/docs\//.test(pathname)
      ? setFarmRouteLabel({ pathname, pattern: "/docs" }, "/docs/[...slug]")
      : undefined,
  );
  const managers: PluginManager[] = [];
  const pluginRuntime = (
    send: typeof fetch,
    exporterOptions: typeof options & { toolPayloads?: boolean } = options,
  ) => {
    const manager = new PluginManager({ config: {}, isDev: false, isProd: true });
    manager.addPlugin(farmInfraAnalyticsPlugin(exporterOptions, send, { webmcp: { route } }));
    managers.push(manager);
    // What the app answers for a path no route or endpoint claims.
    const notFound = vi.fn(async () => new Response("not found", { status: 404 }));
    const run = async (request: Request) => {
      const work: Promise<unknown>[] = [];
      const response = await manager.runRuntimeRequest(request, notFound, {
        kind: "request",
        route: { pathname: new URL(request.url).pathname },
        waitUntil: (job) => work.push(job),
      });
      await Promise.all(work);
      return response;
    };
    return { run, notFound };
  };
  afterEach(async () => {
    await Promise.all(managers.splice(0).map((value) => value.closeRuntime("test")));
    route.mockClear();
    vi.restoreAllMocks();
    resetFarmObservability();
  });

  it("sends a call the browser reports as a tool event from that page, and never the report request", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 202 }));
    const { run, notFound } = pluginRuntime(send);
    const response = await run(report(call));
    expect(response.status).toBe(204);
    expect(notFound).not.toHaveBeenCalled();
    expect(route).toHaveBeenCalledWith("/docs/webmcp");
    const events = sentEvents(send);
    expect(events).toEqual([
      {
        id: expect.any(String),
        timestamp: expect.any(String),
        kind: "mcp.tool",
        source: "webmcp",
        durationMs: 12,
        route: "/docs/[...slug]",
        path: "/docs/webmcp",
        agent: {
          family: "unknown",
          category: "browser",
          identity: "self-reported",
          name: "Chrome",
        },
        tool: "search_docs",
        outcome: "success",
        arguments: { query: "webmcp", apiKey: "[redacted]" },
        result: { results: [{ title: "WebMCP" }] },
      },
    ]);
    expect(events[0]).not.toHaveProperty("requestId");
  });

  it("reports an error, an unknown page and a path Farm Infra would refuse", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 202 }));
    const { run } = pluginRuntime(send);
    const { result: _result, ...failed } = call;
    expect((await run(report({ ...failed, outcome: "error", path: "/elsewhere" }))).status).toBe(
      204,
    );
    expect((await run(report({ ...failed, path: `/${"a".repeat(1100)}` }))).status).toBe(204);
    const [error, long] = sentEvents(send);
    expect(error).toMatchObject({ outcome: "error", route: "/[unmatched]", path: "/elsewhere" });
    expect(error).not.toHaveProperty("result");
    expect(long).not.toHaveProperty("path");
  });

  it("keeps the payloads the browser left out, and applies Farm Infra's limits again", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 202 }));
    const { run } = pluginRuntime(send);
    const { arguments: _arguments, ...withoutArguments } = call;
    await run(report({ ...withoutArguments, omitted: ["arguments"] }));
    await run(report({ ...call, result: JSON.parse("[".repeat(40) + "]".repeat(40)) }));
    const [trimmed, deep] = sentEvents(send);
    expect(trimmed).toMatchObject({ omitted: ["arguments"], result: call.result });
    expect(trimmed).not.toHaveProperty("arguments");
    expect(deep).toMatchObject({ omitted: ["result"] });
    expect(deep).not.toHaveProperty("result");
  });

  it("sends no payloads with FARMJS_TOOL_PAYLOADS=off", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 202 }));
    const { run } = pluginRuntime(send, { ...options, toolPayloads: false });
    const { arguments: _arguments, ...withoutArguments } = call;
    await run(report(call));
    await run(report({ ...withoutArguments, omitted: ["arguments"] }));
    for (const event of sentEvents(send)) {
      expect(event).not.toHaveProperty("arguments");
      expect(event).not.toHaveProperty("result");
      expect(event).not.toHaveProperty("omitted");
    }
  });

  it("refuses cross-site, non-JSON, oversized and malformed reports", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 202 }));
    const { run } = pluginRuntime(send);
    const status = async (request: Request) => (await run(request)).status;
    const big = { ...call, arguments: { text: "x".repeat(40 * 1024) } };
    const { tool: _tool, ...withoutTool } = call;
    expect(await status(new Request(reportURL))).toBe(405);
    expect(
      await status(
        report(call, {
          headers: { origin: "https://evil.example", "sec-fetch-site": "cross-site" },
        }),
      ),
    ).toBe(403);
    // A form post from another site sends no CORS preflight.
    expect(
      await status(
        report(call, { headers: { origin: "https://evil.example", "content-type": "text/plain" } }),
      ),
    ).toBe(403);
    const anonymous = new Request(reportURL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(call),
    });
    expect(await status(anonymous)).toBe(403);
    expect(await status(report(call, { headers: { "content-type": "text/plain" } }))).toBe(415);
    expect(await status(report(big))).toBe(413);
    // A streamed body is cut off as it is read, without reading the rest.
    const chunk = new TextEncoder().encode("x".repeat(16 * 1024));
    let pulled = 0;
    const streamed = new Request(reportURL, {
      method: "POST",
      headers: browserHeaders,
      body: new ReadableStream({
        pull(controller) {
          pulled++;
          controller.enqueue(chunk);
        },
      }),
      duplex: "half",
    } as RequestInit);
    expect(await status(streamed)).toBe(413);
    expect(pulled).toBeLessThan(5);
    for (const body of [
      "{",
      "[]",
      withoutTool,
      { ...call, extra: true },
      JSON.stringify(call).replace("{", '{"__proto__":{"polluted":true},'),
      { ...call, tool: "search docs" },
      { ...call, tool: "a".repeat(129) },
      { ...call, outcome: "ok" },
      { ...call, durationMs: -1 },
      { ...call, durationMs: "12" },
      { ...call, path: "https://app.example/docs" },
      { ...call, path: "//evil.example/docs" },
      { ...call, path: "/docs?query=private" },
      { ...call, omitted: ["arguments"] },
      { ...call, omitted: ["input"] },
    ]) {
      expect(await status(report(body)), JSON.stringify(body)).toBe(400);
    }
    expect(send).not.toHaveBeenCalled();
  });

  it("answers 404 once Farm Infra refuses the key, so pages stop reporting", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 401 }));
    const { run } = pluginRuntime(send);
    expect((await run(report(call))).status).toBe(204);
    expect((await run(report(call))).status).toBe(404);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("takes no reports unless the app's pages send them", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 202 }));
    const manager = new PluginManager({ config: {}, isDev: false, isProd: true });
    manager.addPlugin(farmInfraAnalyticsPlugin(options, send));
    managers.push(manager);
    const work: Promise<unknown>[] = [];
    const response = await manager.runRuntimeRequest(
      report(call),
      async () => new Response("not found", { status: 404 }),
      { kind: "request", waitUntil: (job) => work.push(job) },
    );
    await Promise.all(work);
    expect(response.status).toBe(404);
    expect(sentEvents(send).map(({ kind }) => kind)).toEqual(["request"]);
    expect(new URL(reportURL).pathname).toBe(FARM_WEBMCP_REPORT_PATH);
    expect(_farmWebMCPReportsEnabled([{ name: "farm:webmcp" }])).toBe(true);
    expect(
      _farmWebMCPReportsEnabled([
        { name: "farm:webmcp", client: { public: { analytics: false } } },
      ]),
    ).toBe(false);
    expect(_farmWebMCPReportsEnabled([{ name: "farm:health" }])).toBe(false);
    expect(_farmWebMCPReportsEnabled(undefined)).toBe(false);
  });

  it("takes reports without a plugin runtime, below the base path, never recording them as requests", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 202 }));
    const recorder = farmInfraAnalyticsRecorder(options, send, { webmcp: { route } });
    const handler = vi.fn(async () => new Response("page"));
    const work: Promise<unknown>[] = [];
    setFarmBasePath("/console");
    try {
      const request = new Request("https://app.example/console/_farm/webmcp/tool-calls", {
        method: "POST",
        headers: browserHeaders,
        body: JSON.stringify({ ...call, path: "/console/docs/webmcp" }),
      });
      const response = await recorder.record(
        request,
        { kind: "request" },
        (job) => work.push(job),
        handler,
      );
      expect(response.status).toBe(204);
    } finally {
      setFarmBasePath("");
    }
    await Promise.all(work);
    await recorder.close();
    expect(handler).not.toHaveBeenCalled();
    expect(route).toHaveBeenCalledWith("/console/docs/webmcp");
    const events = sentEvents(send);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "mcp.tool",
      source: "webmcp",
      route: "/docs/[...slug]",
      path: "/docs/webmcp",
      tool: "search_docs",
    });
    expect(events[0]).not.toHaveProperty("requestId");
  });
});
