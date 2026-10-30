import { describe, expect, it, vi } from "vitest";
import { resolveMarkdownConfig } from "@farm.js/core/markdown";
import {
  collectFarmLlmsTxtPages,
  createFarmDefaultLlmsTxt,
  createFarmLlmsFullRenderer,
  createFarmLlmsMarkdownReader,
  createFarmMetadataRouteResponse,
  farmPathGuardCoversPage,
  renderFarmLlmsFullTxt,
  resolveFarmLlmsTxtConfig,
} from "@farm.js/core/internal/production-runtime";
import { FARM_MARKDOWN_ANONYMOUS_CLIENT_ADDRESS } from "@farm.js/core/internal/app-markdown-runtime";
import { parseRoutePath } from "../../../../farm/src/utils";
import type { EntryContext } from "../types.js";
import { generateRscEntry } from "./rsc.js";

const context: EntryContext = {
  srcDir: "src",
  outDir: "dist",
  basePath: "/",
  actionsEnabled: false,
  serverActions: { allowedOrigins: [], bodySizeLimit: 1024 * 1024 } as never,
  deploymentId: "llms-test",
  debug: false,
  markdown: resolveMarkdownConfig(undefined),
};

const PAGES: Record<string, Record<string, unknown>> = {
  "/page.tsx": { metadata: { title: "Home" } },
  "/pricing/page.tsx": { metadata: { title: "Pricing", description: "Plans and prices." } },
  "/(marketing)/about/page.tsx": { metadata: { title: "About" } },
  "/blog/[slug]/page.tsx": { metadata: { title: "Post" } },
  "/drafts/page.tsx": { metadata: { title: "Drafts", robots: { index: false } } },
};

/** Runs the generated llms.txt handler with the real core llms helpers. */
function createLlmsHandler(
  llmsTxt: Parameters<typeof resolveFarmLlmsTxtConfig>[0],
  options: {
    pages?: Record<string, Record<string, unknown>>;
    middlewares?: Record<string, unknown>;
    configMiddleware?: unknown[];
  } = {},
) {
  const config = resolveFarmLlmsTxtConfig(llmsTxt);
  const entry = generateRscEntry({ ...context, llmsTxt: config });
  const start = entry.indexOf("function createFarmLlmsTxtContext(");
  const end = entry.indexOf("/**\n * Serves a page's Markdown mirror", start);
  const routeStart = entry.indexOf("function middlewarePathToRoute(");
  const routeEnd = entry.indexOf("function middlewareRouteDepth(", routeStart);
  const pageReads: Request[] = [];
  const pageReadContexts: unknown[] = [];
  const handler = vi.fn(async (request: Request, readContext?: unknown) => {
    pageReads.push(request);
    pageReadContexts.push(readContext);
    const { pathname } = new URL(request.url);
    return new Response(`# ${pathname}\n\nBody of ${pathname}.\n`, {
      headers: { "content-type": "text/markdown; charset=utf-8" },
    });
  });
  const rootLayout = { metadata: { title: "Farm Shop", description: "Everything we sell." } };
  const run = new Function(
    "pageRoutes",
    "layouts",
    "getRouteModules",
    "handler",
    "farmMarkdownConfig",
    "farmLlmsTxtConfig",
    "farmLlmsFullRenderer",
    "collectFarmLlmsTxtPages",
    "createFarmDefaultLlmsTxt",
    "createFarmLlmsMarkdownReader",
    "createFarmMetadataRouteResponse",
    "renderFarmLlmsFullTxt",
    "middlewares",
    "farmConfigMiddleware",
    "farmPathGuardCoversPage",
    "FARM_MARKDOWN_ANONYMOUS_CLIENT_ADDRESS",
    `${entry.slice(routeStart, routeEnd)}\n${entry.slice(start, end)}; return handleFarmLlmsTxtRequest;`,
  )(
    Object.entries(options.pages ?? PAGES).map(([filePath, module]) => ({
      filePath,
      module,
      segments: parseRoutePath(filePath).segments,
    })),
    {},
    (pattern: string, _modules: unknown, kind: string) =>
      pattern === "/page.tsx" && kind === "layout" ? [rootLayout] : [],
    handler,
    context.markdown,
    config,
    createFarmLlmsFullRenderer({ revalidate: config.revalidate }),
    collectFarmLlmsTxtPages,
    createFarmDefaultLlmsTxt,
    createFarmLlmsMarkdownReader,
    createFarmMetadataRouteResponse,
    renderFarmLlmsFullTxt,
    options.middlewares ?? {},
    options.configMiddleware ?? [],
    farmPathGuardCoversPage,
    FARM_MARKDOWN_ANONYMOUS_CLIENT_ADDRESS,
  ) as (request: Request, context?: unknown) => Promise<Response | null>;
  return { run, handler, pageReads, pageReadContexts };
}

