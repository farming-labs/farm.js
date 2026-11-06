import { afterEach, describe, expect, it } from "vitest";
import {
  collectFarmDefaultMCPPages,
  createFarmDefaultMCPServer,
  farmConfigMountsMCP,
  FARM_DEFAULT_MCP_TOOLS,
  resolveFarmDefaultMCPServer,
} from "../agent-mcp";
import { handleFarmDefaultMCPRequest, type FarmDefaultMCPContext } from "../agent-mcp-handler";
import { resolveFarmAgentConfig } from "../agent-config";
import { createFarmAiCatalogResponse, listFarmMCPLlmsTxtLinks } from "../ai-catalog";
import { createFarmAppManifest } from "../app-manifest";
import { resolveMarkdownConfig } from "../markdown";
import { _publishFarmMCPCatalog, registerFarmMCPServer } from "../mcp-catalog";

const ORIGIN = "https://acme.test";
const server = createFarmDefaultMCPServer({ name: "acme", version: "2.0.0" }, "0.1.0");

const pages = collectFarmDefaultMCPPages(
  [
    { pattern: "/", module: { metadata: { title: "Home", description: "Acme builds tools." } } },
    { pattern: "/about", module: { metadata: { title: "About us" } } },
    { pattern: "/pricing", module: { metadata: { title: "Pricing", description: "Plans" } } },
    { pattern: "/blog/[slug]", module: {} },
    { pattern: "/drafts", module: { metadata: { robots: { index: false } } } },
    { pattern: "/account", module: { __farmRouteGuard: () => undefined } },
  ],
  { origin: ORIGIN, markdown: resolveMarkdownConfig(undefined) },
);

const reads: string[] = [];
const context: FarmDefaultMCPContext = {
  server,
  listPages: () => pages,
  readMarkdown: async (url) => {
    reads.push(url);
    return url.endsWith("/about.md") ? "# About us\n\nWe ship.\n" : null;
  },
};

