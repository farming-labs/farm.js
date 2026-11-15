import { afterEach, describe, expect, it, vi } from "vitest";
import { isFarmAPIPathname } from "@farm.js/core/api/runtime";
import type { FarmI18nUserConfig } from "@farm.js/core/i18n";
import {
  applyFarmBasePath,
  appMiddlewareMayHandlePath,
  configMiddlewareMayHandlePath,
  localizeFarmPathname,
  materializeSSGRoutePath,
  mergeRouteRenderingDirectiveConfig,
  normalizeFarmTrailingSlashPathname,
  resolveFarmI18nConfig,
  stripFarmBasePath,
  stripFarmLocaleFromPathname,
} from "@farm.js/core/internal/production-runtime";
import { matchRoute as matchFarmPageRoute, parseRoutePath } from "../../../../farm/src/utils";
import {
  compareRouteSpecificity,
  getRoutePatternSpecificity,
} from "../../../../farm/src/routing/specificity";
import type { EntryContext } from "../types.js";
import { generateRscEntry } from "./rsc.js";

const context: EntryContext = {
  srcDir: "src",
  outDir: "dist",
  basePath: "/",
  actionsEnabled: false,
  serverActions: { allowedOrigins: [], bodySizeLimit: 1024 * 1024 } as never,
  deploymentId: "prerender-test",
  debug: false,
};

