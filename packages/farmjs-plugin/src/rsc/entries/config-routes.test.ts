import { describe, expect, it } from "vitest";
import {
  applyConfigResponseHeaders,
  createConfigHeadersMatcher,
  createConfigRedirectMatcher,
  createConfigRewriteMatcher,
  resolveFarmI18nConfig,
} from "@farm.js/core/internal/production-runtime";
import type { EntryContext } from "../types.js";
import { generateConfigRoutesRuntime, generateRscEntry } from "./rsc.js";

const baseContext = {
  srcDir: "src",
  outDir: "dist",
  basePath: "/console",
  actionsEnabled: false,
  serverActions: { allowedOrigins: [], bodySizeLimit: 1000 },
  deploymentId: "config-routes",
  debug: false,
  sitemap: { enabled: true },
} as unknown as EntryContext;

const configRoutes: NonNullable<EntryContext["configRoutes"]> = {
  redirects: [
    { source: "/old", destination: "/about", permanent: true },
    { source: "/away", destination: "https://example.com/elsewhere" },
  ],
  rewrites: [
    { source: "/alias", destination: "/about" },
    { source: "/about", destination: "/" },
  ],
  headers: [{ source: "/static", headers: [{ key: "x-config", value: "on" }] }],
};

/**
 * The generated config-route runtime of an app with basePath "/console", run with core's
 * matchers, where `/console/about` is a page.
 */
function configRouteRuntime() {
  const source = generateConfigRoutesRuntime(baseContext, configRoutes, true).replace(
    /import \{[^}]*\} from '@farm\.js\/core\/internal\/production-runtime';/,
    "",
  );
  const pages = new Set(["/console/about"]);
  const payloadRequests = new WeakSet<Request>();
  const runtime = new Function(
    "createConfigRedirectMatcher",
    "createConfigRewriteMatcher",
    "createConfigHeadersMatcher",
    "applyConfigResponseHeaders",
    "fetchFarmExternalRewrite",
    "farmRouteI18n",
    "farmPayloadPath",
    "farmPayloadRequests",
    "matchRoute",
    "matchAPIRouteAtBasePath",
    "apiRouteMap",
    "farmApiBasePath",
    "farmImageHandler",
    "farmImagePath",
    "getFarmRoutePathname",
    `${source}; return { resolveFarmConfigRoute, farmConfigRouteMayHandlePath, farmHasLocalRequestRoute };`,
  )(
    createConfigRedirectMatcher,
    createConfigRewriteMatcher,
    createConfigHeadersMatcher,
    applyConfigResponseHeaders,
    async (request: Request) => new Response(`proxied ${request.url}`),
    resolveFarmI18nConfig(false, { basePath: "/console" }),
    (pathname: string) => (pathname.endsWith("/") ? pathname + "index.rsc" : pathname + ".rsc"),
    payloadRequests,
    (pathname: string) => (pages.has(pathname) ? {} : null),
    () => null,
    new Map(),
    "/api",
    null,
    "/_farm/image",
    (pathname: string) => pathname.replace(/^\/console(?=\/|$)/, "") || "/",
  ) as {
    resolveFarmConfigRoute(request: Request, payload: boolean): Promise<Request | Response | null>;
    farmConfigRouteMayHandlePath(pathname: string): boolean;
    farmHasLocalRequestRoute(url: URL): boolean;
  };
  return { ...runtime, payloadRequests };
}

describe("RSC config redirects, rewrites and headers", () => {
  it("generate nothing for an app without them", () => {
    const entry = generateRscEntry(baseContext);
    expect(entry).not.toContain("FarmConfig");
    expect(entry).not.toContain("farmConfigRewritten");
    expect(entry).not.toContain("__farmHasLocalRequestRoute");
  });

  it("leave development to the dev server, which asks the entry for local routes", () => {
    const entry = generateRscEntry({ ...baseContext, development: true, configRoutes });
    expect(entry).not.toContain("resolveFarmConfigRoute");
    expect(entry).not.toContain("matchFarmConfigHeaders");
    expect(entry).toContain("export function __farmHasLocalRequestRoute(href)");

    const production = generateRscEntry({ ...baseContext, configRoutes });
    expect(production).toContain("resolveFarmConfigRoute(request, isFarmPayloadRequest)");
    expect(production).toContain("applyConfigResponseHeaders(response, farmConfigHeaders)");
    expect(production).not.toContain("__farmHasLocalRequestRoute");
  });

  it("redirect a payload request to the destination's payload", async () => {
    const { resolveFarmConfigRoute } = configRouteRuntime();
    const page = (await resolveFarmConfigRoute(
      new Request("https://farm.test/console/old?tab=1"),
      false,
    )) as Response;
    expect(page.status).toBe(308);
    expect(page.headers.get("location")).toBe("/console/about?tab=1");

    const payload = (await resolveFarmConfigRoute(
      new Request("https://farm.test/console/old"),
      true,
    )) as Response;
    expect(payload.headers.get("location")).toBe("/console/about.rsc");

    // Another origin has no payload: the browser follows it as written.
    const external = (await resolveFarmConfigRoute(
      new Request("https://farm.test/console/away"),
      true,
    )) as Response;
    expect(external.status).toBe(307);
    expect(external.headers.get("location")).toBe("https://example.com/elsewhere");
  });

  it("rewrite only a URL no route answers, keeping a payload request one", async () => {
    const { resolveFarmConfigRoute, payloadRequests } = configRouteRuntime();
    const rewritten = (await resolveFarmConfigRoute(
      new Request("https://farm.test/console/alias?q=1", {
        headers: { accept: "text/x-component" },
      }),
      true,
    )) as Request;
    expect(rewritten).toBeInstanceOf(Request);
    expect(rewritten.url).toBe("https://farm.test/about?q=1");
    expect(rewritten.headers.get("accept")).toBe("text/x-component");
    expect(payloadRequests.has(rewritten)).toBe(true);

    // /console/about is a page.
    expect(
      await resolveFarmConfigRoute(new Request("https://farm.test/console/about"), false),
    ).toBeNull();
  });

  it("keep a page any config route may answer from prerendering", () => {
    const { farmConfigRouteMayHandlePath } = configRouteRuntime();
    expect(farmConfigRouteMayHandlePath("/console/static")).toBe(true);
    expect(farmConfigRouteMayHandlePath("/console/old")).toBe(true);
    expect(farmConfigRouteMayHandlePath("/console/alias")).toBe(true);
    expect(farmConfigRouteMayHandlePath("/console/prerendered")).toBe(false);
  });
});
