// @vitest-environment node
import fs from "node:fs/promises";
import fsSync from "node:fs";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { matchAPIRoute } from "../api/route-pattern";
import { stripFarmBasePath } from "../base-path";
import { resolveFarmI18nConfig } from "../i18n/config";
import { stripFarmLocaleFromPathname } from "../i18n/routing";
import { defineIntegration, dispatchIntegrationRequest } from "../integrations";
import { middleware } from "../middleware/chain";
import { MiddlewareManager } from "../middleware/manager";
import { createProductionMiddlewareRunner } from "../middleware/production-runtime";
import type {
  FarmMiddlewareConfig,
  MiddlewareContext,
  MiddlewareMatcher,
} from "../middleware/types";
import {
  appMiddlewareMayHandlePath,
  configMiddlewareMayHandlePath,
  discoverMiddlewareRoutes,
  generateRuntimePathMatcherSource,
} from "../nitro/universal-build";
import { resolveFarmRequestURL } from "../server/request";
import { RouteManager } from "../routing/route-manager";
import type { RouteSegment } from "../types";
import { matchRoute } from "../utils";

/**
 * A route guard and the page router have to agree on which URL a request is
 * for. They did not: guards compared the raw `url.pathname` while every page
 * matcher decoded each segment first, so `/%64ashboard` missed a
 * `matcher: ["/dashboard"]` gate and still rendered the `/dashboard` page.
 * That is an auth bypass for both integration `protectedRoutes` and a
 * user-authored `middleware.ts` matcher, so these assertions pin the guard
 * matchers to the page matchers rather than to a hand-written expectation.
 */

const prodPageMatch = new Function(
  `${generateRuntimePathMatcherSource()}\nreturn matchRuntimePathPattern;`,
)() as (pattern: string, pathname: string) => Record<string, string> | null;

function parseDevSegments(pattern: string): RouteSegment[] {
  return pattern
    .split("/")
    .filter(Boolean)
    .map((part) => {
      const catchAll = part.match(/^\[\.\.\.(.+)\]$/);
      if (catchAll) {
        return { segment: catchAll[1], isDynamic: true, isOptional: false, isCatchAll: true };
      }
      const dynamic = part.match(/^\[(.+)\]$/);
      if (dynamic) {
        return { segment: dynamic[1], isDynamic: true, isOptional: false, isCatchAll: false };
      }
      return { segment: part, isDynamic: false, isOptional: false, isCatchAll: false };
    });
}

/** The dev page matcher (`utils.matchRoute`, driven by the route manager). */
function devPageMatches(pattern: string, pathname: string): boolean {
  return matchRoute(pathname, parseDevSegments(pattern)).matches;
}

/** The page matcher emitted into the built app's Nitro runtime. */
function prodPageMatches(pattern: string, pathname: string): boolean {
  return prodPageMatch(pattern, pathname) !== null;
}

function createRequest(url: string): IncomingMessage {
  const req = new IncomingMessage(new Socket());
  req.url = url;
  req.method = "GET";
  req.headers = { host: "localhost" };
  return req;
}

type GuardRun = { ran: boolean; params: Record<string, string> };

/** `middleware.ts` config matcher on the dev server. */
async function runDevGuard(matcher: MiddlewareMatcher, pathname: string): Promise<GuardRun> {
  const result: GuardRun = { ran: false, params: {} };
  const manager = new MiddlewareManager("/tmp", undefined, [
    {
      matcher: [matcher],
      async handler(ctx, next) {
        result.ran = true;
        result.params = { ...ctx.params };
        await next();
      },
    },
  ]);
  const req = createRequest(pathname);
  await manager.execute(req, new ServerResponse(req));
  return result;
}

/** The same `middleware.ts` config matcher in a built app. */
async function runProductionGuard(matcher: MiddlewareMatcher, pathname: string): Promise<GuardRun> {
  const result: GuardRun = { ran: false, params: {} };
  const runner = createProductionMiddlewareRunner({
    config: [
      {
        matcher: [matcher],
        handler(ctx) {
          result.ran = true;
          result.params = { ...ctx.params };
        },
      },
    ],
  });
  await runner(new Request(`https://farm.test${pathname}`));
  return result;
}