function slice(entry: string, startMarker: string, endMarker: string): string {
  const start = entry.indexOf(startMarker);
  const end = entry.indexOf(endMarker, start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return entry.slice(start, end);
}

/** Runs the generated static page collector with the real core helpers. */
function collectStaticPages(
  pages: Record<string, Record<string, unknown>>,
  options: {
    directives?: Record<string, unknown>;
    middlewareFiles?: string[];
    configMiddleware?: unknown[];
    basePath?: string;
    trailingSlash?: boolean;
  } = {},
): Promise<string[]> {
  const entry = generateRscEntry({
    ...context,
    basePath: options.basePath ?? context.basePath,
    trailingSlash: options.trailingSlash,
    pageRenderingDirectives: options.directives,
  });
  const pageRoutes = Object.entries(pages).map(([filePath, module]) => ({
    filePath,
    module,
    segments: parseRoutePath(filePath).segments,
  }));
  const middlewares = Object.fromEntries(
    (options.middlewareFiles ?? []).map((file) => [file, { default() {} }]),
  );
  const middlewarePathToRoute = (filePath: string) =>
    filePath.replace(/\/middleware\.[tj]sx?$/, "") || "/";
  return new Function(
    "pageRoutes",
    "middlewares",
    "middlewarePathToRoute",
    "farmConfigMiddleware",
    "mergeRouteRenderingDirectiveConfig",
    "materializeSSGRoutePath",
    "appMiddlewareMayHandlePath",
    "configMiddlewareMayHandlePath",
    "applyFarmBasePath",
    "normalizeFarmTrailingSlashPathname",
    `${slice(
      entry,
      "// Each page's parsed rendering directive",
      "// The route's metadata as core's server resolves it",
    )}; return collectFarmStaticPages();`,
  )(
    pageRoutes,
    middlewares,
    middlewarePathToRoute,
    options.configMiddleware ?? [],
    mergeRouteRenderingDirectiveConfig,
    materializeSSGRoutePath,
    appMiddlewareMayHandlePath,
    configMiddlewareMayHandlePath,
    applyFarmBasePath,
    normalizeFarmTrailingSlashPathname,
  );
}

/**
 * Runs the generated static page collector of an app with i18n, with the entry's own page matcher
 * and route-path helper and core's real helpers.
 */
function collectLocalizedStaticPages(
  pages: Record<string, Record<string, unknown>>,
  options: {
    i18n: FarmI18nUserConfig;
    basePath?: string;
    middlewareFiles?: string[];
    trailingSlash?: boolean;
  },
): Promise<string[]> {
  const basePath = options.basePath ?? "/";
  const entry = generateRscEntry({
    ...context,
    basePath,
    i18n: resolveFarmI18nConfig(options.i18n, { basePath }),
    trailingSlash: options.trailingSlash,
  });
  const routeHelperStart = entry.indexOf("const farmRouteI18n = ");
  const routeHelperEnd =
    entry.indexOf("\n}\n", entry.indexOf("function getFarmRoutePathname(pathname)")) + 2;
  const middlewares = Object.fromEntries(
    (options.middlewareFiles ?? []).map((file) => [file, { default() {} }]),
  );
  return new Function(
    "pages",
    "React",
    "debug",
    "parseRoutePath",
    "matchFarmPageRoute",
    "compareRouteSpecificity",
    "getRoutePatternSpecificity",
    "stripFarmBasePath",
    "stripFarmLocaleFromPathname",
    "localizeFarmPathname",
    "applyFarmBasePath",
    "middlewares",
    "middlewarePathToRoute",
    "farmConfigMiddleware",
    "mergeRouteRenderingDirectiveConfig",
    "materializeSSGRoutePath",
    "appMiddlewareMayHandlePath",
    "configMiddlewareMayHandlePath",
    "normalizeFarmTrailingSlashPathname",
    `${entry.slice(routeHelperStart, routeHelperEnd)}
${slice(entry, "function filePathToRoute(", "// The route's metadata as core's server resolves it")}
return collectFarmStaticPages();`,
  )(
    Object.fromEntries(
      Object.entries(pages).map(([file, module]) => [file, { default: () => file, ...module }]),
    ),
    {},
    () => {},
    parseRoutePath,
    matchFarmPageRoute,
    compareRouteSpecificity,
    getRoutePatternSpecificity,
    stripFarmBasePath,
    stripFarmLocaleFromPathname,
    localizeFarmPathname,
    applyFarmBasePath,
    middlewares,
    (filePath: string) => filePath.replace(/\/middleware\.[tj]sx?$/, "") || "/",
    [],
    mergeRouteRenderingDirectiveConfig,
    materializeSSGRoutePath,
    appMiddlewareMayHandlePath,
    configMiddlewareMayHandlePath,
    normalizeFarmTrailingSlashPathname,
  );
}

function payloadHelpers() {
  const entry = generateRscEntry(context);
  return new Function(
    "isFarmAPIPathname",
    "farmApiBasePath",
    `${slice(
      entry,
      "// Client navigation addresses a page's RSC payload",
      "// The build's prerender pass",
    )}; return { farmPayloadPath, toFarmPayloadRequest };`,
  )(isFarmAPIPathname, "/api") as {
    farmPayloadPath: (pathname: string) => string;
    toFarmPayloadRequest: (request: Request) => Request;
  };
}

function prerenderHandler(staticPages: string[], render: (request: Request) => Response) {
  const entry = generateRscEntry(context);
  const { farmPayloadPath, toFarmPayloadRequest } = payloadHelpers();
  return new Function(
    "collectFarmStaticPages",
    "farmPayloadPath",
    "toFarmPayloadRequest",
    "handleFarmRequestWithRuntime",
    "withFarmDeploymentCookie",
    `${slice(
      entry,
      "const FARM_PRERENDER_ROUTES_PATH",
      "async function handleFarmRequestWithRuntime(",
    )}; return handler;`,
  )(
    async () => staticPages,
    farmPayloadPath,
    toFarmPayloadRequest,
    render,
    // Marks where the server would set the deployment cookie (entries/deployment-cookie.test.ts).
    (_request: Request, response: Response) => {
      const headers = new Headers(response.headers);
      headers.append("set-cookie", "__farm_deployment=prerender-test");
      return new Response(response.body, { status: response.status, headers });
    },
  ) as (request: Request) => Promise<Response>;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("RSC static pages", () => {
  it("lists the pages that ask to be static, by core's SSG rules", async () => {
    const pages = await collectStaticPages(
      {
        "/page.tsx": {},
        "/about/page.tsx": { dynamic: "force-static" },
        "/directive/page.tsx": {},
        "/(docs)/docs/[[...slug]]/page.tsx": {
          dynamic: "force-static",
          generateStaticParams: async () => [{ slug: [] }, { slug: ["guides", "start here"] }],
        },
        "/news/page.tsx": { revalidate: 60 },
        "/account/page.tsx": { dynamic: "force-static" },
      },
      {
        directives: {
          "/directive/page.tsx": { ssg: true, ppr: false, directive: "use ssg" },
          // The build found a cookies() read in its source.
          "/account/page.tsx": { ssg: false, ppr: false, directive: "", requestBound: true },
        },
      },
    );
    expect(pages.sort()).toEqual(["/about", "/directive", "/docs", "/docs/guides/start%20here"]);
  });

  it("keeps pages any middleware may handle server-rendered", async () => {
    const pages = await collectStaticPages(
      {
        "/about/page.tsx": { dynamic: "force-static" },
        "/admin/settings/page.tsx": { dynamic: "force-static" },
        "/members/page.tsx": { dynamic: "force-static" },
      },
      {
        middlewareFiles: ["/admin/middleware.ts"],
        configMiddleware: [{ matcher: "/members/:path*", handler() {} }],
      },
    );
    expect(pages).toEqual(["/about"]);

    const rootMiddleware = await collectStaticPages(
      { "/about/page.tsx": { dynamic: "force-static" } },
      { middlewareFiles: ["/middleware.ts"] },
    );
    expect(rootMiddleware).toEqual([]);
  });

  it("renders a static page with unlisted params on request instead of failing", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const pages = await collectStaticPages({
      "/posts/[id]/page.tsx": { dynamic: "force-static" },
      "/about/page.tsx": { dynamic: "force-static" },
    });
    expect(pages).toEqual(["/about"]);
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("/posts/[id]/page.tsx on each request"),
      expect.any(Error),
    );
  });

  it("prerenders a page at its URL below the basePath, where the platform serves it", async () => {
    const pages = await collectStaticPages(
      {
        "/page.tsx": { dynamic: "force-static" },
        "/about/page.tsx": { dynamic: "force-static" },
        "/docs/[[...slug]]/page.tsx": {
          dynamic: "force-static",
          generateStaticParams: async () => [{ slug: ["start here"] }],
        },
        // Nested under app/<basePath>/, it already names its URL.
        "/console/legacy/page.tsx": { dynamic: "force-static" },
        "/admin/page.tsx": { dynamic: "force-static" },
      },
      { basePath: "/console", middlewareFiles: ["/admin/middleware.ts"] },
    );
    expect(pages.sort()).toEqual([
      "/console",
      "/console/about",
      "/console/docs/start%20here",
      "/console/legacy",
    ]);
  });

  // trailingSlash makes '/about/' the page's URL; '/about' answers with a body-less 308, which
  // Nitro would save as the page. '/about/' is written as about/index.html, as core's build does.
  it("prerenders a page at its trailing-slash URL with trailingSlash", async () => {
    const pages = {
      "/page.tsx": { dynamic: "force-static" },
      "/about/page.tsx": { dynamic: "force-static" },
      "/docs/[[...slug]]/page.tsx": {
        dynamic: "force-static",
        generateStaticParams: async () => [{ slug: [] }, { slug: ["start"] }],
      },
    };
    expect((await collectStaticPages(pages, { trailingSlash: true })).sort()).toEqual([
      "/",
      "/about/",
      "/docs/",
      "/docs/start/",
    ]);
    expect(
      (await collectStaticPages(pages, { basePath: "/console", trailingSlash: true })).sort(),
    ).toEqual(["/console/", "/console/about/", "/console/docs/", "/console/docs/start/"]);
  });
});

