// @vitest-environment node
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { describe, expect, it } from "vitest";
import { defineIntegration, dispatchIntegrationRequest } from "../integrations";
import { MiddlewareManager } from "../middleware/manager";
import { createProductionMiddlewareRunner } from "../middleware/production-runtime";
import type { MiddlewareMatcher } from "../middleware/types";
import { generateRuntimePathMatcherSource } from "../nitro/universal-build";
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
async function runIntegrationGuard(matcher: string, pathname: string): Promise<GuardRun> {
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
    { integration, config: {}, isDev: false, isProd: true },
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

  it("leaves trailing slashes and empty segments alone", async () => {
    // Pinned, not endorsed: the guard matchers compile `/dashboard` to an
    // exact regex, so a trailing slash misses them while the page matchers
    // normalize it away. That divergence predates this change and is a
    // separate concern; canonicalizing the pathname must not quietly alter it
    // in either direction.
    const trailing = await collectGuards("/dashboard", "/dashboard/");
    expect(trailing).toEqual({
      devMiddleware: false,
      productionMiddleware: false,
      integration: true,
    });
    expect(await collectGuards("/dashboard(.*)", "/dashboard/")).toEqual({
      devMiddleware: true,
      productionMiddleware: true,
      integration: true,
    });
  });
});