/** An integration `protectedRoutes` entry, which becomes `middleware[].matcher`. */
async function runIntegrationGuard(
  matcher: string,
  pathname: string,
  config: Record<string, unknown> = {},
): Promise<GuardRun> {
  const result: GuardRun = { ran: false, params: {} };
  const integration = defineIntegration({
    category: "custom",
    type: "guard-canonicalization",
    instance: {},
    middleware: [
      {
        matcher,
        handler(_request, ctx) {
          result.ran = true;
          result.params = { ...ctx.params } as Record<string, string>;
        },
      },
    ],
  });
  await dispatchIntegrationRequest(
    { integration, config: config as never, isDev: false, isProd: true },
    new Request(`https://farm.test${pathname}`),
  );
  return result;
}

async function collectGuards(matcher: string, pathname: string) {
  return {
    devMiddleware: (await runDevGuard(matcher, pathname)).ran,
    productionMiddleware: (await runProductionGuard(matcher, pathname)).ran,
    integration: (await runIntegrationGuard(matcher, pathname)).ran,
  };
}

describe("route guards match the canonical request pathname", () => {
  // A percent-encoded letter is the bypass: every page matcher decodes the
  // segment and serves `/dashboard`, so every guard has to see `/dashboard`
  // too.
  const encodedDashboardPaths = ["/dashboard", "/%64ashboard", "/dash%62oard", "/%64ashboar%64"];

  for (const pathname of encodedDashboardPaths) {
    it(`guards ${pathname} exactly when the page router serves it`, async () => {
      const served = {
        devPage: devPageMatches("/dashboard", pathname),
        productionPage: prodPageMatches("/dashboard", pathname),
      };
      // Sanity: the page is reachable at every one of these spellings.
      expect(served).toEqual({ devPage: true, productionPage: true });

      expect(await collectGuards("/dashboard", pathname)).toEqual({
        devMiddleware: true,
        productionMiddleware: true,
        integration: true,
      });
    });

    it(`guards ${pathname} through a subtree matcher`, async () => {
      expect(await collectGuards("/dashboard(.*)", pathname)).toEqual({
        devMiddleware: true,
        productionMiddleware: true,
        integration: true,
      });
    });
  }

  for (const pathname of [
    "/dashboard/settings",
    "/%64ashboard/settings",
    "/dashboard/%73ettings",
  ]) {
    it(`guards the subtree entry ${pathname}`, async () => {
      expect({
        devPage: devPageMatches("/dashboard/settings", pathname),
        productionPage: prodPageMatches("/dashboard/settings", pathname),
      }).toEqual({ devPage: true, productionPage: true });

      expect(await collectGuards("/dashboard(.*)", pathname)).toEqual({
        devMiddleware: true,
        productionMiddleware: true,
        integration: true,
      });
    });
  }

  // Repeated slashes are the same bypass spelled differently: every page
  // matcher drops empty segments, so a built app renders `//dashboard` as
  // `/dashboard` and a guard that compared the raw pathname never ran.
  for (const [pattern, pathname] of [
    ["/dashboard", "//dashboard"],
    ["/dashboard", "///dashboard"],
    ["/dashboard", "//%64ashboard"],
    ["/dashboard/settings", "//dashboard/settings"],
    ["/dashboard/settings", "/dashboard//settings"],
  ] as const) {
    it(`guards ${pathname} exactly when the page router serves it`, async () => {
      expect(prodPageMatches(pattern, pathname)).toBe(true);
      // The dev server resolves a leading `//` as a protocol-relative URL and
      // renders a different page altogether. What has to hold there is that
      // its guard and its page router agree about the pathname.
      const devPathname = resolveFarmRequestURL(createRequest(pathname)).pathname;
      const devServed = devPageMatches(pattern, devPathname);

      for (const matcher of [pattern, "/dashboard(.*)"]) {
        expect({
          matcher,
          devMiddleware: (await runDevGuard(matcher, pathname)).ran,
          productionMiddleware: (await runProductionGuard(matcher, pathname)).ran,
          integration: (await runIntegrationGuard(matcher, pathname)).ran,
        }).toEqual({
          matcher,
          devMiddleware: devServed,
          productionMiddleware: true,
          integration: true,
        });
      }
    });
  }

  it("still refuses paths the page router does not serve", async () => {
    // Canonicalizing must not widen a matcher. `/dashboardx` is a different
    // page and `/Dashboard` is a different, case-sensitive segment, including
    // when the capital arrives percent-encoded as `%44`.
    for (const pathname of ["/dashboardx", "/Dashboard", "/%44ashboard", "/notdashboard"]) {
      expect({
        pathname,
        devPage: devPageMatches("/dashboard", pathname),
        productionPage: prodPageMatches("/dashboard", pathname),
        ...(await collectGuards("/dashboard", pathname)),
      }).toEqual({
        pathname,
        devPage: false,
        productionPage: false,
        devMiddleware: false,
        productionMiddleware: false,
        integration: false,
      });
    }
  });

  it("decodes a guarded segment exactly once", async () => {
    // Regression guard for the double-decode class of bug: a literal
    // "%2541BC" segment decodes to "%41BC", never to "ABC". Decoding twice
    // would let a guard and a page resolve two different records.
    for (const [pathname, slug] of [
      ["/docs/%2541BC", "%41BC"],
      ["/docs/hello%2520world", "hello%20world"],
      ["/docs/hello%20world", "hello world"],
    ] as const) {
      const dev = await runDevGuard("/docs/:slug", pathname);
      const production = await runProductionGuard("/docs/:slug", pathname);
      const integration = await runIntegrationGuard("/docs/[slug]", pathname);

      expect({
        pathname,
        dev: dev.params.slug,
        production: production.params.slug,
        integration: integration.params.slug,
      }).toEqual({ pathname, dev: slug, production: slug, integration: slug });
    }
  });

  it("keeps an encoded slash inside its own segment", async () => {
    // `%2F` is not a path separator. A decoded "/" must not split the segment,
    // or a guard on `/dashboard` starts matching `/dash%2Fboard` and a
    // catch-all grows a segment that was never in the request.
    for (const pathname of ["/dash%2Fboard", "/dashboard%2Fsettings", "/%2Fdashboard"]) {
      expect({
        pathname,
        devPage: devPageMatches("/dashboard", pathname),
        productionPage: prodPageMatches("/dashboard", pathname),
        ...(await collectGuards("/dashboard", pathname)),
      }).toEqual({
        pathname,
        devPage: false,
        productionPage: false,
        devMiddleware: false,
        productionMiddleware: false,
        integration: false,
      });
    }

    // One request segment stays one captured segment.
    const integration = await runIntegrationGuard("/files/[...parts]", "/files/a%2Fb");
    expect(integration.params.parts).toEqual(["a/b"]);
    expect(prodPageMatch("/files/[...parts]", "/files/a%2Fb")).toMatchObject({ parts: "a/b" });
  });

  it("does not throw or open a guard on malformed percent-encoding", async () => {
    // `decodeURIComponent` throws URIError on these. Route matching must
    // survive it, and a malformed path must not slip past a guard that owns
    // the subtree it sits in.
    for (const pathname of [
      "/%zzashboard",
      "/dash%62oard/%zz",
      "/dashboard/%e0%a4",
      "/dashboard/%",
    ]) {
      const guards = await collectGuards("/dashboard(.*)", pathname);
      const servedSomewhere =
        devPageMatches("/dashboard", pathname) || prodPageMatches("/dashboard", pathname);
      // Either the subtree guard runs, or the path is not the guarded page at
      // all. What must never happen is "served but unguarded".
      expect({
        pathname,
        bypassed: servedSomewhere && !guards.productionMiddleware,
        devBypassed: servedSomewhere && !guards.devMiddleware,
        integrationBypassed: servedSomewhere && !guards.integration,
      }).toEqual({ pathname, bypassed: false, devBypassed: false, integrationBypassed: false });
    }

    // A malformed segment under the guarded prefix is still inside the guard.
    expect(await collectGuards("/dashboard(.*)", "/dashboard/%zz")).toEqual({
      devMiddleware: true,
      productionMiddleware: true,
      integration: true,
    });
  });

  it("guards a trailing slash wherever the router drops it", async () => {
    // Every page and API matcher drops a trailing slash, so `/dashboard/` and
    // `/api/admin/users/` reach the same page or handler as the exact path. An
    // exact config matcher has to run for both, or the slash is a bypass.
    for (const [matcher, pathname] of [
      ["/dashboard", "/dashboard/"],
      ["/dashboard(.*)", "/dashboard/"],
      ["/api/admin/users", "/api/admin/users/"],
      ["/users/[id]", "/users/42/"],
    ] as const) {
      expect({ matcher, pathname, guards: await collectGuards(matcher, pathname) }).toEqual({
        matcher,
        pathname,
        guards: { devMiddleware: true, productionMiddleware: true, integration: true },
      });
    }

    const apiRoutes = new Map([["/api/admin/users", { path: "/api/admin/users" }]]);
    expect(matchAPIRoute(apiRoutes, "/api/admin/users/")?.route.path).toBe("/api/admin/users");
    expect(prodPageMatches("/dashboard", "/dashboard/")).toBe(true);

    // Params captured before the trailing slash keep their value.
    // `:id` is config-matcher syntax only, so check it against both runners.
    expect((await runProductionGuard("/users/:id", "/users/42/")).params).toEqual({ id: "42" });
    expect((await runDevGuard("/users/:id", "/users/42/")).params).toEqual({ id: "42" });
    expect((await runDevGuard("/users/[id]", "/users/42/")).params).toEqual({ id: "42" });
  });

  it("keeps exclude exact so a trailing slash never removes a guard", async () => {
    const result: GuardRun = { ran: false, params: {} };
    const runner = createProductionMiddlewareRunner({
      config: [
        {
          matcher: ["/api/(.*)"],
          exclude: ["/api/health"],
          handler() {
            result.ran = true;
          },
        },
      ],
    });
    await runner(new Request("https://farm.test/api/health/"));
    expect(result.ran).toBe(true);
  });
});

