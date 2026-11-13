import { describe, expect, it } from "vitest";
import {
  createFarmDefaultSitemap,
  createFarmMetadataRouteResponse,
  farmPathGuardCoversPage,
  isFarmPageNoIndex,
  resolveFarmAgentOrigin,
  resolveFarmAgentSitemap,
  stripFarmBasePath,
  stripFarmLocaleFromPathname,
} from "@farm.js/core/internal/production-runtime";
import { parseRoutePath } from "../../../../farm/src/utils";
import type { EntryContext } from "../types.js";
import { generateRscEntry } from "./rsc.js";

const context: EntryContext = {
  srcDir: "src",
  outDir: "dist",
  basePath: "/",
  actionsEnabled: false,
  serverActions: { allowedOrigins: [], bodySizeLimit: 1024 * 1024 } as never,
  deploymentId: "sitemap-test",
  debug: false,
};

function slice(entry: string, startMarker: string, endMarker: string): string {
  const start = entry.indexOf(startMarker);
  const end = entry.indexOf(endMarker, start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return entry.slice(start, end);
}

/** Runs the generated sitemap.xml response with core's real sitemap and listing helpers. */
function createSitemap(
  sitemap: Parameters<typeof resolveFarmAgentSitemap>[0],
  options: {
    pages: Record<string, Record<string, unknown>>;
    basePath?: string;
    middlewares?: Record<string, unknown>;
    rootMetadata?: Record<string, unknown>;
    lastModified?: Record<string, string>;
    trailingSlash?: boolean;
  },
) {
  const basePath = options.basePath ?? "/";
  const entry = generateRscEntry({
    ...context,
    basePath,
    trailingSlash: options.trailingSlash,
    sitemap: resolveFarmAgentSitemap(sitemap),
    pageLastModified: options.lastModified,
  });
  const helper = slice(entry, "const farmRouteI18n = ", "\n}\n") + "\n}\n";
  const prefix = entry.includes("function farmPageSpellsRoutePrefix(")
    ? slice(entry, "function farmPageSpellsRoutePrefix(", "function matchFarmPagePath")
    : "";
  const rootLayout = { metadata: options.rootMetadata ?? { title: "Farm Shop" } };
  return new Function(
    "pageRoutes",
    "layouts",
    "getRouteModules",
    "middlewares",
    "farmConfigMiddleware",
    "createFarmDefaultSitemap",
    "createFarmMetadataRouteResponse",
    "farmPathGuardCoversPage",
    "isFarmPageNoIndex",
    "resolveFarmAgentOrigin",
    "stripFarmBasePath",
    "stripFarmLocaleFromPathname",
    `${helper}
${prefix}
${slice(entry, "function middlewarePathToRoute(", "function middlewareRouteDepth(")}
${entry.match(/const farmAgentSitemapConfig = .*\n/)![0]}
${entry.match(/const farmPageLastModified = .*\n/)![0]}
${slice(entry, "function getFarmAgentListedPages(", "/**\n * Serves a page's Markdown mirror")}
return createFarmAgentSitemapResponse;`,
  )(
    Object.entries(options.pages).map(([filePath, module]) => ({
      filePath,
      module,
      segments: parseRoutePath(filePath).segments,
    })),
    {},
    (_pattern: string, _modules: unknown, kind: string) => (kind === "layout" ? [rootLayout] : []),
    options.middlewares ?? {},
    [],
    createFarmDefaultSitemap,
    createFarmMetadataRouteResponse,
    farmPathGuardCoversPage,
    isFarmPageNoIndex,
    resolveFarmAgentOrigin,
    stripFarmBasePath,
    stripFarmLocaleFromPathname,
  ) as (request: Request) => Response;
}

const locs = async (response: Response) =>
  [...(await response.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);

describe("RSC sitemap.xml", () => {
  it("is on by default, as in core, and emits no code when agent.sitemap is off", () => {
    const off = generateRscEntry({ ...context, sitemap: resolveFarmAgentSitemap(false) });
    expect(off).not.toContain("Sitemap");
    expect(off).not.toContain("sitemap.xml");
    expect(off).not.toContain("getFarmAgentListedPages");
    const on = generateRscEntry({ ...context, sitemap: resolveFarmAgentSitemap(true) });
    const middleware = on.indexOf("await executeMiddleware(request, context)");
    const api = on.indexOf("await handleAPIRequest(cloneFarmRequestWithContext(request))");
    const sitemap = on.indexOf("createFarmAgentSitemapResponse(request)");
    expect(api).toBeGreaterThan(middleware);
    expect(sitemap).toBeGreaterThan(api);
    // Answered at the path routes see: /console/sitemap.xml under basePath "/console".
    expect(on).toContain(
      "if (getFarmRoutePathname(url.pathname.replace(/\\/+$/, '') || '/') === '/sitemap.xml') {",
    );
  });

  it("lists the static, indexable pages with their lastmod", async () => {
    const respond = createSitemap(true, {
      pages: {
        "/page.tsx": { metadata: { title: "Home" } },
        "/pricing/page.tsx": {},
        "/(marketing)/about/page.tsx": {},
        "/blog/[slug]/page.tsx": {},
        "/drafts/page.tsx": { metadata: { robots: { index: false } } },
        "/team/page.tsx": { __farmRouteGuard: () => true },
        "/internal/page.tsx": {},
      },
      middlewares: { "/internal/middleware.ts": {} },
      lastModified: { "/pricing/page.tsx": "2026-01-02T03:04:05.000Z" },
    });
    const response = respond(new Request("https://shop.test/sitemap.xml"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/xml");
    const body = await response.clone().text();
    expect(await locs(response)).toEqual([
      "https://shop.test/",
      "https://shop.test/about",
      "https://shop.test/pricing",
    ]);
    expect(body).toContain("<lastmod>2026-01-02T03:04:05.000Z</lastmod>");
  });

  it("lists public URLs below the basePath, on the root layout's metadataBase", async () => {
    const respond = createSitemap(
      { exclude: ["/admin"] },
      {
        basePath: "/console",
        rootMetadata: { metadataBase: "https://www.shop.example" },
        pages: {
          "/page.tsx": {},
          "/about/page.tsx": {},
          "/admin/page.tsx": {},
          "/console/legacy/page.tsx": {},
        },
      },
    );
    expect(await locs(respond(new Request("http://127.0.0.1/console/sitemap.xml")))).toEqual([
      // The home page answers at '/console'; '/console/' redirects there.
      "https://www.shop.example/console",
      "https://www.shop.example/console/about",
      "https://www.shop.example/console/legacy",
    ]);
  });

  it("lists each page at its trailing-slash URL under trailingSlash", async () => {
    const respond = createSitemap(true, {
      basePath: "/console",
      trailingSlash: true,
      rootMetadata: { metadataBase: "https://www.shop.example" },
      pages: { "/page.tsx": {}, "/about/page.tsx": {}, "/console/legacy/page.tsx": {} },
    });
    expect(await locs(respond(new Request("http://127.0.0.1/console/sitemap.xml")))).toEqual([
      "https://www.shop.example/console/",
      "https://www.shop.example/console/about/",
      "https://www.shop.example/console/legacy/",
    ]);
  });
});
