// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createRouteFactory } from "@farm.js/core/api";
import { invokeAPIRouteEndpoint, mergePluginAPIRoutes } from "@farm.js/core/api/runtime";
import { apiMcp } from "./index.js";

const route = createRouteFactory();

function createFixture(options: { authorize?: boolean } = {}) {
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
    options.authorize
      ? {
          authorize: ({ request }) =>
            request.headers.get("authorization") === "Bearer good"
              ? { subject: "user-1", scopes: ["projects"] }
              : false,
        }
      : { allowUnauthenticated: true },
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

  it("rejects the old method/path tool map with route-owned migration guidance", () => {
    expect(() =>
      apiMcp({
        allowUnauthenticated: true,
        tools: { "GET /api/projects": { name: "list_projects" } },
      } as never),
    ).toThrow("tools belong on createEndpoint");
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