describe("RSC llms.txt", () => {
  it("emits no llms.txt code when agent.llmsTxt is off", () => {
    const entry = generateRscEntry({ ...context, llmsTxt: resolveFarmLlmsTxtConfig(false) });
    expect(entry).not.toContain("handleFarmLlmsTxtRequest");
    expect(entry).not.toContain("farmLlmsTxtConfig");
  });

  it("answers after middleware and API routes", () => {
    const entry = generateRscEntry({ ...context, llmsTxt: resolveFarmLlmsTxtConfig(true) });
    const middleware = entry.indexOf("await executeMiddleware(request, context)");
    const api = entry.indexOf("await handleAPIRequest(request.clone())");
    const llms = entry.indexOf("await handleFarmLlmsTxtRequest(request, context)");
    expect(middleware).toBeGreaterThan(-1);
    expect(llms).toBeGreaterThan(api);
    expect(api).toBeGreaterThan(middleware);
  });

  it("lists static, indexable pages with links to their Markdown mirrors", async () => {
    const { run, handler } = createLlmsHandler({ full: false });
    const response = await run(new Request("https://shop.test/llms.txt"));
    expect(response!.status).toBe(200);
    expect(response!.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(await response!.text()).toBe(
      [
        "# Farm Shop",
        "",
        "> Everything we sell.",
        "",
        "## Pages",
        "",
        "- [Home](https://shop.test/index.md)",
        "- [About](https://shop.test/about.md)",
        "- [Pricing](https://shop.test/pricing.md): Plans and prices.",
        "",
      ].join("\n"),
    );
    expect(handler).not.toHaveBeenCalled();
  });

  it("leaves llms-full.txt to the app unless full is on", async () => {
    const { run } = createLlmsHandler({ full: false });
    expect(await run(new Request("https://shop.test/llms-full.txt"))).toBeNull();
    expect(await run(new Request("https://shop.test/pricing"))).toBeNull();
  });

  it("inlines each page's mirror, read without the caller's cookies", async () => {
    const { run, pageReads } = createLlmsHandler(true);
    const response = await run(
      new Request("https://shop.test/llms-full.txt", { headers: { cookie: "session=secret" } }),
    );
    const body = await response!.text();
    expect(body).toContain("## Pricing\n\nURL: https://shop.test/pricing.md");
    expect(body).toContain("Body of /pricing.md.");
    expect(pageReads.map((request) => new URL(request.url).pathname).sort()).toEqual([
      "/about.md",
      "/index.md",
      "/pricing.md",
    ]);
    for (const request of pageReads) {
      expect(request.headers.get("cookie")).toBeNull();
      expect(request.headers.get("x-farm-internal-read")).toBe("llms-full");
    }
  });

  it("reads pages as an anonymous visitor, never with the caller's client address", async () => {
    const { run, pageReadContexts } = createLlmsHandler(true);
    const waitUntil = vi.fn();
    const response = await run(new Request("https://shop.test/llms-full.txt"), {
      clientAddress: "127.0.0.1",
      waitUntil,
      secret: "caller-only",
    });
    expect(response!.status).toBe(200);
    expect(pageReadContexts).toHaveLength(3);
    for (const readContext of pageReadContexts) {
      expect(readContext).toEqual({
        clientAddress: FARM_MARKDOWN_ANONYMOUS_CLIENT_ADDRESS,
        waitUntil,
      });
    }
  });

  it("leaves pages under a path guard out of llms.txt and llms-full.txt", async () => {
    const pages = {
      ...PAGES,
      "/internal/page.tsx": { metadata: { title: "Internal" } },
      "/(staff)/payroll/page.tsx": { metadata: { title: "Payroll" } },
      "/billing/page.tsx": { metadata: { title: "Billing" } },
    };
    const { run, pageReads } = createLlmsHandler(true, {
      pages,
      middlewares: {
        // The root middleware runs for every page and names none.
        "/middleware.ts": {},
        "/internal/middleware.ts": {},
        "/(staff)/payroll/middleware.ts": {},
      },
      configMiddleware: [{ matcher: "/billing" }, { matcher: "/(.*)" }],
    });
    const list = await (await run(new Request("https://shop.test/llms.txt")))!.text();
    expect(list).toContain("[Pricing](https://shop.test/pricing.md)");
    expect(list).not.toContain("Internal");
    expect(list).not.toContain("Payroll");
    expect(list).not.toContain("Billing");
    await (await run(new Request("https://shop.test/llms-full.txt")))!.text();
    expect(pageReads.map((request) => new URL(request.url).pathname).sort()).toEqual([
      "/about.md",
      "/index.md",
      "/pricing.md",
    ]);
  });

  it("reads no pages for HEAD", async () => {
    const { run, handler } = createLlmsHandler(true);
    const response = await run(new Request("https://shop.test/llms-full.txt", { method: "HEAD" }));
    expect(response!.status).toBe(200);
    expect(await response!.text()).toBe("");
    expect(handler).not.toHaveBeenCalled();
  });

  it("rejects other methods", async () => {
    const { run } = createLlmsHandler(true);
    const response = await run(new Request("https://shop.test/llms.txt", { method: "POST" }));
    expect(response!.status).toBe(405);
    expect(response!.headers.get("allow")).toBe("GET, HEAD");
  });
});
