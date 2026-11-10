import { afterEach, describe, expect, it, vi } from "vitest";
import { isFarmAPIPathname } from "@farm.js/core/api/runtime";
import {
  appMiddlewareMayHandlePath,
  configMiddlewareMayHandlePath,
  materializeSSGRoutePath,
  mergeRouteRenderingDirectiveConfig,
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
  } = {},
): Promise<string[]> {
  const entry = generateRscEntry({ ...context, pageRenderingDirectives: options.directives });
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
    `${slice(
      entry,
      "const FARM_PRERENDER_ROUTES_PATH",
      "async function handleFarmRequestWithRuntime(",
    )}; return handler;`,
  )(async () => staticPages, farmPayloadPath, toFarmPayloadRequest, render) as (
    request: Request,
  ) => Promise<Response>;
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

    render.mockImplementationOnce(
      () => new Response("0:{}", { headers: { "content-type": "text/x-component" } }),
    );
    const payload = await handler(prerenderRequest("/about.rsc"));
    expect(payload.headers.has("x-nitro-prerender")).toBe(false);
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
  });
});
