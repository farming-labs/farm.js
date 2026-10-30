import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, createHmac } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { resolveFarmAgentConfig } from "../agent-config";
import {
  createFarmAppManifest,
  createFarmAppManifestResponse,
  isFarmAppManifestPath,
  resolveFarmAppManifestInput,
  type FarmAppManifestInput,
} from "../app-manifest";
import type { FarmAppManifestConfig } from "../app-manifest-config";
import { resolveFarmAppPackages } from "../app-manifest-packages";
import { defineIntegration } from "../integrations";
import { _publishFarmMCPCatalog } from "../mcp-catalog";
import { farmPathGuardCoversEndpoint } from "../middleware/may-handle";
import { FARM_VERSION } from "../version";

const key = `fti_${"k".repeat(43)}`;
const input = resolveFarmAppManifestInput(
  {
    basePath: "/",
    renderer: { name: "react" },
    plugins: [{ name: "farm:api-mcp" }, { name: "farm:webmcp" }],
    agent: { apiCatalog: true, llmsTxt: true },
    openapi: { enabled: true, specRoute: "/api/openapi.json" },
    integrations: {
      auth: { category: "auth", type: "better-auth" },
      billing: { slot: "payment", type: "stripe" },
      missing: undefined,
    },
  },
  {
    build: "abc123",
    packages: { "@farm.js/core": "0.1.31", "@farm.js/mcp": "0.1.31" },
    webmcpTools: [{ name: "list_todos", readOnlyHint: true, inputSchemaSource: "none" }],
  },
);
const listOrders = {
  name: "list_orders",
  title: "List orders",
  description: "Orders from the last 30 days.",
  kind: "endpoint",
  method: "GET",
  path: "/api/orders",
  readOnlyHint: true,
  destructiveHint: false,
} as const;
const inputSchema = { type: "object", properties: { query: { type: "string" } } };
const unpublish: (() => void)[] = [];
afterEach(() => unpublish.splice(0).forEach((remove) => remove()));

function publishStore({ isPublic = true } = {}) {
  unpublish.push(
    _publishFarmMCPCatalog(
      { name: "store", version: "1.0.0", path: "/api/mcp" },
      [
        listOrders,
        { name: "search", kind: "standalone", readOnlyHint: true },
        { name: "archive", kind: "serverFunction" },
      ],
      {
        public: isPublic,
        schemas: {
          list_orders: { input: inputSchema, output: { type: "object" } },
          search: { input: inputSchema },
        },
        resources: [{ name: "handbook", uri: "docs://handbook", mimeType: "text/markdown" }],
        prompts: [{ name: "summarize", arguments: { type: "object", properties: {} } }],
      },
    ),
  );
}