describe("integration guards take the middleware matcher syntax", () => {
  // `protectedRoutes` is documented to use the same matcher syntax as Farm
  // middleware. The integration pattern language only knew `(.*)` and
  // `[param]`, so these compared as literal text and guarded nothing.
  it.each([
    ["/dashboard/:path*", "/dashboard"],
    ["/dashboard/:path*", "/dashboard/settings"],
    ["/dashboard/:path+", "/dashboard/settings/billing"],
    ["/api/**", "/api/admin"],
    ["/api/**", "/api/admin/users"],
    ["/api/*", "/api/admin"],
    ["/team/:id", "/team/42"],
  ])("%s guards %s like middleware does", async (matcher, pathname) => {
    expect(await collectGuards(matcher, pathname)).toEqual({
      devMiddleware: true,
      productionMiddleware: true,
      integration: true,
    });
  });

  it.each([
    ["/dashboard/:path*", "/dashboards"],
    ["/api/*", "/api/admin/users"],
    ["/team/:id", "/team"],
  ])("%s still does not guard %s", async (matcher, pathname) => {
    expect(await collectGuards(matcher, pathname)).toEqual({
      devMiddleware: false,
      productionMiddleware: false,
      integration: false,
    });
  });

  it("keeps catch-all params as arrays for integration patterns", async () => {
    const run = await runIntegrationGuard("/docs/[...slug]", "/docs/a/b");
    expect(run).toEqual({ ran: true, params: { slug: ["a", "b"] } });
  });

  // The page router strips the basePath and the locale prefix before it
  // matches, so a guard written for the page path has to see that path too.
  it("guards a localized page path", async () => {
    const i18n = { locales: ["en", "fr"], defaultLocale: "en" };
    for (const pathname of [
      "/dashboard",
      "/fr/dashboard",
      "/fr/dashboard/settings",
      "/en/dashboard",
    ]) {
      expect({
        pathname,
        ...(await runIntegrationGuard("/dashboard(.*)", pathname, { i18n })),
      }).toMatchObject({ pathname, ran: true });
    }
    expect((await runIntegrationGuard("/dashboard(.*)", "/fr/other", { i18n })).ran).toBe(false);
    expect((await runIntegrationGuard("/dashboard/:path*", "/fr/dashboard/x", { i18n })).ran).toBe(
      true,
    );
    // Without i18n a first segment is not a locale.
    expect((await runIntegrationGuard("/dashboard(.*)", "/fr/dashboard")).ran).toBe(false);
  });

  it("guards a page path under basePath", async () => {
    const config = { basePath: "/console" };
    expect((await runIntegrationGuard("/dashboard(.*)", "/console/dashboard", config)).ran).toBe(
      true,
    );
    expect(
      (await runIntegrationGuard("/dashboard/:path*", "/console/dashboard/a", config)).ran,
    ).toBe(true);
    expect((await runIntegrationGuard("/dashboard(.*)", "/console/other", config)).ran).toBe(false);
    const both = { basePath: "/console", i18n: { locales: ["en", "fr"], defaultLocale: "en" } };
    expect((await runIntegrationGuard("/dashboard(.*)", "/console/fr/dashboard", both)).ran).toBe(
      true,
    );
  });
});

