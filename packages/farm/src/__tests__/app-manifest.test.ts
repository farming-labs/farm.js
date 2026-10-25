import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  createFarmAppManifest,
  createFarmAppManifestResponse,
  isFarmAppManifestPath,
  FARM_INFRA_SIGNATURE_HEADER,
  resolveFarmAppManifestInput,
  signFarmInfraManifestRequest,
  verifyFarmInfraManifestSignature,
} from "../app-manifest";
import { resolveFarmAppPackages } from "../app-manifest-packages";
import { defineIntegration } from "../integrations";
import { _publishFarmMCPCatalog } from "../mcp-catalog";
import { farmPathGuardCoversEndpoint } from "../middleware/may-handle";
import { FARM_VERSION } from "../version";

const key = `fti_${"k".repeat(43)}`;
const keyHash = createHash("sha256").update(key).digest("hex");
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
    expect(createFarmAppManifest(input, { full: true })).toEqual({
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
                method: "GET",
                path: "/api/orders",
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
    const [store] = createFarmAppManifest(input).mcp.servers;
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
      const [store] = createFarmAppManifest(guarded).mcp.servers;
      expect(store).toMatchObject({ name: "store", authorization: "required" });
      expect(store).toMatchObject({ tools: [], resources: [], prompts: [] });
      expect(JSON.stringify(createFarmAppManifest(guarded))).not.toMatch(/list_orders|handbook/);
      // Farm Infra's signed view keeps the detail.
      expect(createFarmAppManifest(guarded, { full: true }).mcp.servers[0]!.tools).toHaveLength(3);
    }

    // Guards that cover every path, or another path, leave a public server's tools listed.
    for (const open of [
      guardedBy({ middleware: [{ matcher: "/(.*)" }, { handler() {} }, { matcher: "/admin" }] }),
      guardedBy({}, [{ path: "/" }, { path: "/api/admin" }]),
    ]) {
      const [store] = createFarmAppManifest(open).mcp.servers;
      expect(store).toMatchObject({ authorization: "none" });
      expect(store!.tools).toHaveLength(3);
    }
  });

  it("lists a server that requires authorize by identity only, except in Infra's view", () => {
    publishStore({ isPublic: false });
    expect(createFarmAppManifest(input).mcp.servers).toEqual([
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
    const [full] = createFarmAppManifest(input, { full: true }).mcp.servers;
    expect(full!.authorization).toBe("required");
    expect(full!.tools).toHaveLength(3);
    expect(full!.resources).toHaveLength(1);
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
    expect(createFarmAppManifest(input).mcp.servers).toEqual([]);
    unpublish.push(
      _publishFarmMCPCatalog({ name: "old", version: "1", path: "/api/old" }, [
        { name: "ping", kind: "standalone" },
      ]),
    );
    // An older @farm.js/mcp doesn't say whether it's public, so the public view assumes not.
    expect(createFarmAppManifest(input).mcp.servers[0]!.tools).toEqual([]);
    expect(createFarmAppManifest(input, { full: true }).mcp.servers[0]).toEqual({
      name: "old",
      version: "1",
      path: "/api/old",
      authorization: "required",
      resources: [],
      prompts: [],
      tools: [{ name: "ping", source: "defineTool" }],
    });
  });
});

describe("Farm Infra signature", () => {
  const now = Date.parse("2026-10-23T12:00:00.000Z");

  it("accepts a fresh signature for the app's key, made from the key's hash", async () => {
    const header = await signFarmInfraManifestRequest(keyHash, now);
    expect(header).toMatch(/^t=\d+, v1=[0-9a-f]{64}$/);
    expect(await verifyFarmInfraManifestSignature(header, key, now)).toBe(true);
    // Infra may sign for several keys; one match is enough.
    const other = await signFarmInfraManifestRequest("0".repeat(64), now);
    const both = `${header}, ${other.split(", ")[1]}`;
    expect(await verifyFarmInfraManifestSignature(both, key, now + 60_000)).toBe(true);
  });

  it("matches Farm Infra's signer byte for byte", async () => {
    // The same vector is pinned in farmjs-infra apps/web/src/lib/app-manifest-store.test.ts.
    expect(await signFarmInfraManifestRequest("f".repeat(64), now)).toBe(
      "t=1792756800, v1=c7565ef379ae5c1550db4adcf5a72a0406336b7816d732fab2585e3e88dcf17d",
    );
  });

  it("refuses another key, an old or future signature, and malformed headers", async () => {
    const header = await signFarmInfraManifestRequest(keyHash, now);
    expect(await verifyFarmInfraManifestSignature(header, `${key}x`, now)).toBe(false);
    expect(await verifyFarmInfraManifestSignature(header, key, now + 301_000)).toBe(false);
    expect(await verifyFarmInfraManifestSignature(header, key, now - 301_000)).toBe(false);
    for (const bad of [null, "", "t=abc, v1=00", `v1=${"a".repeat(64)}`, `t=${now / 1000}`])
      expect(await verifyFarmInfraManifestSignature(bad, key, now)).toBe(false);
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

  const signed = async (method = "GET") =>
    request({ [FARM_INFRA_SIGNATURE_HEADER]: await signFarmInfraManifestRequest(keyHash) }, method);
  const env = { FARMJS_API_KEY: key };

  it("answers anyone, with CORS and a revalidated ETag, and never contains the key", async () => {
    publishStore({ isPublic: false });
    for (const options of [{ env }, { env: {} }]) {
      const response = await createFarmAppManifestResponse(request(), input, options);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
      expect(response.headers.get("cache-control")).toBe("public, max-age=0, must-revalidate");
      expect(response.headers.get("access-control-allow-origin")).toBe("*");
      expect(response.headers.get("vary")).toBe(FARM_INFRA_SIGNATURE_HEADER);
      const body = await response.text();
      expect(JSON.parse(body).mcp.servers[0].tools).toEqual([]);
      expect(body).not.toContain(key);
      expect(body).not.toContain(keyHash);
    }
    const etag = (await createFarmAppManifestResponse(request(), input, { env })).headers.get(
      "etag",
    )!;
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

  it("gives Farm Infra's signed request the full view, kept out of shared caches", async () => {
    publishStore({ isPublic: false });
    const response = await createFarmAppManifestResponse(await signed(), input, { env });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = await response.text();
    const manifest = JSON.parse(body);
    expect(manifest.app.build).toBe("abc123");
    expect(manifest.mcp.servers[0].tools[0]).toMatchObject({ method: "GET", path: "/api/orders" });
    expect(body).not.toContain(key);
    expect(body).not.toContain(keyHash);
    const head = await createFarmAppManifestResponse(await signed("HEAD"), input, { env });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
  });

  it("serves a signed request the public view without the key, a valid signature, or analytics", async () => {
    publishStore({ isPublic: false });
    const forged = request({
      [FARM_INFRA_SIGNATURE_HEADER]: await signFarmInfraManifestRequest("0".repeat(64)),
    });
    for (const [req, options, manifestInput] of [
      [await signed(), { env: {} }, input],
      [forged, { env }, input],
      [await signed(), { env }, { ...input, analytics: false }],
    ] as const) {
      const response = await createFarmAppManifestResponse(req, manifestInput, options);
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("public, max-age=0, must-revalidate");
      expect((await response.json()).mcp.servers[0].tools).toEqual([]);
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