describe("app manifest", () => {
  it("describes the app and every tool however it was defined, with its schemas", () => {
    publishStore();
    expect(createFarmAppManifest(input)).toEqual({
      schemaVersion: 1,
      app: { farm: FARM_VERSION, renderer: "react", basePath: "/", build: "abc123" },
      packages: { "@farm.js/core": "0.1.31", "@farm.js/mcp": "0.1.31" },
      mcp: {
        servers: [
          {
            name: "store",
            version: "1.0.0",
            path: "/api/mcp",
            authorization: "none",
            resources: [{ name: "handbook", uri: "docs://handbook", mimeType: "text/markdown" }],
            prompts: [{ name: "summarize", arguments: { type: "object", properties: {} } }],
            tools: [
              {
                name: "list_orders",
                title: "List orders",
                description: "Orders from the last 30 days.",
                source: "endpoint",
                readOnlyHint: true,
                destructiveHint: false,
                inputSchema,
                outputSchema: { type: "object" },
              },
              { name: "search", source: "defineTool", readOnlyHint: true, inputSchema },
              { name: "archive", source: "serverFunction" },
            ],
          },
        ],
      },
      webmcp: {
        enabled: true,
        tools: [{ name: "list_todos", readOnlyHint: true, inputSchemaSource: "none" }],
      },
      // Which slot and provider, nothing from the integration's config.
      integrations: [
        { key: "auth", category: "auth", type: "better-auth" },
        { key: "billing", category: "payment", type: "stripe" },
      ],
      agent: {
        apiCatalog: "/.well-known/api-catalog",
        llmsTxt: true,
        openapi: "/api/openapi.json",
      },
      plugins: ["farm:api-mcp", "farm:webmcp"],
    });
  });

  it("lists what an anonymous MCP client could list, and never an endpoint tool's route", () => {
    publishStore();
    const [store] = createFarmAppManifest(input).mcp!.servers;
    expect(store!.authorization).toBe("none");
    expect(store!.resources).toHaveLength(1);
    expect(store!.prompts).toHaveLength(1);
    expect(store!.tools[0]).toEqual({
      name: "list_orders",
      title: "List orders",
      description: "Orders from the last 30 days.",
      source: "endpoint",
      readOnlyHint: true,
      destructiveHint: false,
      inputSchema,
      outputSchema: { type: "object" },
    });
    expect(JSON.stringify(createFarmAppManifest(input))).not.toContain("/api/orders");
  });

  it("lists a public server behind a guard written for its path by identity only", () => {
    publishStore();
    const guardedBy = (
      config: Parameters<typeof farmPathGuardCoversEndpoint>[0]["config"],
      middlewareRoutes: { path: string }[] = [],
      apiServerBasePath?: string,
    ) => ({
      ...input,
      guardCoversPath: (path: string) =>
        farmPathGuardCoversEndpoint({ config, middlewareRoutes }, path, apiServerBasePath),
    });
    for (const guarded of [
      guardedBy({ middleware: [{ matcher: "/api/mcp" }] }),
      // A matcher for the public api.basePath form covers the /api route too.
      guardedBy({ middleware: [{ matcher: "/v1/:path*" }] }, [], "/v1"),
      guardedBy({}, [{ path: "/api" }]),
      guardedBy({
        integrations: {
          auth: defineIntegration({
            category: "auth",
            type: "acme",
            instance: {},
            middleware: [
              { matcher: ["/api/mcp"], handler: () => new Response(null, { status: 401 }) },
            ],
          }),
        },
      }),
    ]) {
      const [store] = createFarmAppManifest(guarded).mcp!.servers;
      expect(store).toMatchObject({ name: "store", authorization: "required" });
      expect(store).toMatchObject({ tools: [], resources: [], prompts: [] });
      expect(JSON.stringify(createFarmAppManifest(guarded))).not.toMatch(/list_orders|handbook/);
    }

    // Guards that cover every path, or another path, leave a public server's tools listed.
    for (const open of [
      guardedBy({ middleware: [{ matcher: "/(.*)" }, { handler() {} }, { matcher: "/admin" }] }),
      guardedBy({}, [{ path: "/" }, { path: "/api/admin" }]),
    ]) {
      const [store] = createFarmAppManifest(open).mcp!.servers;
      expect(store).toMatchObject({ authorization: "none" });
      expect(store!.tools).toHaveLength(3);
    }
  });

  it("lists a server that requires authorize by identity only", () => {
    publishStore({ isPublic: false });
    expect(createFarmAppManifest(input).mcp!.servers).toEqual([
      {
        name: "store",
        version: "1.0.0",
        path: "/api/mcp",
        authorization: "required",
        resources: [],
        prompts: [],
        tools: [],
      },
    ]);
  });

  it("lists WebMCP tools only when the webmcp plugin is on, and integrations by name only", () => {
    const off = resolveFarmAppManifestInput(
      {
        plugins: [{ name: "farm:api-mcp" }],
        integrations: {
          sentry: {
            category: "monitoring",
            type: "sentry",
            config: { dsn: "https://secret@example.ingest.sentry.io/1" },
          } as never,
        },
      },
      {
        build: "x",
        packages: {},
        webmcpTools: [{ name: "stray", inputSchemaSource: "none" }],
      },
    );
    const manifest = createFarmAppManifest(off);
    expect(manifest.webmcp).toEqual({ enabled: false, tools: [] });
    expect(manifest.integrations).toEqual([
      { key: "sentry", category: "monitoring", type: "sentry" },
    ]);
    expect(JSON.stringify(manifest)).not.toContain("secret");
  });

  it("lists no servers for an app without MCP, and tools without schemas from older servers", () => {
    expect(createFarmAppManifest(input).mcp!.servers).toEqual([]);
    unpublish.push(
      _publishFarmMCPCatalog({ name: "old", version: "1", path: "/api/old" }, [
        { name: "ping", kind: "standalone" },
      ]),
    );
    // An older @farm.js/mcp doesn't say whether it's public, so the manifest assumes not.
    expect(createFarmAppManifest(input).mcp!.servers[0]).toEqual({
      name: "old",
      version: "1",
      path: "/api/old",
      authorization: "required",
      resources: [],
      prompts: [],
      tools: [],
    });
    unpublish.push(
      _publishFarmMCPCatalog(
        { name: "open", version: "1", path: "/api/open" },
        [{ name: "ping", kind: "standalone" }],
        { public: true },
      ),
    );
    expect(createFarmAppManifest(input).mcp!.servers[1]!.tools).toEqual([
      { name: "ping", source: "defineTool" },
    ]);
  });
});

