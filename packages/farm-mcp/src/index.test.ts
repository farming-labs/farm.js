// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createEndpoint, createRouteFactory } from "@farm.js/core/api";
import type { FarmMCPConfig } from "@farm.js/core";
import { invokeAPIRouteEndpoint, mergePluginAPIRoutes } from "@farm.js/core/api/runtime";
import { apiMcp } from "./index.js";

const route = createRouteFactory();

function createFixture(options: { authorize?: boolean; config?: FarmMCPConfig } = {}) {
  const middleware = vi.fn(({ request }) => ({
    subject: request.headers.get("authorization"),
  }));
  const list = route.get("/api/projects/[team]", {
    mcp: {
      description: "List projects for one team.",
      readOnlyHint: true,
    },
    input: {
      params: z.object({ team: z.string().min(1) }),
      query: z.object({ tag: z.union([z.string(), z.array(z.string())]) }),
    },
    middleware: [middleware],
    handler(_request, { input, context }) {
      return { team: input.params.team, tags: input.query.tag, subject: context.subject };
    },
  });
  const create = route.post("/api/projects", {
    mcp: {
      name: "create_project",
      description: "Create a project.",
      destructiveHint: false,
    },
    input: {
      body: z.object({ name: z.string().min(1) }),
      headers: z.object({ authorization: z.string() }),
    },
    handler(_request, { input }) {
      return { id: "p1", name: input.body.name };
    },
  });
  const plugin = apiMcp(
    options.config ??
      (options.authorize
        ? {
            authorize: ({ request }) =>
              request.headers.get("authorization") === "Bearer good"
                ? { subject: "user-1", scopes: ["projects"] }
                : false,
          }
        : { allowUnauthenticated: true }),
  );
  const routes = mergePluginAPIRoutes(
    [
      { path: list.path, methods: [list.method], endpoints: { GET: list.endpoint } },
      { path: create.path, methods: [create.method], endpoints: { POST: create.endpoint } },
    ],
    [plugin],
  );
  const endpoint = routes.find((entry) => entry.path === "/api/mcp")!.endpoints.POST;
  return { endpoint, middleware };
}

async function sendMCP(endpoint: any, body: unknown, authorization?: string) {
  const headers = new Headers({
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
    "mcp-protocol-version": "2025-11-25",
  });
  if (authorization) headers.set("authorization", authorization);
  return invokeAPIRouteEndpoint(
    endpoint,
    new Request("http://farm.test/api/mcp", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }),
  );
}

async function readMCP(response: Response): Promise<any> {
  const text = await response.text();
  if (!response.headers.get("content-type")?.startsWith("text/event-stream")) {
    return JSON.parse(text);
  }
  const data = text
    .split("\n")
    .find((line) => line.startsWith("data: "))
    ?.slice("data: ".length);
  if (!data) throw new Error(`Missing MCP SSE data: ${text}`);
  return JSON.parse(data);
}