describe("integration guards cover both local API prefixes", () => {
  // A local API route answers at `/api/...` and at the public `api.basePath`. App middleware
  // guards both, but integration guards only saw the request path, so a matcher naming one
  // prefix left the other serving the route anonymously.
  const configs = {
    // The built server records the resolved path; its `api` stays the raw user config.
    production: { api: { basePath: "/v2/api" }, __farmAPIServerBasePath: "/v2/api" },
    // Development dispatch receives the resolved config.
    development: { api: { baseURL: "/v2/api", basePath: "/v2/api" } },
  };

  it.each(Object.entries(configs))("guards both prefixes in %s", async (_mode, config) => {
    for (const matcher of [
      "/api/private/[...path]",
      "/v2/api/private/[...path]",
      "/api/private(.*)",
      "/api/**",
    ]) {
      for (const pathname of ["/api/private/doc", "/v2/api/private/doc"]) {
        expect({
          matcher,
          pathname,
          ...(await runIntegrationGuard(matcher, pathname, config)),
        }).toMatchObject({ matcher, pathname, ran: true });
      }
    }
    expect(
      await runIntegrationGuard("/api/private/[...path]", "/v2/api/private/a/b", config),
    ).toEqual({ ran: true, params: { path: ["a", "b"] } });
  });

  it("maps only the API prefix", async () => {
    const config = configs.production;
    for (const pathname of ["/v2/apix/private/doc", "/v2/private/doc", "/private/doc"]) {
      expect((await runIntegrationGuard("/api/private(.*)", pathname, config)).ran).toBe(false);
    }
    // No API base path: nothing maps.
    expect((await runIntegrationGuard("/api/private(.*)", "/v2/api/private/doc")).ran).toBe(false);
    // An absolute baseURL is another origin; local routes stay at `/api`.
    const remote = { api: { baseURL: "https://api.example.com/v2", basePath: "/v2" } };
    expect((await runIntegrationGuard("/api/private(.*)", "/v2/private/doc", remote)).ran).toBe(
      false,
    );
  });

  it("guards a root API base path and one under the app basePath", async () => {
    const root = { __farmAPIServerBasePath: "/" };
    expect((await runIntegrationGuard("/api/private(.*)", "/private/doc", root)).ran).toBe(true);
    const nested = { basePath: "/console", __farmAPIServerBasePath: "/v2/api" };
    expect(
      (await runIntegrationGuard("/api/private(.*)", "/console/v2/api/private/doc", nested)).ran,
    ).toBe(true);
  });
});