describe("/.well-known/farmjs.json", () => {
  const request = (headers: Record<string, string> = {}, method = "GET") =>
    new Request("https://app.example/.well-known/farmjs.json", { method, headers });

  it("is served at /.well-known/farmjs.json, and at 0.1.34's /.well-known/farmjs", () => {
    expect(isFarmAppManifestPath("/.well-known/farmjs.json")).toBe(true);
    expect(isFarmAppManifestPath("/.well-known/farmjs")).toBe(true);
    for (const other of ["/.well-known/farmjs/", "/.well-known/farmjs.jsonx", "/farmjs.json"]) {
      expect(isFarmAppManifestPath(other)).toBe(false);
    }
  });

  it("answers anyone, with CORS and a revalidated ETag, and never contains the key", async () => {
    publishStore({ isPublic: false });
    const previous = process.env.FARMJS_API_KEY;
    process.env.FARMJS_API_KEY = key;
    try {
      const response = await createFarmAppManifestResponse(request(), input);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
      expect(response.headers.get("cache-control")).toBe("public, max-age=0, must-revalidate");
      expect(response.headers.get("access-control-allow-origin")).toBe("*");
      expect(response.headers.get("access-control-allow-headers")).toBe("If-None-Match");
      expect(response.headers.get("vary")).toBeNull();
      const body = await response.text();
      expect(JSON.parse(body).mcp.servers[0].tools).toEqual([]);
      expect(body).not.toContain(key);
    } finally {
      if (previous === undefined) delete process.env.FARMJS_API_KEY;
      else process.env.FARMJS_API_KEY = previous;
    }
    const etag = (await createFarmAppManifestResponse(request(), input)).headers.get("etag")!;
    expect(etag).toMatch(/^W\/"[0-9a-f]{8}"$/);
    const cached = await createFarmAppManifestResponse(request({ "if-none-match": etag }), input);
    expect(cached.status).toBe(304);
    expect(await cached.text()).toBe("");
    const head = await createFarmAppManifestResponse(request({}, "HEAD"), input);
    expect(head.status).toBe(200);
    expect(head.headers.get("etag")).toBe(etag);
    expect(await head.text()).toBe("");
    const preflight = await createFarmAppManifestResponse(request({}, "OPTIONS"), input);
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-methods")).toBe("GET, HEAD, OPTIONS");
    const post = await createFarmAppManifestResponse(request({}, "POST"), input);
    expect(post.status).toBe(405);
    expect(post.headers.get("allow")).toBe("GET, HEAD, OPTIONS");
  });

  it("gives a request signed the way Farm Infra signed it the same public document", async () => {
    publishStore({ isPublic: false });
    // Farm Infra's signature for the app's FARMJS_API_KEY, which once unlocked a full view.
    const timestamp = Math.floor(Date.now() / 1000);
    const secret = createHash("sha256").update(key).digest("hex");
    const signature = `t=${timestamp}, v1=${createHmac("sha256", secret)
      .update(`farmjs-manifest-v1\n${timestamp}`)
      .digest("hex")}`;
    const previous = process.env.FARMJS_API_KEY;
    process.env.FARMJS_API_KEY = key;
    try {
      const plain = await createFarmAppManifestResponse(request(), input);
      const signed = await createFarmAppManifestResponse(
        request({ "farmjs-infra-signature": signature }),
        input,
      );
      expect(signed.status).toBe(200);
      expect(signed.headers.get("cache-control")).toBe("public, max-age=0, must-revalidate");
      expect(signed.headers.get("etag")).toBe(plain.headers.get("etag"));
      const body = await signed.text();
      expect(body).toBe(await plain.text());
      expect(body).not.toMatch(/list_orders|handbook|\/api\/orders/);
      // A signed request revalidates like any other.
      const cached = await createFarmAppManifestResponse(
        request({
          "farmjs-infra-signature": signature,
          "if-none-match": plain.headers.get("etag")!,
        }),
        input,
      );
      expect(cached.status).toBe(304);
    } finally {
      if (previous === undefined) delete process.env.FARMJS_API_KEY;
      else process.env.FARMJS_API_KEY = previous;
    }
  });
});