describe("apiMcp", () => {
  it("requires an explicit authorization posture", () => {
    expect(() => apiMcp({})).toThrow("requires authorize");
  });

  it("fails the build for no selected tools and duplicate route-owned names", () => {
    const empty = apiMcp({ allowUnauthenticated: true });
    expect(() => mergePluginAPIRoutes([], [empty])).toThrow("at least one endpoint");
    const one = route.get("/api/one", {
      mcp: { name: "same" },
      handler: () => ({ ok: true }),
    });
    const two = route.get("/api/two", {
      mcp: { name: "same" },
      handler: () => ({ ok: true }),
    });
    expect(() =>
      mergePluginAPIRoutes(
        [
          { path: one.path, methods: [one.method], endpoints: { GET: one.endpoint } },
          { path: two.path, methods: [two.method], endpoints: { GET: two.endpoint } },
        ],
        [apiMcp({ allowUnauthenticated: true })],
      ),
    ).toThrow("duplicated");
  });

  it("rejects the old method/path tool map with endpoint-reference migration guidance", () => {
    expect(() =>
      apiMcp({
        allowUnauthenticated: true,
        tools: { "GET /api/projects": { name: "list_projects" } },
      } as never),
    ).toThrow("tools must be an array of endpoint references");
  });

  it("derives a tool name for mcp: true and rejects invalid route metadata", async () => {
    const health = route.get("/api/health", {
      mcp: true,
      handler: () => ({ ok: true }),
    });
    const plugin = apiMcp({ allowUnauthenticated: true });
    const routes = mergePluginAPIRoutes(
      [{ path: health.path, methods: [health.method], endpoints: { GET: health.endpoint } }],
      [plugin],
    );
    const endpoint = routes.find((entry) => entry.path === "/api/mcp")!.endpoints.POST;
    const payload = await readMCP(
      await sendMCP(endpoint, {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {},
      }),
    );
    expect(payload.result.tools).toEqual([expect.objectContaining({ name: "get_health" })]);

    const invalid = route.get("/api/invalid", {
      mcp: { name: "invalid name" },
      handler: () => null,
    });
    expect(() =>
      mergePluginAPIRoutes(
        [{ path: invalid.path, methods: [invalid.method], endpoints: { GET: invalid.endpoint } }],
        [plugin],
      ),
    ).toThrow("needs a valid MCP name");
  });

  it("rejects unauthorized requests before MCP protocol handling", async () => {
    const { endpoint } = createFixture({ authorize: true });
    const response = await sendMCP(endpoint, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {},
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("authorizes every tool call in a JSON-RPC batch before dispatch", async () => {
    const handler = vi.fn(() => ({ deleted: true }));
    const destructive = route.delete("/api/projects", {
      mcp: { name: "delete_projects" },
      handler,
    });
    const authorize = vi.fn(({ tool }: { tool?: string }) =>
      tool === "delete_projects" ? false : { subject: "user-1", scopes: ["projects"] },
    );
    const routes = mergePluginAPIRoutes(
      [
        {
          path: destructive.path,
          methods: [destructive.method],
          endpoints: { DELETE: destructive.endpoint },
        },
      ],
      [apiMcp({ authorize })],
    );
    const endpoint = routes.find((entry) => entry.path === "/api/mcp")!.endpoints.POST;

    const response = await sendMCP(endpoint, [
      { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "delete_projects", arguments: {} },
      },
    ]);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    expect(authorize).toHaveBeenNthCalledWith(1, expect.objectContaining({ tool: undefined }));
    expect(authorize).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ tool: "delete_projects" }),
    );
    expect(authorize).toHaveBeenCalledTimes(2);
    expect(handler).not.toHaveBeenCalled();
  });

  it("rejects batches that resolve to different authorization identities", async () => {
    const handler = vi.fn(() => ({ deleted: true }));
    const destructive = route.delete("/api/projects", {
      mcp: { name: "delete_projects" },
      handler,
    });
    const authorize = vi.fn(({ tool }: { tool?: string }) =>
      tool === "delete_projects" ? { subject: "user-2" } : { subject: "user-1" },
    );
    const routes = mergePluginAPIRoutes(
      [
        {
          path: destructive.path,
          methods: [destructive.method],
          endpoints: { DELETE: destructive.endpoint },
        },
      ],
      [apiMcp({ authorize })],
    );
    const endpoint = routes.find((entry) => entry.path === "/api/mcp")!.endpoints.POST;

    const response = await sendMCP(endpoint, [
      { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "delete_projects", arguments: {} },
      },
    ]);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    expect(authorize).toHaveBeenCalledTimes(2);
    expect(handler).not.toHaveBeenCalled();
  });

  it("advertises route-owned tools with generated schemas", async () => {
    const { endpoint } = createFixture();
    const response = await sendMCP(endpoint, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {},
    });
    expect(response.status).toBe(200);
    const payload = await readMCP(response);
    expect(payload.result.tools).toEqual([
      expect.objectContaining({
        name: "get_projects_by_team",
        description: "List projects for one team.",
        annotations: expect.objectContaining({ readOnlyHint: true, destructiveHint: false }),
        inputSchema: expect.objectContaining({
          type: "object",
          required: expect.arrayContaining(["params", "query"]),
        }),
      }),
      expect.objectContaining({ name: "create_project" }),
    ]);
  });

  it("dispatches tool calls through route validation and middleware exactly once", async () => {
    const { endpoint, middleware } = createFixture({ authorize: true });
    const response = await sendMCP(
      endpoint,
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "get_projects_by_team",
          arguments: { params: { team: "farm" }, query: { tag: ["one", "two"] } },
        },
      },
      "Bearer good",
    );
    expect(response.status).toBe(200);
    const payload = await readMCP(response);
    expect(payload.result.structuredContent).toEqual({
      result: { team: "farm", tags: ["one", "two"], subject: "Bearer good" },
    });
    expect(middleware).toHaveBeenCalledTimes(1);
  });

  it("supplies a frozen tool catalog and server identity on every authorization request", async () => {
    const authorize = vi.fn<NonNullable<FarmMCPConfig["authorize"]>>(() => ({ subject: "reader" }));
    const { endpoint } = createFixture({ config: { authorize, name: "projects", version: "2" } });
    for (const body of [
      { jsonrpc: "2.0", id: 1, method: "tools/list" },
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "missing", arguments: {} } },
      [
        {
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: { name: "create_project", arguments: {} },
        },
      ],
    ]) {
      await sendMCP(endpoint, body);
    }
    expect(authorize).toHaveBeenCalledTimes(3);
    const contexts = authorize.mock.calls.map(([context]) => context);
    expect(contexts.map(({ tool }) => tool)).toEqual([undefined, "missing", "create_project"]);
    for (const context of contexts) {
      expect(context.server).toEqual({ name: "projects", version: "2", path: "/api/mcp" });
      expect(context.tools).toEqual([
        expect.objectContaining({
          name: "get_projects_by_team",
          method: "GET",
          path: "/api/projects/[team]",
        }),
        expect.objectContaining({ name: "create_project", method: "POST", path: "/api/projects" }),
      ]);
      expect(Object.isFrozen(context.tools)).toBe(true);
      expect(Object.isFrozen(context.tools[0])).toBe(true);
      expect(Object.isFrozen(context.server)).toBe(true);
      expect(context.tools[0]).not.toHaveProperty("invoke");
    }
  });

  it("limits discovery and calls per request without leaking another caller's permissions", async () => {
    const { endpoint, middleware } = createFixture({
      config: {
        authorize: async ({ request, tools }) => {
          await Promise.resolve();
          return {
            subject: "agent",
            tools:
              request.headers.get("authorization") === "Bearer writer"
                ? tools.map(({ name }) => name)
                : [],
          };
        },
      },
    });
    const listBody = { jsonrpc: "2.0", id: 1, method: "tools/list" };
    const [reader, writer] = await Promise.all([
      sendMCP(endpoint, listBody, "Bearer reader").then(readMCP),
      sendMCP(endpoint, listBody, "Bearer writer").then(readMCP),
    ]);
    expect(reader.result.tools).toEqual([]);
    expect(writer.result.tools).toHaveLength(2);
    const callBody = {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "get_projects_by_team",
        arguments: { params: { team: "farm" }, query: { tag: "one" } },
      },
    };
    const denied = await readMCP(await sendMCP(endpoint, callBody, "Bearer reader"));
    expect(denied.error).toBeDefined();
    expect(middleware).not.toHaveBeenCalled();
    const allowed = await readMCP(await sendMCP(endpoint, callBody, "Bearer writer"));
    expect(allowed.result.structuredContent.result.team).toBe("farm");
    expect(middleware).toHaveBeenCalledTimes(1);
  });

  it.each([null, "create_project", ["typo"], [1]])(
    "fails closed for an invalid authorization tools list: %j",
    async (tools) => {
      const { endpoint, middleware } = createFixture({
        config: {
          authorize: () => ({ subject: "agent", tools }) as never,
        },
      });
      await expect(
        sendMCP(endpoint, {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/list",
        }),
      ).rejects.toThrow("authorize tools must be an array of configured tool names");
      expect(middleware).not.toHaveBeenCalled();
    },
  );

  it("does not bypass permissions through a batch or overridden credentials", async () => {
    const { endpoint, middleware } = createFixture({
      config: {
        authorize: () => ({ subject: "agent", tools: [] }),
      },
    });
    const call = {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "get_projects_by_team",
        arguments: { params: { team: "farm" }, query: { tag: "one" } },
      },
    };
    const batch = await sendMCP(endpoint, [call, { ...call, id: 2 }]);
    expect(batch.status).toBe(200);
    const batchText = await batch.text();
    const deniedCalls = batch.headers.get("content-type")?.startsWith("text/event-stream")
      ? batchText
          .split("\n")
          .filter((line) => line.startsWith("data: "))
          .map((line) => JSON.parse(line.slice(6)))
      : JSON.parse(batchText);
    expect(deniedCalls).toEqual([
      expect.objectContaining({ id: 1, error: expect.any(Object) }),
      expect.objectContaining({ id: 2, error: expect.any(Object) }),
    ]);
    expect(middleware).not.toHaveBeenCalled();

    const authorized = createFixture({ authorize: true });
    const spoofed = await readMCP(
      await sendMCP(
        authorized.endpoint,
        {
          ...call,
          params: {
            ...call.params,
            arguments: {
              ...call.params.arguments,
              headers: { authorization: "Bearer someone-else" },
            },
          },
        },
        "Bearer good",
      ),
    );
    expect(spoofed.result.isError).toBe(true);
    expect(authorized.middleware).not.toHaveBeenCalled();
  });

  it("selects explicit endpoint references and dispatches the mounted route, not a config copy", async () => {
    const handler = vi.fn(() => ({ source: "mounted" }));
    const mounted = createEndpoint("/api/health", { method: "GET" }, handler);
    // Config and route modules are evaluated independently by the dev/build loaders.
    const reference = createEndpoint("/api/health", { method: "GET" }, () => ({
      source: "config",
    }));
    const hidden = route.get("/api/hidden", { mcp: true, handler: () => null });
    const plugin = apiMcp({
      allowUnauthenticated: true,
      tools: [{ endpoint: reference, name: "health", description: "Health check" }],
    });
    const routes = mergePluginAPIRoutes(
      [
        { path: "/api/health", methods: ["GET"], endpoints: { GET: mounted } },
        { path: hidden.path, methods: [hidden.method], endpoints: { GET: hidden.endpoint } },
      ],
      [plugin],
    );
    const endpoint = routes.find((entry) => entry.path === "/api/mcp")!.endpoints.POST;
    const list = await readMCP(
      await sendMCP(endpoint, { jsonrpc: "2.0", id: 1, method: "tools/list" }),
    );
    expect(list.result.tools).toEqual([
      expect.objectContaining({ name: "health", description: "Health check" }),
    ]);
    const call = await readMCP(
      await sendMCP(endpoint, {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "health", arguments: {} },
      }),
    );
    expect(call.result.structuredContent).toEqual({ result: { source: "mounted" } });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("accepts a bare endpoint reference with its route-owned metadata", async () => {
    const health = createEndpoint(
      "/api/health",
      { method: "GET", mcp: { name: "health" } },
      () => ({ ok: true }),
    );
    const routes = mergePluginAPIRoutes(
      [{ path: "/api/health", methods: ["GET"], endpoints: { GET: health } }],
      [apiMcp({ allowUnauthenticated: true, tools: [health] })],
    );
    const endpoint = routes.find((entry) => entry.path === "/api/mcp")!.endpoints.POST;
    const list = await readMCP(
      await sendMCP(endpoint, { jsonrpc: "2.0", id: 1, method: "tools/list" }),
    );
    expect(list.result.tools).toEqual([expect.objectContaining({ name: "health" })]);
  });

  it("rejects ambiguous, unmounted, duplicate and recursive endpoint selections", () => {
    const health = route.get("/api/health", { handler: () => null });
    const mounted = [
      { path: health.path, methods: [health.method], endpoints: { GET: health.endpoint } },
    ];
    const select = (tools: FarmMCPConfig["tools"]) =>
      mergePluginAPIRoutes(mounted, [apiMcp({ allowUnauthenticated: true, tools })]);
    expect(() => select([createEndpoint({ method: "GET" }, () => null)])).toThrow(
      "explicit /api path",
    );
    expect(() => select([createEndpoint("/api/missing", { method: "GET" }, () => null)])).toThrow(
      "not a mounted app endpoint",
    );
    expect(() => select([health.endpoint, health.endpoint])).toThrow("selected more than once");
    expect(() => select([createEndpoint("/api/mcp", { method: "GET" }, () => null)])).toThrow(
      "own route",
    );
    expect(() => select([])).toThrow("at least one endpoint");
  });

  it("returns endpoint validation failures as MCP tool errors", async () => {
    const { endpoint } = createFixture();
    const response = await sendMCP(endpoint, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "create_project", arguments: { body: { name: "Valid" } } },
    });
    const payload = await readMCP(response);
    expect(payload.result.isError).toBe(true);
    expect(payload.result.content[0].text).toContain('"status":400');
  });
});
