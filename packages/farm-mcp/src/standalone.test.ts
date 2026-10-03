// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createEndpoint } from "@farm.js/core/api";
import { invokeAPIRouteEndpoint, mergePluginAPIRoutes } from "@farm.js/core/api/runtime";
import type { FarmMCPConfig, FarmMCPExecuteContext } from "@farm.js/core";
import { apiMcp, defineTool } from "./index.js";

function mount(config: FarmMCPConfig) {
  const api = createEndpoint("/api/projects", { method: "GET" }, () => ({ source: "endpoint" }));
  const routes = mergePluginAPIRoutes(
    [{ path: "/api/projects", methods: ["GET"], endpoints: { GET: api } }],
    [apiMcp(config)],
  );
  return routes.find((route) => route.path === "/api/mcp")!.endpoints.POST;
}

async function call(
  endpoint: any,
  method: string,
  params?: unknown,
  token = "reader",
  signal?: AbortSignal,
) {
  const response = await invokeAPIRouteEndpoint(
    endpoint,
    new Request("http://farm.test/api/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${token}`,
        "mcp-protocol-version": "2025-11-25",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal,
    }),
  );
  const text = await response.text();
  const data = response.headers.get("content-type")?.startsWith("text/event-stream")
    ? text
        .split("\n")
        .find((line) => line.startsWith("data: "))
        ?.slice(6)
    : text;
  return { response, payload: JSON.parse(data!) };
}