describe("RSC static pages with i18n", () => {
  const staticPages = {
    "/page.tsx": { dynamic: "force-static" },
    "/about/page.tsx": { dynamic: "force-static" },
    "/docs/[slug]/page.tsx": {
      dynamic: "force-static",
      generateStaticParams: async () => [{ slug: "start here" }],
    },
    "/account/page.tsx": {},
  };

  it("prerenders each static page at every locale URL that names its locale", async () => {
    // "prefix-except-default": the English URLs carry no locale and redirect a visitor whose
    // cookie or Accept-Language picks French, so they stay server-rendered.
    const pages = await collectLocalizedStaticPages(staticPages, {
      basePath: "/console",
      i18n: { locales: ["en", "fr", "de"], defaultLocale: "en" },
    });
    expect(pages.sort()).toEqual([
      "/console/de",
      "/console/de/about",
      "/console/de/docs/start%20here",
      "/console/fr",
      "/console/fr/about",
      "/console/fr/docs/start%20here",
    ]);

    const always = await collectLocalizedStaticPages(staticPages, {
      i18n: { locales: ["en", "fr"], defaultLocale: "en", routing: "prefix-always" },
    });
    expect(always.sort()).toEqual([
      "/en",
      "/en/about",
      "/en/docs/start%20here",
      "/fr",
      "/fr/about",
      "/fr/docs/start%20here",
    ]);
  });

  it("prerenders each locale URL at its trailing-slash spelling with trailingSlash", async () => {
    const pages = await collectLocalizedStaticPages(staticPages, {
      basePath: "/console",
      i18n: { locales: ["en", "fr"], defaultLocale: "en" },
      trailingSlash: true,
    });
    expect(pages.sort()).toEqual([
      "/console/fr/",
      "/console/fr/about/",
      "/console/fr/docs/start%20here/",
    ]);
  });

  it("prerenders the default locale's URL too when the app detects no locale", async () => {
    const pages = await collectLocalizedStaticPages(
      { "/about/page.tsx": { dynamic: "force-static" } },
      { i18n: { locales: ["en", "fr"], defaultLocale: "en", detection: false } },
    );
    expect(pages.sort()).toEqual(["/about", "/fr/about"]);
  });

  it("keeps a page under a [lang] folder at the URLs it lists, where it renders", async () => {
    const pages = await collectLocalizedStaticPages(
      {
        "/console/[lang]/legacy/page.tsx": {
          dynamic: "force-static",
          generateStaticParams: async () => [{ lang: "fr" }, { lang: "en" }],
        },
      },
      { basePath: "/console", i18n: { locales: ["en", "fr"], defaultLocale: "en" } },
    );
    // /console/en/legacy redirects to /console/legacy, where this page does not answer.
    expect(pages).toEqual(["/console/fr/legacy"]);
  });

  it("keeps locale URLs that middleware may handle server-rendered", async () => {
    const pages = await collectLocalizedStaticPages(staticPages, {
      i18n: { locales: ["en", "fr"], defaultLocale: "en" },
      middlewareFiles: ["/about/middleware.ts", "/[lang]/docs/middleware.ts"],
    });
    expect(pages.sort()).toEqual(["/fr"]);
  });

  it('prerenders nothing with routing "none", where one URL serves every locale', async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const pages = await collectLocalizedStaticPages(staticPages, {
      i18n: { locales: ["en", "fr"], defaultLocale: "en", routing: "none" },
    });
    expect(pages).toEqual([]);
    expect(info).toHaveBeenCalledWith(expect.stringContaining('routing "none"'));
  });
});