describe("optional catch-all and wildcard matchers", () => {
  // `[[...slug]]` compiled as one required segment, so a guard on it skipped
  // the bare `/docs` page the optional catch-all serves.
  it.each([
    ["/docs/[[...slug]]", "/docs"],
    ["/docs/[[...slug]]", "/docs/a"],
    ["/docs/[[...slug]]", "/docs/a/b"],
    ["/admin*", "/admin"],
    ["/admin*", "/admin-panel"],
    ["/files/*.pdf", "/files/report.pdf"],
    ["/team/:id?", "/team"],
    ["/team/:id?", "/team/42"],
  ])("%s guards %s", async (matcher, pathname) => {
    expect(await collectGuards(matcher, pathname)).toEqual({
      devMiddleware: true,
      productionMiddleware: true,
      integration: true,
    });
  });

  it.each([
    ["/docs/[[...slug]]", "/docsx"],
    ["/admin*", "/admin/users"],
    ["/admin*", "/xadmin"],
    ["/files/*.pdf", "/files/report.txt"],
    ["/team/:id?", "/team/42/edit"],
  ])("%s still does not guard %s", async (matcher, pathname) => {
    expect(await collectGuards(matcher, pathname)).toEqual({
      devMiddleware: false,
      productionMiddleware: false,
      integration: false,
    });
  });

  it("captures the optional catch-all under its own name", async () => {
    expect((await runProductionGuard("/docs/[[...slug]]", "/docs/a/b")).params).toEqual({
      slug: "a/b",
    });
    expect((await runDevGuard("/docs/[[...slug]]", "/docs")).params).toEqual({ slug: "" });
  });

  it("runs docs/[[...slug]]/middleware.ts for every path its page serves", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-optional-catch-all-"));
    const appDir = path.join(root, "src", "app");
    await fs.mkdir(path.join(appDir, "docs", "[[...slug]]"), { recursive: true });
    await fs.writeFile(path.join(appDir, "docs", "[[...slug]]", "middleware.ts"), "export {};\n");

    try {
      const ran: string[] = [];
      const handler = async (ctx: { pathname: string }, next: () => Promise<void>) => {
        ran.push(ctx.pathname);
        await next();
      };
      const manager = new MiddlewareManager(appDir, {
        environments: {
          ssr: { runner: { import: vi.fn().mockResolvedValue({ default: handler }) } },
        },
      } as never);
      await manager.discover();
      const production = createProductionMiddlewareRunner({
        modules: (await discoverMiddlewareRoutes(appDir)).map((entry) => ({
          path: entry.path,
          module: { default: handler },
        })),
      });

      for (const [pathname, guarded] of [
        ["/docs", true],
        ["/docs/", true],
        ["/docs/intro", true],
        ["/docs/a/b", true],
        ["/docsx", false],
      ] as const) {
        expect(prodPageMatches("/docs/[[...slug]]", pathname)).toBe(guarded);
        ran.length = 0;
        const req = createRequest(pathname);
        await manager.execute(req, new ServerResponse(req));
        const devRan = ran.length > 0;
        ran.length = 0;
        await production(new Request(`https://farm.test${pathname}`));
        expect({ pathname, dev: devRan, production: ran.length > 0 }).toEqual({
          pathname,
          dev: guarded,
          production: guarded,
        });
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

describe("basePath with i18n strips the base path once", () => {
  // The built page router stripped basePath and then let the locale step strip
  // it again, while every guard stripped it once. `/console/console/secret`
  // rendered the `/secret` page and its guards, seeing `/console/secret`,
  // never ran.
  const i18n = resolveFarmI18nConfig(
    { locales: ["en", "de"], defaultLocale: "en", routing: "prefix-except-default" },
    { basePath: "/console" },
  );
  const source = fsSync.readFileSync(
    new URL("../nitro/universal-build.ts", import.meta.url),
    "utf8",
  );
  const start = source.indexOf(
    "function getFarmRoutePathname(pathname) {\n  return farmI18nRuntime",
  );
  const productionRoutePathname = new Function(
    "farmI18nRuntime",
    "farmI18nConfig",
    "stripFarmLocaleFromPathname",
    "stripFarmBasePath",
    `${source.slice(start, source.indexOf("\n}\n", start) + 3)}return getFarmRoutePathname;`,
  )({}, i18n, stripFarmLocaleFromPathname, (pathname: string) =>
    stripFarmBasePath(pathname, "/console"),
  ) as (pathname: string) => string;

  it.each([
    ["/console/secret", "/secret"],
    ["/console/de/secret", "/secret"],
    ["/console/console/secret", "/console/secret"],
    ["/console/console/de/secret", "/console/de/secret"],
    ["/console/de/console/secret", "/console/secret"],
  ])("%s routes to %s, and every guard sees the same path", async (pathname, routePath) => {
    expect(start).toBeGreaterThan(-1);
    expect(productionRoutePathname(pathname)).toBe(routePath);
    // The dev page router already strips once.
    expect(
      (
        RouteManager.prototype as unknown as { toRoutePathname(pathname: string): string }
      ).toRoutePathname.call(
        { config: { basePath: "/console" }, getI18nConfig: () => i18n },
        pathname,
      ),
    ).toBe(routePath);
    const servesSecret = routePath === "/secret";

    const ran = { dev: false, production: false };
    const fileGuard = (key: keyof typeof ran) => ({
      default: async (_ctx: unknown, next: () => Promise<void>) => {
        ran[key] = true;
        await next();
      },
    });
    await createProductionMiddlewareRunner({
      modules: [{ path: "/secret", module: fileGuard("production") }],
      i18n,
    })(new Request(`https://farm.test${pathname}`));
    const appDir = fsSync.mkdtempSync(path.join(os.tmpdir(), "farm-base-path-i18n-"));
    try {
      fsSync.mkdirSync(path.join(appDir, "secret"));
      fsSync.writeFileSync(path.join(appDir, "secret", "middleware.ts"), "export {};\n");
      const vite = {
        environments: {
          ssr: { runner: { import: vi.fn().mockResolvedValue(fileGuard("dev")) } },
        },
      };
      const manager = new MiddlewareManager(appDir, vite as never, undefined, i18n);
      await manager.discover();
      const req = createRequest(pathname);
      await manager.execute(req, new ServerResponse(req));
    } finally {
      fsSync.rmSync(appDir, { recursive: true, force: true });
    }
    const integration = await runIntegrationGuard("/secret(.*)", pathname, {
      basePath: "/console",
      i18n,
    });

    expect({ pathname, ...ran, integration: integration.ran }).toEqual({
      pathname,
      dev: servesSecret,
      production: servesSecret,
      integration: servesSecret,
    });
  });
});

describe("prerendering agrees with the runtime middleware matcher", () => {
  // A prerendered page becomes a public file that middleware never sees, so
  // the build may only prerender a path when runtime middleware would skip it.
  // The build used its own matcher copy: `/members/(.*)` kept the trailing
  // slash and never met `/members/secret`, so a guarded page shipped as a
  // static file served to everyone.
  const cases: Array<{ matcher: string; exclude?: string[]; pathname: string }> = [
    { matcher: "/members/(.*)", pathname: "/members/secret" },
    { matcher: "/members/(.*)", pathname: "/members" },
    { matcher: "/members(.*)", pathname: "/members/secret" },
    { matcher: "/members/:path*", pathname: "/members/a/b" },
    { matcher: "/(.*)", exclude: ["/docs/[[...slug]]"], pathname: "/docs" },
    { matcher: "/(.*)", exclude: ["/docs/[[...slug]]"], pathname: "/docs/a" },
    { matcher: "/(.*)", exclude: ["/a/:p?"], pathname: "/a" },
    { matcher: "/(.*)", exclude: ["/a/:p?"], pathname: "/a/b" },
    { matcher: "/(.*)", exclude: ["/public(.*)"], pathname: "/public/page" },
    { matcher: "/members/(.*)", pathname: "/other" },
    { matcher: "/members/(.*)", pathname: "/membership" },
  ];

  it.each(cases)(
    "$matcher (exclude $exclude) at $pathname",
    async ({ matcher, exclude, pathname }) => {
      let ran = false;
      const runner = createProductionMiddlewareRunner({
        config: [
          {
            matcher: [matcher],
            exclude,
            handler() {
              ran = true;
            },
          },
        ],
      });
      await runner(new Request(`https://farm.test${pathname}`));
      const buildKeepsServerHandled = configMiddlewareMayHandlePath(
        [{ matcher: [matcher], exclude, handler() {} }] as never,
        pathname,
      );
      expect({ pathname, buildKeepsServerHandled }).toEqual({
        pathname,
        buildKeepsServerHandled: ran,
      });
    },
  );

  it("keeps a request-aware matcher server-handled", () => {
    expect(
      configMiddlewareMayHandlePath([{ matcher: [() => false], handler() {} }] as never, "/x"),
    ).toBe(true);
  });

  it("matches file middleware routes like the production runner", async () => {
    for (const [routePath, pathname] of [
      ["/members", "/members/secret"],
      ["/members", "/members"],
      ["/docs/[[...slug]]", "/docs/a/b"],
      ["/members", "/membership"],
    ] as const) {
      let ran = false;
      const runner = createProductionMiddlewareRunner({
        modules: [
          {
            path: routePath,
            module: {
              default: async (_ctx: unknown, next: () => Promise<void>) => {
                ran = true;
                await next();
              },
            },
          },
        ],
      });
      await runner(new Request(`https://farm.test${pathname}`));
      expect({
        routePath,
        pathname,
        build: appMiddlewareMayHandlePath([{ path: routePath } as never], pathname),
      }).toEqual({ routePath, pathname, build: ran });
    }
  });
});

describe("function matchers and .when() conditions see the route pathname", () => {
  // String matchers compare the route pathname (decoded once, basePath and
  // locale stripped), but a function matcher or `.when()` condition got only
  // `ctx.pathname`, the raw request path. `/%61pi/admin` then walked past
  // `ctx.pathname.startsWith("/api/admin")` while the router served
  // `/api/admin`, and under `basePath: "/console"` a check written for the
  // app path, as the docs say, never ran at all.
  const consoleBase = resolveFarmI18nConfig(undefined, { basePath: "/console" });
  type Seen = { ran: boolean; pathname?: string; routePathname?: string };

  async function runBoth(
    entry: (seen: Seen) => FarmMiddlewareConfig,
    pathname: string,
    i18n?: ReturnType<typeof resolveFarmI18nConfig>,
  ): Promise<{ dev: Seen; production: Seen }> {
    const dev: Seen = { ran: false };
    const production: Seen = { ran: false };
    const req = createRequest(pathname);
    await new MiddlewareManager("/tmp", undefined, entry(dev), i18n).execute(
      req,
      new ServerResponse(req),
    );
    await createProductionMiddlewareRunner({ config: entry(production), i18n })(
      new Request(`https://farm.test${pathname}`),
    );
    return { dev, production };
  }

  const record = (seen: Seen) => (ctx: MiddlewareContext) => {
    seen.ran = true;
    seen.pathname = ctx.pathname;
    seen.routePathname = ctx.routePathname;
  };
  const fnMatcher =
    (prefix: string) =>
    (seen: Seen): FarmMiddlewareConfig => [
      {
        matcher: (ctx: MiddlewareContext) => ctx.pathname.startsWith(prefix),
        handler: record(seen),
      },
    ];
  const whenCondition =
    (prefix: string) =>
    (seen: Seen): FarmMiddlewareConfig => [
      {
        handlers: middleware()
          .when(
            (ctx) => ctx.pathname.startsWith(prefix),
            async (ctx, next) => {
              record(seen)(ctx);
              await next();
            },
          )
          .build().handlers,
      },
    ];

  it.each([
    ["/api/admin", true],
    ["/%61pi/admin", true],
    ["/api/%61dmin", true],
    ["/%61pi/admin/1", true],
    ["/api/public", false],
  ])("a function matcher for /api/admin guards %s: %s", async (pathname, ran) => {
    const { dev, production } = await runBoth(fnMatcher("/api/admin"), pathname);
    expect({ pathname, dev: dev.ran, production: production.ran }).toEqual({
      pathname,
      dev: ran,
      production: ran,
    });
  });

  it.each([
    ["/admin/1", true],
    ["/%61dmin/1", true],
    ["/other", false],
  ])("a .when() condition for /admin guards %s: %s", async (pathname, ran) => {
    const { dev, production } = await runBoth(whenCondition("/admin"), pathname);
    expect({ pathname, dev: dev.ran, production: production.ran }).toEqual({
      pathname,
      dev: ran,
      production: ran,
    });
  });

  it.each([
    ["/console/admin", true],
    ["/console/admin/1", true],
    ["/console/%61dmin/1", true],
    ["/console/other", false],
  ])("under basePath, guards written for the app path guard %s: %s", async (pathname, ran) => {
    for (const entry of [fnMatcher("/admin"), whenCondition("/admin")]) {
      const { dev, production } = await runBoth(entry, pathname, consoleBase);
      expect({ pathname, dev: dev.ran, production: production.ran }).toEqual({
        pathname,
        dev: ran,
        production: ran,
      });
    }
  });

  it("exposes ctx.routePathname and leaves ctx.pathname raw", async () => {
    const { dev, production } = await runBoth(
      (seen) => [{ handler: record(seen) }],
      "/console/%61dmin/1",
      consoleBase,
    );
    for (const seen of [dev, production]) {
      expect(seen).toEqual({
        ran: true,
        pathname: "/console/%61dmin/1",
        routePathname: "/admin/1",
      });
    }
  });

  it("updates ctx.routePathname on rewrite", async () => {
    const seen: string[] = [];
    const entry: FarmMiddlewareConfig = [
      {
        handler(ctx) {
          ctx.rewrite("/console/%62illing");
          seen.push(ctx.routePathname);
        },
      },
    ];
    const req = createRequest("/console/start");
    await new MiddlewareManager("/tmp", undefined, entry, consoleBase).execute(
      req,
      new ServerResponse(req),
    );
    await createProductionMiddlewareRunner({ config: entry, i18n: consoleBase })(
      new Request("https://farm.test/console/start"),
    );
    expect(seen).toEqual(["/billing", "/billing"]);
  });
});