describe("agent.manifest sections", () => {
  const withSections = (manifest: boolean | FarmAppManifestConfig): FarmAppManifestInput =>
    resolveFarmAppManifestInput(
      {
        basePath: "/app",
        renderer: { name: "vue" },
        plugins: [{ name: "farm:webmcp" }, { name: "fixture" }],
        agent: { llmsTxt: true, manifest },
        integrations: { auth: { category: "auth", type: "better-auth" } },
      },
      {
        build: "abc123",
        packages: { "@farm.js/core": "0.1.31", "@farm.js/vue": "0.1.31" },
        webmcpTools: [
          { name: "list_todos", readOnlyHint: true, inputSchemaSource: "none" },
          { name: "delete_todo", destructiveHint: true, inputSchemaSource: "none" },
        ],
      },
    );
  const manifestFor = (manifest: boolean | FarmAppManifestConfig) =>
    createFarmAppManifest(withSections(manifest));

  it("shows every section by default, with true, and with {}", () => {
    publishStore();
    const shown = manifestFor(true);
    expect(manifestFor({})).toEqual(shown);
    expect(createFarmAppManifest({ ...withSections(true), sections: undefined })).toEqual(shown);
    expect(shown).toMatchObject({
      app: { farm: FARM_VERSION, renderer: "vue", basePath: "/app", build: "abc123" },
      packages: { "@farm.js/core": "0.1.31", "@farm.js/vue": "0.1.31" },
      integrations: [{ key: "auth", category: "auth", type: "better-auth" }],
      agent: { apiCatalog: null, llmsTxt: true, openapi: null },
      plugins: ["farm:webmcp", "fixture"],
    });
    expect(shown.mcp!.servers[0]!.tools).toHaveLength(3);
    expect(shown.webmcp!.tools).toHaveLength(2);
  });

  it("serves a hidden section as null, unlike an empty one", () => {
    publishStore();
    for (const section of [
      "app",
      "packages",
      "mcp",
      "webmcp",
      "integrations",
      "agent",
      "plugins",
    ] as const) {
      const manifest = manifestFor({ [section]: false });
      expect(manifest).toHaveProperty(section, null);
      expect(Object.keys(manifest)).toEqual(Object.keys(manifestFor(true)));
      for (const other of Object.keys(manifest).filter((key) => key !== section)) {
        expect(manifest[other as keyof typeof manifest]).not.toBeNull();
      }
    }
    // Nothing to show is still an empty list.
    unpublish.splice(0).forEach((remove) => remove());
    const none = createFarmAppManifest(
      resolveFarmAppManifestInput({}, { build: "x", packages: {} }),
    );
    expect(none).toMatchObject({
      packages: {},
      integrations: [],
      plugins: [],
      mcp: { servers: [] },
    });
    expect(none.webmcp).toEqual({ enabled: false, tools: [] });
  });

  it("lists package names without versions", () => {
    expect(manifestFor({ packages: "names" }).packages).toEqual({
      "@farm.js/core": null,
      "@farm.js/vue": null,
    });
  });

  it("leaves out the app fields set to false, keeping basePath", () => {
    expect(manifestFor({ app: { version: false } }).app).toEqual({
      renderer: "vue",
      basePath: "/app",
      build: "abc123",
    });
    expect(manifestFor({ app: { renderer: false, build: false } }).app).toEqual({
      farm: FARM_VERSION,
      basePath: "/app",
    });
    expect(manifestFor({ app: { version: false, renderer: false, build: false } }).app).toEqual({
      basePath: "/app",
    });
  });

  it("hides an MCP server, or one of its tools, and drops schemas", () => {
    publishStore();
    unpublish.push(
      _publishFarmMCPCatalog(
        { name: "internal", version: "1", path: "/api/internal/mcp" },
        [{ name: "ping", kind: "standalone" }],
        { public: true },
      ),
    );
    const names = (manifest: ReturnType<typeof manifestFor>) =>
      manifest.mcp!.servers.map((server) => [server.name, server.tools.map(({ name }) => name)]);
    expect(names(manifestFor({ mcp: { hide: ["internal"] } }))).toEqual([
      ["store", ["list_orders", "search", "archive"]],
    ]);
    expect(names(manifestFor({ mcp: { hide: ["store/list_orders", "internal/nope"] } }))).toEqual([
      ["store", ["search", "archive"]],
      ["internal", ["ping"]],
    ]);
    // A tool name alone hides nothing: it names a server.
    expect(names(manifestFor({ mcp: { hide: ["search"] } }))[0]![1]).toHaveLength(3);
    const bare = manifestFor({ mcp: { schemas: false } });
    expect(bare.mcp!.servers[0]!.tools[0]).toEqual({
      name: "list_orders",
      title: "List orders",
      description: "Orders from the last 30 days.",
      source: "endpoint",
      readOnlyHint: true,
      destructiveHint: false,
    });
    expect(JSON.stringify(bare.mcp)).not.toContain("inputSchema");
    expect(JSON.stringify(bare.mcp)).not.toContain("outputSchema");
    // Resources and prompts stay.
    expect(bare.mcp!.servers[0]!.resources).toHaveLength(1);
  });

  it("hides the default MCP server's tools the same way", () => {
    const server = { name: "app", version: "1", path: "/mcp" };
    const at = (manifest: boolean | FarmAppManifestConfig) =>
      createFarmAppManifest({ ...withSections(manifest), defaultMCP: () => server }).mcp!.servers;
    expect(at(true)[0]!.tools.length).toBeGreaterThan(1);
    expect(at({ mcp: { hide: ["app"] } })).toEqual([]);
    const [first, ...rest] = at(true)[0]!.tools;
    expect(at({ mcp: { hide: [`app/${first!.name}`] } })[0]!.tools).toEqual(rest);
    expect(JSON.stringify(at({ mcp: { schemas: false } }))).not.toContain("inputSchema");
  });

  it("hides WebMCP tools by name", () => {
    expect(manifestFor({ webmcp: { hide: ["delete_todo"] } }).webmcp).toEqual({
      enabled: true,
      tools: [{ name: "list_todos", readOnlyHint: true, inputSchemaSource: "none" }],
    });
  });

  it("travels with the serialized input a production build embeds", () => {
    const embedded = JSON.parse(
      JSON.stringify(withSections({ packages: "names", plugins: false })),
    );
    expect(createFarmAppManifest(embedded)).toMatchObject({
      packages: { "@farm.js/core": null },
      plugins: null,
    });
  });

  it("resolves through agent config, and rejects unknown keys and bad values", () => {
    expect(resolveFarmAgentConfig(undefined).manifest).toEqual(resolveFarmAgentConfig({}).manifest);
    expect(resolveFarmAgentConfig({ manifest: false }).manifest).toBe(false);
    const resolved = resolveFarmAgentConfig({
      manifest: { app: { build: false }, mcp: { hide: ["store"] }, plugins: false },
    }).manifest;
    expect(resolved).toEqual({
      app: { version: true, renderer: true, build: false },
      packages: true,
      mcp: { schemas: true, hide: ["store"] },
      webmcp: { hide: [] },
      integrations: true,
      agent: true,
      plugins: false,
    });
    // Resolved config passes through unchanged.
    expect(
      resolveFarmAgentConfig({ manifest: resolved as FarmAppManifestConfig }).manifest,
    ).toEqual(resolved);
    const cases: [unknown, RegExp][] = [
      ["yes", /agent\.manifest must be true, false, or an options object/],
      [{ tools: false }, /agent\.manifest has an unknown option "tools"/],
      [{ app: { farm: false } }, /agent\.manifest\.app has an unknown option "farm"/],
      [{ app: "no" }, /agent\.manifest\.app must be true, false, or an options object/],
      [{ app: { build: "no" } }, /agent\.manifest\.app\.build must be a boolean/],
      [{ packages: "versions" }, /agent\.manifest\.packages must be true, false, or "names"/],
      [{ mcp: { hide: "store" } }, /agent\.manifest\.mcp\.hide must be an array/],
      [{ mcp: { hide: [""] } }, /agent\.manifest\.mcp\.hide must be an array/],
      [{ mcp: { schemas: 0 } }, /agent\.manifest\.mcp\.schemas must be a boolean/],
      [{ webmcp: { hide: [1] } }, /agent\.manifest\.webmcp\.hide must be an array/],
      [{ webmcp: { schemas: false } }, /agent\.manifest\.webmcp has an unknown option/],
      [{ plugins: "names" }, /agent\.manifest\.plugins must be a boolean/],
    ];
    for (const [manifest, message] of cases) {
      expect(() => resolveFarmAgentConfig({ manifest } as never)).toThrow(message);
    }
  });
});

