// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createEndpoint, createRouteFactory } from "@farm.js/core/api";
import type { FarmMCPConfig } from "@farm.js/core";
import { invokeAPIRouteEndpoint, mergePluginAPIRoutes } from "@farm.js/core/api/runtime";
import { apiMcp, definePrompt, defineResource, defineTool } from "./index.js";

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

async function sendMCP(
  endpoint: any,
  body: unknown,
  authorization?: string,
  requestHeaders?: Record<string, string>,
) {
  const headers = new Headers({
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
    "mcp-protocol-version": "2025-11-25",
  });
  if (authorization) headers.set("authorization", authorization);
  for (const [name, value] of Object.entries(requestHeaders ?? {})) headers.set(name, value);
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
    // A 401 must carry a challenge (RFC 9110); MCP clients authenticate with Bearer tokens.
    expect(response.headers.get("www-authenticate")).toBe("Bearer");
  });

  it("links OAuth protected resource metadata from the 401 when oauth is configured", async () => {
    const oauth = {
      authorizationServers: ["https://auth.example.com"],
      scopes: ["projects:read", "projects:write"],
    };
    const authorize = () => false as const;
    const { endpoint } = createFixture({ config: { authorize, oauth } });
    const response = await sendMCP(endpoint, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {},
    });
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe(
      'Bearer resource_metadata="http://farm.test/.well-known/oauth-protected-resource/api/mcp", scope="projects:read projects:write"',
    );

    const before = apiMcp({ authorize, oauth, name: "acme" }).runtime!.before!;
    const metadata = (await before({
      request: new Request("http://farm.test/.well-known/oauth-protected-resource/api/mcp"),
    } as never)) as Response;
    expect(metadata.status).toBe(200);
    expect(metadata.headers.get("content-type")).toBe("application/json");
    expect(await metadata.json()).toEqual({
      resource: "http://farm.test/api/mcp",
      authorization_servers: ["https://auth.example.com"],
      scopes_supported: ["projects:read", "projects:write"],
      bearer_methods_supported: ["header"],
      resource_name: "acme",
    });

    // The endpoint's public path can differ from /api/mcp through api.baseURL.
    const mapped = (await before({
      request: new Request("http://farm.test/.well-known/oauth-protected-resource/v1/mcp"),
    } as never)) as Response;
    expect((await mapped.json()).resource).toBe("http://farm.test/v1/mcp");

    const post = (await before({
      request: new Request("http://farm.test/.well-known/oauth-protected-resource/api/mcp", {
        method: "POST",
      }),
    } as never)) as Response;
    expect(post.status).toBe(405);
    for (const pathname of ["/.well-known/oauth-protected-resource/api/other", "/api/mcp", "/"]) {
      expect(
        await before({ request: new Request(`http://farm.test${pathname}`) } as never),
      ).toBeUndefined();
    }
  });

  it("publishes its endpoint tools so core can name the tool behind a form", async () => {
    const { _findFarmMCPEndpointTool } = await import("@farm.js/core/api/runtime");
    const create = route.post("/api/notes", {
      mcp: { name: "create_note" },
      input: { body: z.object({ text: z.string() }) },
      handler: () => ({ ok: true }),
    });
    const plugin = apiMcp({ authorize: () => ({ subject: "x" }) });
    mergePluginAPIRoutes(
      [{ path: create.path, methods: [create.method], endpoints: { POST: create.endpoint } }],
      [plugin],
    );
    expect(_findFarmMCPEndpointTool("POST", "/api/notes")).toEqual({
      name: "create_note",
      endpoint: "/api/mcp",
    });
    // An endpoint tool's schema comes from its route input, for the app manifest.
    const catalogs = (globalThis as Record<symbol, Map<string, any>>)[
      Symbol.for("farm.mcp.catalogs")
    ];
    expect(catalogs.get("/api/mcp").details.schemas.create_note.input).toMatchObject({
      type: "object",
      properties: { body: { type: "object", properties: { text: { type: "string" } } } },
    });
    // Publishing adds no runtime hook, which would bundle the plugin runtime into servers.
    expect(plugin.runtime).toBeUndefined();
  });

  it("reports its title and description, and publishes them for the server card", async () => {
    const health = route.get("/api/health", { mcp: true, handler: () => ({ ok: true }) });
    const plugin = apiMcp({
      allowUnauthenticated: true,
      path: "/api/card-mcp",
      name: "projects",
      version: "3.1.0",
      title: "Projects",
      description: "Create and search projects.",
    });
    const routes = mergePluginAPIRoutes(
      [{ path: health.path, methods: [health.method], endpoints: { GET: health.endpoint } }],
      [plugin],
    );
    const endpoint = routes.find((entry) => entry.path === "/api/card-mcp")!.endpoints.POST;
    const payload = await readMCP(
      await sendMCP(endpoint, {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "test", version: "1" },
        },
      }),
    );
    expect(payload.result.serverInfo).toEqual({
      name: "projects",
      version: "3.1.0",
      title: "Projects",
      description: "Create and search projects.",
    });

    const catalogs = (globalThis as Record<symbol, Map<string, any>>)[
      Symbol.for("farm.mcp.catalogs")
    ];
    const published = catalogs.get("/api/card-mcp");
    expect(published.server).toEqual({
      name: "projects",
      version: "3.1.0",
      title: "Projects",
      description: "Create and search projects.",
      path: "/api/card-mcp",
    });
    expect(published.details.protocolVersions).toContain("2025-11-25");
    // No authorize: anonymous clients list its tools, so the public manifest may too.
    expect(published.details.public).toBe(true);

    expect(() => apiMcp({ allowUnauthenticated: true, description: " " })).toThrow(
      "apiMcp description must be a non-empty string.",
    );
  });

  it("publishes each tool's schemas, its resources and its prompts for the app manifest", () => {
    const plugin = apiMcp({
      path: "/api/manifest-mcp",
      authorize: () => ({ subject: "x" }),
      tools: [
        defineTool({
          name: "search_notes",
          inputSchema: z.object({ query: z.string() }),
          outputSchema: z.object({ notes: z.array(z.string()) }),
          readOnlyHint: true,
          execute: () => ({ notes: [] }),
        }),
      ],
      resources: [
        defineResource({
          name: "handbook",
          uri: "docs://handbook",
          mimeType: "text/markdown",
          read: () => "# Handbook",
        }),
      ],
      prompts: [
        definePrompt({
          name: "summarize",
          description: "Summarize a note.",
          arguments: z.object({ id: z.string() }),
          render: ({ id }) => `Summarize ${id}`,
        }),
      ],
    });
    mergePluginAPIRoutes([], [plugin]);
    const catalogs = (globalThis as Record<symbol, Map<string, any>>)[
      Symbol.for("farm.mcp.catalogs")
    ];
    const { details } = catalogs.get("/api/manifest-mcp");
    // authorize runs on every request, so the public manifest lists none of its catalog.
    expect(details.public).toBe(false);
    expect(Object.keys(details.schemas)).toEqual(["search_notes"]);
    expect(details.schemas.search_notes.input).toMatchObject({
      type: "object",
      properties: { query: { type: "string" } },
    });
    // The output schema agents see: the result inside MCP's structured content.
    expect(details.schemas.search_notes.output).toMatchObject({
      properties: { result: { properties: { notes: { type: "array" } } } },
    });
    expect(details.resources).toEqual([
      { name: "handbook", mimeType: "text/markdown", uri: "docs://handbook" },
    ]);
    expect(details.prompts).toEqual([
      {
        name: "summarize",
        description: "Summarize a note.",
        arguments: expect.objectContaining({ properties: { id: { type: "string" } } }),
      },
    ]);
  });

  it("adds no request hook without oauth", () => {
    expect(apiMcp({ authorize: () => false }).runtime).toBeUndefined();
  });

  it("rejects oauth config that cannot be advertised", () => {
    const authorize = () => false as const;
    expect(() => apiMcp({ authorize, oauth: { authorizationServers: [] } })).toThrow(
      "absolute issuer URLs",
    );
    expect(() =>
      apiMcp({ authorize, oauth: { authorizationServers: ["auth.example.com"] } }),
    ).toThrow("absolute issuer URLs");
    expect(() =>
      apiMcp({
        authorize,
        oauth: { authorizationServers: ["https://auth.example.com"], scopes: ['a" b'] },
      }),
    ).toThrow("OAuth scope tokens");
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

  it("refuses an oversized batch before authorizing any of it and stops at the first deny", async () => {
    const health = route.get("/api/health", {
      mcp: { name: "health" },
      handler: () => ({ ok: 1 }),
    });
    const mount = (options: Parameters<typeof apiMcp>[0]) =>
      mergePluginAPIRoutes(
        [{ path: health.path, methods: [health.method], endpoints: { GET: health.endpoint } }],
        [apiMcp(options)],
      ).find((entry) => entry.path === "/api/mcp")!.endpoints.POST;
    const batch = (size: number) =>
      Array.from({ length: size }, (_, index) => ({
        jsonrpc: "2.0",
        id: index + 1,
        method: "tools/list",
        params: {},
      }));

    // An anonymous body asks for one authorize call per message.
    const authorize = vi.fn(() => false as const);
    const capped = await sendMCP(mount({ authorize }), batch(26));
    expect(capped.status).toBe(400);
    expect(await capped.json()).toEqual({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32600, message: "A JSON-RPC batch may carry at most 25 messages." },
    });
    expect(authorize).not.toHaveBeenCalled();

    // Within the cap, the first refusal ends authorization.
    const denied = await sendMCP(mount({ authorize }), batch(25));
    expect(denied.status).toBe(401);
    expect(authorize).toHaveBeenCalledTimes(1);

    // The cap is configurable and also bounds a public server.
    const custom = await sendMCP(mount({ allowUnauthenticated: true, maxBatchSize: 2 }), batch(3));
    expect(custom.status).toBe(400);
    expect(
      (await sendMCP(mount({ allowUnauthenticated: true, maxBatchSize: 2 }), batch(2))).status,
    ).toBe(200);
    expect(() => apiMcp({ allowUnauthenticated: true, maxBatchSize: 0 })).toThrow("maxBatchSize");
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
  });

  it("does not let tool inputs override request-provenance headers", async () => {
    const handler = vi.fn((request: Request) => ({
      origin: request.headers.get("origin"),
      forwardedHost: request.headers.get("x-forwarded-host"),
      clientTag: request.headers.get("x-client-tag"),
    }));
    const echo = route.post("/api/echo", {
      mcp: { name: "echo" },
      input: {
        headers: z.object({
          "x-client-tag": z.string().optional(),
          origin: z.string().optional(),
          "x-forwarded-host": z.string().optional(),
          "x-client-ip": z.string().optional(),
          "x-original-host": z.string().optional(),
          "x-original-url": z.string().optional(),
        }),
      },
      handler,
    });
    const plugin = apiMcp({ allowUnauthenticated: true });
    const routes = mergePluginAPIRoutes(
      [{ path: echo.path, methods: [echo.method], endpoints: { POST: echo.endpoint } }],
      [plugin],
    );
    const endpoint = routes.find((entry) => entry.path === "/api/mcp")!.endpoints.POST;
    const list = await readMCP(
      await sendMCP(endpoint, { jsonrpc: "2.0", id: 1, method: "tools/list" }),
    );
    const headerSchema = list.result.tools[0].inputSchema.properties.headers;
    expect(headerSchema.properties).toHaveProperty("x-client-tag");
    expect(headerSchema.properties).not.toHaveProperty("origin");
    expect(headerSchema.properties).not.toHaveProperty("x-forwarded-host");
    expect(headerSchema.properties).not.toHaveProperty("x-client-ip");
    expect(headerSchema.properties).not.toHaveProperty("x-original-host");
    expect(headerSchema.properties).not.toHaveProperty("x-original-url");

    const allowed = await readMCP(
      await sendMCP(endpoint, {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "echo", arguments: { headers: { "x-client-tag": "tool" } } },
      }),
    );
    expect(allowed.result.structuredContent).toEqual({
      result: {
        origin: null,
        forwardedHost: null,
        clientTag: "tool",
      },
    });
    handler.mockClear();

    const result = await readMCP(
      await sendMCP(
        endpoint,
        {
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: {
            name: "echo",
            arguments: {
              headers: {
                origin: "https://evil.example",
                "x-forwarded-host": "evil.example",
              },
            },
          },
        },
        undefined,
        { origin: "https://trusted.example", "x-forwarded-host": "trusted.example" },
      ),
    );
    expect(result.result.isError).toBe(true);
    expect(result.result.content[0].text).toContain("additional properties schema");
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

  it("sends endpoint tool calls through the app pipeline when the runtime provides one", async () => {
    const handler = vi.fn(() => ({ users: ["admin-only"] }));
    const users = route.get("/api/admin/users", { mcp: { name: "list_users" }, handler });
    const seen: Array<{ url: string; cookie: string | null; encoding: string | null }> = [];
    const routes = mergePluginAPIRoutes(
      [{ path: users.path, methods: [users.method], endpoints: { GET: users.endpoint } }],
      [apiMcp({ authorize: () => ({ subject: "regular" }) })],
      undefined,
      {
        // Stands in for the app's middleware guarding /api/admin/**.
        dispatch: async (request) => {
          seen.push({
            url: request.url,
            cookie: request.headers.get("cookie"),
            encoding: request.headers.get("accept-encoding"),
          });
          if (!request.headers.get("cookie")?.includes("role=admin")) {
            return new Response("admins only", { status: 403 });
          }
          return invokeAPIRouteEndpoint(users.endpoint, request, {});
        },
      },
    );
    const endpoint = routes.find((entry) => entry.path === "/api/mcp")!.endpoints.POST;
    const call = (cookie: string) =>
      sendMCP(
        endpoint,
        {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "list_users", arguments: {} },
        },
        undefined,
        { cookie, "accept-encoding": "gzip" },
      ).then(readMCP);

    const refused = await call("session=regular");
    expect(refused.result.isError).toBe(true);
    expect(JSON.parse(refused.result.content[0].text)).toEqual({
      status: 403,
      error: "admins only",
    });
    expect(handler).not.toHaveBeenCalled();

    const allowed = await call("session=admin; role=admin");
    expect(allowed.result.structuredContent).toEqual({ result: { users: ["admin-only"] } });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([
      { url: "http://farm.test/api/admin/users", cookie: "session=regular", encoding: null },
      {
        url: "http://farm.test/api/admin/users",
        cookie: "session=admin; role=admin",
        encoding: null,
      },
    ]);
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

  it("hides an endpoint handler's thrown error and logs it", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const leaky = route.get("/api/leaky", {
      mcp: { name: "leaky" },
      handler() {
        throw new Error("connect postgres://admin:hunter2@db.internal failed");
      },
    });
    const routes = mergePluginAPIRoutes(
      [{ path: leaky.path, methods: [leaky.method], endpoints: { GET: leaky.endpoint } }],
      [apiMcp({ allowUnauthenticated: true })],
    );
    const endpoint = routes.find((entry) => entry.path === "/api/mcp")!.endpoints.POST;
    try {
      const payload = await readMCP(
        await sendMCP(endpoint, {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "leaky", arguments: {} },
        }),
      );
      expect(payload.result.isError).toBe(true);
      expect(payload.result.content[0].text).toBe("Farm API tool invocation failed.");
      expect(JSON.stringify(payload)).not.toContain("hunter2");
      expect(consoleError).toHaveBeenCalledTimes(1);
    } finally {
      consoleError.mockRestore();
    }
  });
});