describe("standalone MCP tools", () => {
  it("composes tools and endpoints with one immutable catalog and per-caller policy", async () => {
    const execute = vi.fn(
      ({ query }, { authorization, request, signal }: FarmMCPExecuteContext) => ({
        query,
        subject: authorization.subject,
        tenant: authorization.tenant,
        credential: request.headers.get("authorization"),
        aborted: signal.aborted,
      }),
    );
    const search = defineTool({
      name: "search_projects",
      description: "Search",
      readOnlyHint: true,
      inputSchema: z.object({ query: z.string().min(1) }),
      execute,
    });
    const endpointReference = createEndpoint("/api/projects", { method: "GET" }, () => null);
    const authorize = vi.fn<NonNullable<FarmMCPConfig["authorize"]>>(({ request, tools }) => ({
      subject: request.headers.get("authorization")!.slice(7),
      tenant: "team-a",
      tools:
        request.headers.get("authorization") === "Bearer reader"
          ? ["search_projects"]
          : tools.map(({ name }) => name),
    }));
    const endpoint = mount({
      tools: [{ endpoint: endpointReference, name: "list_projects" }, search],
      authorize,
    });
    const { payload: list } = await call(endpoint, "tools/list");
    expect(list.result.tools.map((tool: any) => tool.name)).toEqual(["search_projects"]);
    expect(list.result.tools[0].inputSchema.properties).toHaveProperty("query");
    const catalog = authorize.mock.calls[0]![0].tools;
    expect(catalog.map(({ kind }) => kind)).toEqual(["endpoint", "standalone"]);
    expect(catalog[1]).not.toHaveProperty("path");
    expect(catalog[1]).not.toHaveProperty("execute");
    expect(catalog[1]).not.toHaveProperty("inputSchema");
    expect(Object.isFrozen(catalog[1])).toBe(true);
    const { payload: result } = await call(endpoint, "tools/call", {
      name: "search_projects",
      arguments: { query: "farm" },
    });
    expect(result.result.structuredContent).toEqual({
      result: {
        query: "farm",
        subject: "reader",
        tenant: "team-a",
        credential: "Bearer reader",
        aborted: false,
      },
    });
    const denied = await call(endpoint, "tools/call", { name: "list_projects", arguments: {} });
    expect(denied.payload.error).toBeDefined();
    const allowed = await call(
      endpoint,
      "tools/call",
      { name: "list_projects", arguments: {} },
      "writer",
    );
    expect(allowed.payload.result.structuredContent).toEqual({ result: { source: "endpoint" } });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("supports servers with only standalone tools and no API endpoints", async () => {
    const tools = [
      defineTool({
        name: "ping",
        inputSchema: z.object({}),
        execute: (_input, { authorization }) => ({ subject: authorization.subject }),
      }),
    ];
    const routes = mergePluginAPIRoutes([], [apiMcp({ tools, allowUnauthenticated: true })]);
    expect(routes.map(({ path }) => path)).toEqual(["/api/mcp"]);
    const result = await call(routes[0]!.endpoints.POST, "tools/call", {
      name: "ping",
      arguments: {},
    });
    expect(result.payload.result.structuredContent).toEqual({ result: { subject: "anonymous" } });
  });

  it("validates async refinements and transforms exactly once before execution", async () => {
    const refine = vi.fn(async (value: string) => value !== "blocked");
    const transform = vi.fn((value: string) => value.length);
    const execute = vi.fn(({ query, limit }) => ({ length: query, limit }));
    const tool = defineTool({
      name: "search",
      inputSchema: z.object({
        query: z.string().refine(refine).transform(transform),
        limit: z.number().default(5),
      }),
      execute,
    });
    const endpoint = mount({ tools: [tool], allowUnauthenticated: true });
    const result = await call(endpoint, "tools/call", {
      name: "search",
      arguments: { query: "farm" },
    });
    expect(result.payload.result.structuredContent).toEqual({ result: { length: 4, limit: 5 } });
    expect(refine).toHaveBeenCalledTimes(1);
    expect(transform).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(1);
    const invalid = await call(endpoint, "tools/call", {
      name: "search",
      arguments: { query: "blocked" },
    });
    expect(invalid.payload.result.isError).toBe(true);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("supports Standard Schema input conversion and validation", async () => {
    const validate = vi.fn(async (value: any) => ({ value: { query: value.query.toUpperCase() } }));
    const inputSchema = {
      "~standard": {
        version: 1,
        vendor: "test",
        validate,
        jsonSchema: {
          input: () => ({
            type: "object",
            properties: { query: { type: "string" } },
            required: ["query"],
          }),
        },
      },
    };
    const endpoint = mount({
      tools: [defineTool({ name: "standard", inputSchema, execute: (input) => input })],
      allowUnauthenticated: true,
    });
    const result = await call(endpoint, "tools/call", {
      name: "standard",
      arguments: { query: "farm" },
    });
    expect(result.payload.result.structuredContent).toEqual({ result: { query: "FARM" } });
    expect(validate).toHaveBeenCalledTimes(1);
  });

  it("does not validate or execute a standalone tool when authorization denies it", async () => {
    const refine = vi.fn(() => true);
    const execute = vi.fn(() => null);
    const tool = defineTool({ name: "private", inputSchema: z.object({}).refine(refine), execute });
    const endpoint = mount({ tools: [tool], authorize: () => ({ subject: "reader", tools: [] }) });
    const denied = await call(endpoint, "tools/call", { name: "private", arguments: {} });
    expect(denied.payload.error).toBeDefined();
    expect(execute).not.toHaveBeenCalled();
    expect(refine).not.toHaveBeenCalled();
    const unauthorized = mount({ tools: [tool], authorize: () => false });
    expect(
      (await call(unauthorized, "tools/call", { name: "private", arguments: {} })).response.status,
    ).toBe(401);
    expect(execute).not.toHaveBeenCalled();
  });

  it("isolates the principal for concurrent calls", async () => {
    const endpoint = mount({
      tools: [
        defineTool({
          name: "whoami",
          inputSchema: z.object({}),
          execute: async (_input, { authorization }) => {
            await Promise.resolve();
            return { subject: authorization.subject };
          },
        }),
      ],
      authorize: ({ request }) => ({ subject: request.headers.get("authorization")! }),
    });
    const results = await Promise.all(
      ["one", "two"].map((token) =>
        call(endpoint, "tools/call", { name: "whoami", arguments: {} }, token),
      ),
    );
    expect(results.map(({ payload }) => payload.result.structuredContent.result.subject)).toEqual([
      "Bearer one",
      "Bearer two",
    ]);
  });

  it.each([undefined, new Response("not JSON"), new Map(), 1n, () => null, NaN])(
    "rejects non-JSON results: %s",
    async (value) => {
      const endpoint = mount({
        tools: [defineTool({ name: "invalid", inputSchema: z.object({}), execute: () => value })],
        allowUnauthenticated: true,
      });
      const { payload } = await call(endpoint, "tools/call", { name: "invalid", arguments: {} });
      expect(payload.result.isError).toBe(true);
      expect(payload.result.content[0].text).toContain("JSON-serializable");
    },
  );

  it("does not execute if the request is cancelled during asynchronous validation", async () => {
    const controller = new AbortController();
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    let finish!: () => void;
    const validation = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const execute = vi.fn(() => null);
    const inputSchema = z.object({}).refine(async () => {
      started();
      await validation;
      return true;
    });
    const endpoint = mount({
      tools: [defineTool({ name: "slow", inputSchema, execute })],
      allowUnauthenticated: true,
    });
    const pending = call(
      endpoint,
      "tools/call",
      { name: "slow", arguments: {} },
      "reader",
      controller.signal,
    ).catch((error) => error);
    await ready;
    controller.abort();
    finish();
    await pending;
    expect(execute).not.toHaveBeenCalled();
  });

  it("passes request cancellation through to executing tools", async () => {
    const controller = new AbortController();
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const cancelled = vi.fn();
    const endpoint = mount({
      tools: [
        defineTool({
          name: "slow",
          inputSchema: z.object({}),
          execute: (_input, { signal }) =>
            new Promise((resolve) => {
              signal.addEventListener(
                "abort",
                () => {
                  cancelled();
                  resolve(null);
                },
                { once: true },
              );
              started();
            }),
        }),
      ],
      allowUnauthenticated: true,
    });
    const pending = call(
      endpoint,
      "tools/call",
      { name: "slow", arguments: {} },
      "reader",
      controller.signal,
    ).catch((error) => error);
    await ready;
    controller.abort();
    await pending;
    expect(cancelled).toHaveBeenCalledTimes(1);
  });

  it("maps execution failures to tool errors and keeps the server usable", async () => {
    const execute = vi
      .fn()
      .mockRejectedValueOnce(new Error("Project unavailable"))
      .mockResolvedValueOnce(null);
    const endpoint = mount({
      tools: [defineTool({ name: "search", inputSchema: z.object({}), execute })],
      allowUnauthenticated: true,
    });
    const failed = await call(endpoint, "tools/call", { name: "search", arguments: {} });
    expect(failed.payload.result.isError).toBe(true);
    expect(failed.payload.result.content[0].text).toBe("Project unavailable");
    expect(
      (await call(endpoint, "tools/call", { name: "search", arguments: {} })).payload.result
        .structuredContent,
    ).toEqual({ result: null });
  });

  it("rejects duplicate mixed names, malformed declarations and non-object input schemas", () => {
    const tool = defineTool({ name: "same", inputSchema: z.object({}), execute: () => null });
    const endpoint = createEndpoint("/api/projects", { method: "GET" }, () => null);
    expect(() =>
      mount({ tools: [{ endpoint, name: "same" }, tool], allowUnauthenticated: true }),
    ).toThrow("duplicated");
    expect(() =>
      mount({ tools: [{ ...tool, endpoint } as never], allowUnauthenticated: true }),
    ).toThrow("without an endpoint");
    expect(() =>
      mount({ tools: [{ ...tool, inputSchema: z.string() }], allowUnauthenticated: true }),
    ).toThrow("describe an object");
    expect(() =>
      mount({ tools: [{ ...tool, name: "bad name" }], allowUnauthenticated: true }),
    ).toThrow("valid MCP name");
    expect(() =>
      mount({ tools: [{ ...tool, inputSchema: undefined } as never], allowUnauthenticated: true }),
    ).toThrow("inputSchema and execute");
    expect(() =>
      mount({ tools: [{ ...tool, execute: undefined } as never], allowUnauthenticated: true }),
    ).toThrow("inputSchema and execute");
  });
});