describe("package versions", () => {
  const roots: string[] = [];
  afterEach(() =>
    roots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true })),
  );

  it("reads installed @farm.js and @farming-labs versions, hoisted or not, and nothing else", () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "farm-manifest-"));
    roots.push(workspace);
    const app = path.join(workspace, "apps", "web");
    const install = (dir: string, name: string, version: string) => {
      fs.mkdirSync(path.join(dir, "node_modules", name), { recursive: true });
      fs.writeFileSync(
        path.join(dir, "node_modules", name, "package.json"),
        JSON.stringify({ version }),
      );
    };
    fs.mkdirSync(app, { recursive: true });
    fs.writeFileSync(
      path.join(app, "package.json"),
      JSON.stringify({
        dependencies: { "@farm.js/core": "^0.1.0", react: "19.2.8", "@farming-labs/docs": "*" },
        devDependencies: { "@farm.js/cli": "workspace:*", "@farm.js/missing": "1" },
      }),
    );
    install(app, "@farm.js/core", "0.1.31");
    install(workspace, "@farm.js/cli", "0.1.31");
    install(workspace, "@farming-labs/docs", "0.2.126");
    install(workspace, "react", "19.2.8");
    expect(resolveFarmAppPackages(app)).toEqual({
      "@farm.js/cli": "0.1.31",
      "@farm.js/core": "0.1.31",
      "@farming-labs/docs": "0.2.126",
    });
    expect(resolveFarmAppPackages(path.join(workspace, "nowhere"))).toEqual({});
  });
});
