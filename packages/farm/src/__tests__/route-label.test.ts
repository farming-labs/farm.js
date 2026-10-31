import { afterEach, describe, expect, it, vi } from "vitest";
import { PluginManager } from "../plugin";
import { registerFarmMCPServer } from "../mcp-catalog";
import { farmInfraAnalyticsPlugin, farmInfraAnalyticsRecorder } from "../plugins/infra-analytics";
import {
  getFarmRouteLabel,
  listFarmBuiltInRoutePaths,
  resolveFarmDocsEngineRouteLabel,
  resolveFarmDocsRouteLabel,
  resolveFarmMarkdownRouteLabel,
  resolveFarmMCPRouteLabel,
  setFarmRouteLabel,
} from "../route-label";

const docs = { path: "/docs", apiPath: "/api/docs" };
const options = { endpoint: "https://infra.example/events", key: `fti_${"a".repeat(43)}` };
const routes = (send: { mock: { calls: unknown[][] } }) =>
  send.mock.calls.flatMap(([, init]) =>
    (JSON.parse((init as RequestInit).body as string).events as { route: string }[]).map(
      ({ route }) => route,
    ),
  );

describe("route labels", () => {
  const cleanups: (() => void)[] = [];
  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
    vi.restoreAllMocks();
  });

  it("names Farm's built-in endpoints by their fixed paths", () => {
    expect(
      listFarmBuiltInRoutePaths({
        agent: {
          apiCatalog: true,
          mcp: true,
          llmsTxt: { enabled: true, full: true },
          sitemap: { enabled: true },
          crawlers: { enabled: true },
        },
        openapi: { route: "/reference", specRoute: "/openapi.json" },
      }),
    ).toEqual([
      "/.well-known/farmjs.json",
      "/.well-known/farmjs",
      "/.well-known/api-catalog",
      "/.well-known/ai-catalog.json",
      "/.well-known/ard.json",
      "/mcp",
      "/mcp/server-card",
      "/llms.txt",
      "/llms-full.txt",
      "/sitemap.xml",
      "/robots.txt",
      "/reference",
      "/openapi.json",
    ]);
    expect(
      listFarmBuiltInRoutePaths({ agent: { manifest: false, aiCatalog: false, mcp: false } }),
    ).toEqual([]);
  });

  it("names a registered MCP server and its card, not other paths", () => {
    cleanups.push(registerFarmMCPServer({ name: "docs", version: "1", path: "/agent/mcp" }));
    expect(resolveFarmMCPRouteLabel("/agent/mcp")).toBe("/agent/mcp");
    expect(resolveFarmMCPRouteLabel("/agent/mcp/")).toBe("/agent/mcp");
    expect(resolveFarmMCPRouteLabel("/agent/mcp/server-card")).toBe("/agent/mcp/server-card");
    expect(resolveFarmMCPRouteLabel("/agent/mcp/other")).toBeNull();
    expect(resolveFarmMCPRouteLabel("/mcp")).toBeNull();
  });

  it("names docs pages by the routes the docs engine registers", () => {
    expect(resolveFarmDocsRouteLabel("/docs", docs)).toBe("/docs");
    expect(resolveFarmDocsRouteLabel("/docs/", docs)).toBe("/docs");
    expect(resolveFarmDocsRouteLabel("/docs/routing", docs)).toBe("/docs/[...slug]");
    expect(resolveFarmDocsRouteLabel("/docs/a/b/private-page", docs)).toBe("/docs/[...slug]");
    expect(resolveFarmDocsRouteLabel("/docs.md", docs)).toBe("/docs.md");
    expect(resolveFarmDocsRouteLabel("/docs/routing.md", docs)).toBe("/docs/[...slug].md");
    expect(resolveFarmDocsRouteLabel("/api/docs", docs)).toBe("/api/docs");
    expect(resolveFarmDocsRouteLabel("/api/docs/private.md", docs)).toBe("/api/docs/[...path]");
    expect(resolveFarmDocsRouteLabel("/docsearch", docs)).toBeNull();
    expect(resolveFarmDocsRouteLabel("/blog", docs)).toBeNull();
    expect(resolveFarmDocsRouteLabel("/", { path: "/" })).toBe("/");
    expect(resolveFarmDocsRouteLabel("/index.md", { path: "/" })).toBe("/index.md");
    expect(resolveFarmDocsRouteLabel("/routing", { path: "/" })).toBe("/[...slug]");
  });

  it("names what the docs engine answered without carrying nested request input", () => {
    expect(resolveFarmDocsEngineRouteLabel("/docs/routing", docs)).toBe("/docs/[...slug]");
    expect(resolveFarmDocsEngineRouteLabel("/mcp", docs)).toBe("/mcp");
    expect(resolveFarmDocsEngineRouteLabel("/llms-full.txt", docs)).toBe("/llms-full.txt");
    expect(resolveFarmDocsEngineRouteLabel("/.well-known/agent.json", docs)).toBe(
      "/.well-known/agent.json",
    );
    expect(resolveFarmDocsEngineRouteLabel("/.well-known/mcp/server-card", docs)).toBe(
      "/.well-known/mcp/[...path]",
    );
    expect(resolveFarmDocsEngineRouteLabel("/api-reference/private-operation", docs)).toBe(
      "/api-reference/[...path]",
    );
  });

  it("names a Markdown mirror by its page's pattern", () => {
    const match = (pathname: string) =>
      pathname === "/" ? "/" : pathname.startsWith("/blog/") ? "/blog/[slug]" : null;
    expect(resolveFarmMarkdownRouteLabel("/blog/private-post.md", match)).toBe("/blog/[slug].md");
    expect(resolveFarmMarkdownRouteLabel("/index.md", match)).toBe("/index.md");
    expect(resolveFarmMarkdownRouteLabel("/missing.md", match)).toBeNull();
    expect(resolveFarmMarkdownRouteLabel("/blog/private-post", match)).toBeNull();
  });

  it("prefers a payload's label over its pattern and keeps the pattern without one", () => {
    const route = { pathname: "/x", pattern: "/[id]" };
    expect(getFarmRouteLabel(route)).toBe("/[id]");
    setFarmRouteLabel(route, null);
    expect(getFarmRouteLabel(route)).toBe("/[id]");
    setFarmRouteLabel(route, "/[id].md");
    expect(getFarmRouteLabel(route)).toBe("/[id].md");
    expect(route.pattern).toBe("/[id]");
    expect(JSON.stringify(route)).toBe('{"pathname":"/x","pattern":"/[id]"}');
  });

  it("reports the label a handler sets while it answers", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 202 }));
    const recorder = farmInfraAnalyticsRecorder(options, send);
    const route = { pathname: "/llms-full.txt" };
    await recorder.record(
      new Request("https://app.example/llms-full.txt"),
      { route },
      undefined,
      () => {
        setFarmRouteLabel(route, "/llms-full.txt");
        return Promise.resolve(new Response("docs"));
      },
    );
    await recorder.record(
      new Request("https://app.example/private-path"),
      { route: { pathname: "/private-path" } },
      undefined,
      async () => new Response(null, { status: 404 }),
    );
    await recorder.close();
    expect(routes(send)).toEqual(["/llms-full.txt", "/[unmatched]"]);
  });

  it("records a plugin endpoint by its path", async () => {
    const send = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 202 }));
    const manager = new PluginManager({ config: {}, isDev: true, isProd: false });
    manager.addPlugin(farmInfraAnalyticsPlugin(options));
    manager.addPlugin({
      name: "fixture-endpoint",
      runtime: { endpoints: [{ path: "/_fixture/ping", handler: () => new Response("pong") }] },
    });
    const work: Promise<unknown>[] = [];
    const response = await manager.runRuntimeRequest(
      new Request("https://app.example/_fixture/ping"),
      () => new Response("unreachable"),
      { kind: "page", route: { pathname: "/_fixture/ping" }, waitUntil: (job) => work.push(job) },
    );
    expect(await response.text()).toBe("pong");
    await Promise.all(work);
    await manager.closeRuntime("test");
    expect(routes(send)).toEqual(["/_fixture/ping"]);
  });
});
