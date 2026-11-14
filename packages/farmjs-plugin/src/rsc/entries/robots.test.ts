import { describe, expect, it } from "vitest";
import {
  createFarmAgentRobots,
  createFarmMetadataRouteResponse,
  resolveFarmAgentCrawlers,
  resolveFarmAgentSitemap,
} from "@farm.js/core/internal/production-runtime";
import type { EntryContext } from "../types.js";
import { generateRscEntry } from "./rsc.js";

const context: EntryContext = {
  srcDir: "src",
  outDir: "dist",
  basePath: "/",
  actionsEnabled: false,
  serverActions: { allowedOrigins: [], bodySizeLimit: 1024 * 1024 } as never,
  deploymentId: "robots-test",
  debug: false,
};

/** Runs the generated robots.txt response with core's real robots helpers. */
function createRobots(
  crawlers: Parameters<typeof resolveFarmAgentCrawlers>[0],
  options: { basePath?: string; sitemap?: boolean; rootMetadata?: Record<string, unknown> } = {},
) {
  const entry = generateRscEntry({
    ...context,
    basePath: options.basePath ?? "/",
    crawlers: resolveFarmAgentCrawlers(crawlers),
    sitemap: resolveFarmAgentSitemap(options.sitemap ?? true),
  });
  const start = entry.indexOf("function createFarmAgentRobotsResponse(");
  const end = entry.indexOf("/**\n * Serves a page's Markdown mirror", start);
  expect(start).toBeGreaterThan(-1);
  const rootLayout = { metadata: options.rootMetadata ?? {} };
  return new Function(
    "layouts",
    "getRouteModules",
    "createFarmAgentRobots",
    "createFarmMetadataRouteResponse",
    `${entry.match(/const farmAgentCrawlers = .*\n/)![0]}
${entry.slice(start, end)}
return createFarmAgentRobotsResponse;`,
  )(
    {},
    (_pattern: string, _modules: unknown, kind: string) => (kind === "layout" ? [rootLayout] : []),
    createFarmAgentRobots,
    createFarmMetadataRouteResponse,
  ) as (request: Request) => Response;
}

describe("RSC robots.txt from agent.crawlers", () => {
  it("is off by default, as in core, and emits no code until agent.crawlers is set", () => {
    const off = generateRscEntry({ ...context, sitemap: resolveFarmAgentSitemap(true) });
    expect(off).not.toContain("robots.txt");
    expect(off).not.toContain("createFarmAgentRobots");

    const on = generateRscEntry({ ...context, crawlers: resolveFarmAgentCrawlers(true) });
    const middleware = on.indexOf("await executeMiddleware(request, context)");
    const api = on.indexOf("await handleAPIRequest(cloneFarmRequestWithContext(request))");
    const robots = on.indexOf("createFarmAgentRobotsResponse(request)");
    // Answered after middleware and API routes, at the path routes see: /console/robots.txt.
    expect(api).toBeGreaterThan(middleware);
    expect(robots).toBeGreaterThan(api);
    expect(on).toContain(
      "if (getFarmRoutePathname(url.pathname.replace(/\\/+$/, '') || '/') === '/robots.txt') {",
    );
  });

  it("names the AI crawlers and the sitemap below the basePath on metadataBase", async () => {
    const respond = createRobots(
      { search: "allow", training: "block" },
      { basePath: "/console", rootMetadata: { metadataBase: new URL("https://shop.example") } },
    );
    const response = respond(new Request("http://127.0.0.1/console/robots.txt"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    const body = await response.text();
    expect(body).toContain("User-agent: OAI-SearchBot\n");
    expect(body).toContain("User-agent: GPTBot\n");
    expect(body).toMatch(/User-agent: Bytespider\nDisallow: \//);
    expect(body).toContain("User-agent: *\nAllow: /");
    expect(body).toContain("Sitemap: https://shop.example/console/sitemap.xml");

    expect(
      respond(new Request("http://127.0.0.1/console/robots.txt", { method: "POST" })).status,
    ).toBe(405);
  });

  it("leaves out the Sitemap line without a metadataBase or a sitemap", async () => {
    // The request's host is not trusted in a file crawlers and CDNs cache.
    const withoutBase = await createRobots(true)(
      new Request("https://shop.test/robots.txt"),
    ).text();
    expect(withoutBase).not.toContain("Sitemap:");
    const withoutSitemap = await createRobots(true, {
      sitemap: false,
      rootMetadata: { metadataBase: "https://shop.example" },
    })(new Request("https://shop.test/robots.txt")).text();
    expect(withoutSitemap).toBe("User-agent: *\nAllow: /\n");
  });
});