function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request(`${ORIGIN}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function rpc(method: string, params?: unknown, id: number | string = 1) {
  const response = await handleFarmDefaultMCPRequest(
    post({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) }),
    context,
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
  return (await response.json()) as { id: unknown; result?: any; error?: any };
}

const unregister: Array<() => void> = [];
afterEach(() => {
  for (const dispose of unregister.splice(0)) dispose();
  reads.length = 0;
});

describe("default MCP pages", () => {
  it("lists static pages, without dynamic, noindex, or guarded pages", () => {
    expect(pages).toEqual([
      {
        path: "/",
        title: "Home",
        url: "https://acme.test/",
        description: "Acme builds tools.",
        markdownUrl: "https://acme.test/index.md",
      },
      {
        path: "/about",
        title: "About us",
        url: "https://acme.test/about",
        markdownUrl: "https://acme.test/about.md",
      },
      {
        path: "/pricing",
        title: "Pricing",
        url: "https://acme.test/pricing",
        description: "Plans",
        markdownUrl: "https://acme.test/pricing.md",
      },
    ]);
  });

  it("lists only pages with a Markdown mirror, below the base path", () => {
    expect(
      collectFarmDefaultMCPPages([{ pattern: "/" }, { pattern: "/docs" }, { pattern: "/app" }], {
        origin: ORIGIN,
        basePath: "/base",
        markdown: resolveMarkdownConfig({ expose: ["/docs"] }),
      }),
    ).toEqual([
      {
        path: "/docs",
        title: "Docs",
        url: "https://acme.test/base/docs",
        markdownUrl: "https://acme.test/base/docs.md",
      },
    ]);
    expect(
      collectFarmDefaultMCPPages([{ pattern: "/" }], {
        origin: ORIGIN,
        markdown: resolveMarkdownConfig(false),
      }),
    ).toEqual([]);
  });
});

describe("default MCP protocol", () => {
  it("initializes with the app's identity and a negotiated protocol version", async () => {
    const reply = await rpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "1" },
    });
    expect(reply.result).toMatchObject({
      protocolVersion: "2025-06-18",
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "acme", version: "2.0.0" },
    });
    expect(reply.result.instructions).toContain("read_page");

    const future = await rpc("initialize", { protocolVersion: "2099-01-01", capabilities: {} });
    expect(future.result.protocolVersion).toBe("2025-11-25");
    expect((await rpc("ping")).result).toEqual({});
  });

  it("lists read-only tools with schemas and descriptions agents can use", async () => {
    const { result } = await rpc("tools/list");
    expect(result.tools.map((tool: { name: string }) => tool.name)).toEqual([
      "list_pages",
      "search_pages",
      "read_page",
    ]);
    for (const tool of result.tools) {
      expect(tool.description.length).toBeGreaterThanOrEqual(30);
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    }
  });

  it("lists, searches, and reads public pages", async () => {
    const listed = await rpc("tools/call", { name: "list_pages", arguments: {} });
    expect(listed.result.structuredContent.pages.map((page: any) => page.path)).toEqual([
      "/",
      "/about",
      "/pricing",
    ]);
    expect(JSON.parse(listed.result.content[0].text)).toEqual(listed.result.structuredContent);

    const found = await rpc("tools/call", { name: "search_pages", arguments: { query: "PLANS" } });
    expect(found.result.structuredContent.pages).toEqual([
      {
        path: "/pricing",
        title: "Pricing",
        url: "https://acme.test/pricing",
        description: "Plans",
      },
    ]);
    const none = await rpc("tools/call", {
      name: "search_pages",
      arguments: { query: "about nothing" },
    });
    expect(none.result.structuredContent.pages).toEqual([]);

    for (const path of ["/about", "/about/", "/about.md", "https://acme.test/about"]) {
      const read = await rpc("tools/call", { name: "read_page", arguments: { path } });
      expect(read.result).toEqual({
        content: [{ type: "text", text: "# About us\n\nWe ship.\n" }],
      });
    }
    expect(reads.every((url) => url === "https://acme.test/about.md")).toBe(true);
  });

  it("reads only listed pages: guarded, noindex, and other hosts are not found", async () => {
    for (const path of ["/account", "/drafts", "/blog/hello", "https://evil.test/about", "//x"]) {
      const read = await rpc("tools/call", { name: "read_page", arguments: { path } });
      expect(read.result.isError).toBe(true);
      expect(read.result.content[0].text).toContain("No public page");
    }
    expect(reads).toEqual([]);

    const unreadable = await rpc("tools/call", { name: "read_page", arguments: { path: "/" } });
    expect(unreadable.result).toMatchObject({ isError: true });
    expect(unreadable.result.content[0].text).toContain("did not answer with Markdown");
  });

  it("reports bad arguments as tool errors and unknown tools as JSON-RPC errors", async () => {
    const missing = await rpc("tools/call", { name: "read_page", arguments: {} });
    expect(missing.result.isError).toBe(true);
    const extra = await rpc("tools/call", { name: "list_pages", arguments: { x: 1 } });
    expect(extra.result.isError).toBe(true);
    const limit = await rpc("tools/call", {
      name: "search_pages",
      arguments: { query: "a", limit: 0 },
    });
    expect(limit.result.isError).toBe(true);

    expect((await rpc("tools/call", { name: "write_page", arguments: {} })).error).toMatchObject({
      code: -32602,
    });
    expect((await rpc("resources/list")).error).toMatchObject({ code: -32601 });
  });

  it("answers JSON-RPC and transport errors the way Streamable HTTP clients expect", async () => {
    const parse = await handleFarmDefaultMCPRequest(post("{"), context);
    expect(parse.status).toBe(400);
    expect(await parse.json()).toEqual({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32700, message: "Parse error." },
    });

    const invalid = await handleFarmDefaultMCPRequest(post({ id: 3, method: "ping" }), context);
    expect((await invalid.json()).error.code).toBe(-32600);

    const notification = await handleFarmDefaultMCPRequest(
      post({ jsonrpc: "2.0", method: "notifications/initialized" }),
      context,
    );
    expect(notification.status).toBe(202);
    expect(await notification.text()).toBe("");

    const batch = await handleFarmDefaultMCPRequest(
      post([
        { jsonrpc: "2.0", id: "a", method: "ping" },
        { jsonrpc: "2.0", method: "notifications/initialized" },
      ]),
      context,
    );
    expect(await batch.json()).toEqual([{ jsonrpc: "2.0", id: "a", result: {} }]);

    const get = await handleFarmDefaultMCPRequest(new Request(`${ORIGIN}/mcp`), context);
    expect(get.status).toBe(405);
    expect(get.headers.get("allow")).toBe("POST");

    const text = await handleFarmDefaultMCPRequest(
      new Request(`${ORIGIN}/mcp`, { method: "POST", body: "{}" }),
      context,
    );
    expect(text.status).toBe(415);

    const large = await handleFarmDefaultMCPRequest(post(" ".repeat(70 * 1024)), context);
    expect(large.status).toBe(413);

    const crossOrigin = await handleFarmDefaultMCPRequest(
      post({ jsonrpc: "2.0", id: 1, method: "ping" }, { origin: "https://evil.test" }),
      context,
    );
    expect(crossOrigin.status).toBe(403);

    const version = await handleFarmDefaultMCPRequest(
      post({ jsonrpc: "2.0", id: 1, method: "ping" }, { "mcp-protocol-version": "1999-01-01" }),
      context,
    );
    expect(version.status).toBe(400);
  });
});

describe("default MCP registration", () => {
  it("is on by default, off with docs, and off with agent.mcp: false", () => {
    expect(resolveFarmAgentConfig(undefined).mcp).toBe(true);
    expect(resolveFarmAgentConfig(undefined, { docs: true }).mcp).toBe(false);
    expect(resolveFarmAgentConfig({ mcp: false }).mcp).toBe(false);
    expect(resolveFarmAgentConfig({ mcp: true }, { docs: true }).mcp).toBe(true);
    expect(() => resolveFarmAgentConfig({ mcp: "yes" as never })).toThrow(
      "agent.mcp must be a boolean.",
    );
  });

  it("names the server after the app, or after Farm without a package", () => {
    expect(server).toMatchObject({ name: "acme", version: "2.0.0", path: "/mcp" });
    expect(createFarmDefaultMCPServer(undefined, "0.1.0")).toMatchObject({
      name: "farm-app",
      version: "0.1.0",
    });
  });

  it("steps aside for @farm.js/mcp in config and for any published or registered server", () => {
    expect(farmConfigMountsMCP({ mcp: { enabled: true } })).toBe(true);
    expect(farmConfigMountsMCP({ mcp: { enabled: false } })).toBe(false);
    expect(farmConfigMountsMCP({ plugins: [{ name: "farm:api-mcp" }] })).toBe(true);
    expect(farmConfigMountsMCP({ plugins: [{ name: "farm:devtools" }] })).toBe(false);

    expect(resolveFarmDefaultMCPServer(server)).toBe(server);
    unregister.push(registerFarmMCPServer({ name: "dev.farmjs/docs", version: "1", path: "/mcp" }));
    expect(resolveFarmDefaultMCPServer(server)).toBeUndefined();
    unregister.splice(0).forEach((dispose) => dispose());

    unregister.push(
      _publishFarmMCPCatalog({ name: "farm-api", version: "1.0.0", path: "/api/mcp" }, []),
    );
    expect(resolveFarmDefaultMCPServer(server)).toBeUndefined();
  });

  it("is listed in the AI catalog, its server card, and llms.txt only while it serves", async () => {
    const input = { defaultMCP: () => resolveFarmDefaultMCPServer(server) };
    const catalog = createFarmAiCatalogResponse(
      new Request(`${ORIGIN}/.well-known/ai-catalog.json`),
      input,
    );
    expect(await catalog!.json()).toMatchObject({
      entries: [
        { url: "https://acme.test/mcp/server-card", displayName: "acme", version: "2.0.0" },
      ],
    });
    const card = createFarmAiCatalogResponse(new Request(`${ORIGIN}/mcp/server-card`), input);
    expect(await card!.json()).toMatchObject({
      name: "test.acme/acme",
      remotes: [{ type: "streamable-http", url: "https://acme.test/mcp" }],
    });
    expect(listFarmMCPLlmsTxtLinks(ORIGIN, { ...input, basePath: "/base" })[0]).toMatchObject({
      url: "https://acme.test/base/mcp",
    });

    unregister.push(registerFarmMCPServer({ name: "dev.farmjs/docs", version: "1", path: "/mcp" }));
    const docs = createFarmAiCatalogResponse(
      new Request(`${ORIGIN}/.well-known/ai-catalog.json`),
      input,
    );
    expect((await docs!.json()).entries).toEqual([
      expect.objectContaining({ displayName: "dev.farmjs/docs" }),
    ]);
  });

  it("lists its tools in the public app manifest", () => {
    const manifest = createFarmAppManifest({
      renderer: "react",
      basePath: "/",
      build: "test",
      packages: {},
      webmcp: { enabled: false, tools: [] },
      integrations: [],
      agent: { apiCatalog: null, llmsTxt: true, openapi: null },
      plugins: [],
      defaultMCP: () => resolveFarmDefaultMCPServer(server),
    });
    expect(manifest.mcp.servers).toEqual([
      expect.objectContaining({
        name: "acme",
        path: "/mcp",
        authorization: "none",
        tools: FARM_DEFAULT_MCP_TOOLS.map((tool) =>
          expect.objectContaining({ name: tool.name, readOnlyHint: true }),
        ),
      }),
    ]);
  });
});
