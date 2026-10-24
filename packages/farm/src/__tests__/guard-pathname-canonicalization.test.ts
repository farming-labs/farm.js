// @vitest-environment node
import fs from "node:fs/promises";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { matchAPIRoute } from "../api/route-pattern";
import { defineIntegration, dispatchIntegrationRequest } from "../integrations";
import { MiddlewareManager } from "../middleware/manager";
import { createProductionMiddlewareRunner } from "../middleware/production-runtime";
import type { MiddlewareMatcher } from "../middleware/types";
import {
  discoverMiddlewareRoutes,
  generateRuntimePathMatcherSource,
} from "../nitro/universal-build";
import { resolveFarmRequestURL } from "../server/request";
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