describe("RSC payload URLs", () => {
  it("serves a page's payload at <page>.rsc", () => {
    const { farmPayloadPath, toFarmPayloadRequest } = payloadHelpers();
    expect(farmPayloadPath("/docs")).toBe("/docs.rsc");
    expect(farmPayloadPath("/")).toBe("/index.rsc");
    expect(farmPayloadPath("/docs/")).toBe("/docs/index.rsc");

    for (const [payload, page] of [
      ["/docs.rsc?tab=1", "/docs?tab=1"],
      ["/index.rsc", "/"],
      ["/docs/index.rsc", "/docs/"],
    ]) {
      const request = toFarmPayloadRequest(
        new Request(`https://farm.test${payload}`, { headers: { cookie: "a=1" } }),
      );
      expect(request.url).toBe(`https://farm.test${page}`);
      expect(request.headers.get("accept")).toBe("text/x-component");
      expect(request.headers.get("cookie")).toBe("a=1");
    }
  });

  it("leaves other requests alone", () => {
    const { toFarmPayloadRequest } = payloadHelpers();
    for (const request of [
      new Request("https://farm.test/docs"),
      new Request("https://farm.test/api/export.rsc"),
      new Request("https://farm.test/docs.rsc", { method: "POST", body: "x" }),
    ]) {
      expect(toFarmPayloadRequest(request)).toBe(request);
    }
  });
});

describe("RSC prerender pass", () => {
  const html = () =>
    new Response("<html></html>", { headers: { "content-type": "text/html; charset=utf-8" } });
  const prerenderRequest = (path: string) =>
    new Request(`https://farm.test${path}`, { headers: { "x-nitro-prerender": path } });

  it("lists static pages and queues each page's payload only while prerendering", async () => {
    vi.stubEnv("FARM_RSC_PRERENDER", "1");
    const render = vi.fn(html);
    const handler = prerenderHandler(["/about", "/docs/a b"], render);

    const seed = await handler(prerenderRequest("/__farm/rsc-prerender-routes"));
    expect(seed.headers.get("content-type")).toContain("text/html");
    expect(seed.headers.get("x-nitro-prerender")).toBe("%2Fabout,%2Fdocs%2Fa%20b");
    expect(render).not.toHaveBeenCalled();

    const page = await handler(prerenderRequest("/about"));
    expect(page.headers.get("x-nitro-prerender")).toBe("%2Fabout.rsc");
    // A prerendered file is served to every visitor, so it never sets the deployment cookie.
    expect(page.headers.has("set-cookie")).toBe(false);

    render.mockImplementationOnce(
      () => new Response("0:{}", { headers: { "content-type": "text/x-component" } }),
    );
    const payload = await handler(prerenderRequest("/about.rsc"));
    expect(payload.headers.has("x-nitro-prerender")).toBe(false);
    expect(payload.headers.has("set-cookie")).toBe(false);
    expect(new URL(render.mock.calls.at(-1)![0].url).pathname).toBe("/about");
  });

  it("never answers the seed or queues payloads for ordinary requests", async () => {
    const render = vi.fn(() => new Response("Not Found", { status: 404 }));
    const handler = prerenderHandler(["/about"], render);
    // A client can send the header; without the build's environment flag it means nothing.
    const seed = await handler(prerenderRequest("/__farm/rsc-prerender-routes"));
    expect(seed.status).toBe(404);
    expect(render).toHaveBeenCalledOnce();

    vi.stubEnv("FARM_RSC_PRERENDER", "1");
    render.mockImplementationOnce(html);
    const page = await handler(new Request("https://farm.test/about"));
    expect(page.headers.has("x-nitro-prerender")).toBe(false);
    expect(page.headers.get("set-cookie")).toBe("__farm_deployment=prerender-test");
  });
});
