// @vitest-environment node

// Integration middleware is the mechanism behind every auth integration's
// `protectedRoutes` guard. It is not route scoped, so the production entry has
// to run it for ordinary page and API requests that match no integration route.
// The generated entry used to dispatch only after `matchIntegrationRoute` found
// a route, which meant a guard mounted on `/dashboard` never ran in a build and
// anonymous visitors were served the protected page. Every pre-existing test
// called `integration.middleware[0].handler` directly, so none of them observed
// the production gate at all; these drive the generated entry source instead.

import { describe, expect, it } from "vitest";
import {
  defineIntegration,
  dispatchIntegrationRequests,
  forwardIntegrationSetCookies,
  matchIntegrationRoute,
  resolveIntegrationPlugins,
} from "../integrations";
import { applyProductionMiddlewareHeaders } from "../middleware/production-runtime";
import { generateIntegrationRequestRuntimeSource } from "../nitro/universal-build";
import { PluginManager } from "../plugin";

const SIGN_IN_PATH = "/sign-in";

/**
 * Clerk's shape: middleware only, no `routes` key at all. Nothing this
 * integration mounts can be reached through a route match.
 */
function createClerkShapedIntegration(seen: string[] = []) {
  return defineIntegration({
    category: "auth",
    type: "clerk",
    middleware: [
      {
        matcher: ["/dashboard(.*)"],
        handler(request: Request) {
          const url = new URL(request.url);
          seen.push(url.pathname);
          if (request.headers.get("cookie")?.includes("__session=")) {
            return;
          }
          return new Response(null, {
            status: 302,
            headers: {
              location: `${SIGN_IN_PATH}?redirect_url=${encodeURIComponent(url.pathname)}`,
            },
          });
        },
      },
    ],
  });
}

/**
 * Compile the integration dispatch the production entry actually ships, wired
 * to the real core functions the generated bundle imports. Nothing here is a
 * stand-in for the runtime: the source is the generated source.
 */
function createProductionIntegrationRuntime(integrations: Record<string, unknown>) {
  const source = generateIntegrationRequestRuntimeSource({
    hasServerRuntimeIntegrations: true,
  });

  return new Function(
    "serverRuntimeIntegrations",
    "integrationRuntimeConfig",
    "matchIntegrationRoute",
    "dispatchIntegrationRequests",
    `${source}
return {
  handleIntegrationRequest,
  matchLocalIntegrationRequest,
  withFarmIntegrationSetCookies,
};`,
  )(integrations, {}, matchIntegrationRoute, dispatchIntegrationRequests) as {
    handleIntegrationRequest: (
      request: Request,
    ) => Promise<{ response: Response | null; setCookies: string[] }>;
    matchLocalIntegrationRequest: (request: Request) => unknown;
    withFarmIntegrationSetCookies: (
      headers: Headers | undefined,
      cookies: string[],
    ) => Headers | undefined;
  };
}

describe("production integration middleware dispatch", () => {
  it("redirects an anonymous request for a protected page", async () => {
    const seen: string[] = [];
    const runtime = createProductionIntegrationRuntime({
      auth: createClerkShapedIntegration(seen),
    });

    const { response } = await runtime.handleIntegrationRequest(
      new Request("https://app.test/dashboard"),
    );

    expect(seen).toEqual(["/dashboard"]);
    expect(response?.status).toBe(302);
    expect(response?.headers.get("location")).toBe(`${SIGN_IN_PATH}?redirect_url=%2Fdashboard`);
  });

  it("lets an authenticated request through to the page", async () => {
    const runtime = createProductionIntegrationRuntime({
      auth: createClerkShapedIntegration(),
    });

    const { response } = await runtime.handleIntegrationRequest(
      new Request("https://app.test/dashboard", {
        headers: { cookie: "__session=token" },
      }),
    );

    expect(response).toBeNull();
  });

  it("leaves a path the matcher does not cover alone", async () => {
    const seen: string[] = [];
    const runtime = createProductionIntegrationRuntime({
      auth: createClerkShapedIntegration(seen),
    });

    const { response } = await runtime.handleIntegrationRequest(
      new Request("https://app.test/pricing"),
    );

    expect(seen).toEqual([]);
    expect(response).toBeNull();
  });

  it("keeps the matcher's segment boundary", async () => {
    const seen: string[] = [];
    const runtime = createProductionIntegrationRuntime({
      auth: createClerkShapedIntegration(seen),
    });

    // `/dashboard(.*)` covers the path itself and anything below it, and stops
    // at the segment boundary, so a sibling path that merely shares the prefix
    // is not guarded.
    const nested = await runtime.handleIntegrationRequest(
      new Request("https://app.test/dashboard/settings/billing"),
    );
    const sibling = await runtime.handleIntegrationRequest(
      new Request("https://app.test/dashboardsecret"),
    );

    expect(nested.response?.status).toBe(302);
    expect(sibling.response).toBeNull();
    expect(seen).toEqual(["/dashboard/settings/billing"]);
  });

  it("supports a regex-style catch-all matcher and a plain path matcher", async () => {
    const seen: string[] = [];
    const runtime = createProductionIntegrationRuntime({
      auth: defineIntegration({
        category: "auth",
        type: "auth0",
        middleware: [
          { matcher: "/(.*)", handler: (r: Request) => void seen.push(new URL(r.url).pathname) },
          { matcher: ["/account"], handler: () => void seen.push("account-only") },
        ],
      }),
    });

    await runtime.handleIntegrationRequest(new Request("https://app.test/pricing"));
    await runtime.handleIntegrationRequest(new Request("https://app.test/account"));

    expect(seen).toEqual(["/pricing", "/account", "account-only"]);
  });

  // The old gate's predicate, kept as an explicit record of why the bypass
  // existed: a protected page path matches no integration route, so gating
  // dispatch on a route match skipped the guard entirely.
  it("does not match a protected page as an integration route", () => {
    const runtime = createProductionIntegrationRuntime({
      auth: createClerkShapedIntegration(),
    });

    expect(runtime.matchLocalIntegrationRequest(new Request("https://app.test/dashboard"))).toBe(
      null,
    );
  });

  it("runs a middleware-only integration even when another integration owns the matched route", async () => {
    const order: string[] = [];
    const guard = defineIntegration({
      category: "auth",
      type: "clerk",
      middleware: [
        {
          matcher: ["/api(.*)"],
          handler() {
            order.push("guard");
            return undefined;
          },
        },
      ],
    });
    const withRoute = defineIntegration({
      category: "email",
      type: "resend",
      routes: [
        {
          path: "/api/send",
          methods: ["GET"],
          handler() {
            order.push("route");
            return new Response("sent");
          },
        },
      ],
    });

    const runtime = createProductionIntegrationRuntime({ auth: guard, email: withRoute });
    const { response } = await runtime.handleIntegrationRequest(
      new Request("https://app.test/api/send"),
    );

    expect(order).toEqual(["guard", "route"]);
    expect(await response?.text()).toBe("sent");
  });

  it("stops at the first middleware that returns a response", async () => {
    const order: string[] = [];
    const blocking = defineIntegration({
      category: "auth",
      type: "clerk",
      middleware: [
        {
          matcher: ["/dashboard(.*)"],
          handler() {
            order.push("blocking");
            return new Response(null, { status: 401 });
          },
        },
      ],
    });
    const later = defineIntegration({
      category: "analytics",
      type: "posthog",
      middleware: [
        {
          matcher: ["/dashboard(.*)"],
          handler() {
            order.push("later");
            return undefined;
          },
        },
      ],
    });

    const runtime = createProductionIntegrationRuntime({ auth: blocking, analytics: later });
    const { response } = await runtime.handleIntegrationRequest(
      new Request("https://app.test/dashboard"),
    );

    expect(response?.status).toBe(401);
    expect(order).toEqual(["blocking"]);
  });

  it("forwards Set-Cookie from a passthrough middleware onto the downstream response", async () => {
    const refreshing = defineIntegration({
      category: "auth",
      type: "supabase",
      middleware: [
        {
          matcher: ["/(.*)"],
          handler(_request: Request, context) {
            forwardIntegrationSetCookies(context, [
              "sb-access-token=fresh; Path=/; HttpOnly",
              "sb-refresh-token=rotated; Path=/; HttpOnly",
            ]);
            return undefined;
          },
        },
      ],
    });

    const runtime = createProductionIntegrationRuntime({ auth: refreshing });
    const { response, setCookies } = await runtime.handleIntegrationRequest(
      new Request("https://app.test/dashboard"),
    );

    // The request continues to the page, so the rotated cookies ride the
    // deferred header bag that every downstream response already applies.
    expect(response).toBeNull();
    expect(setCookies).toEqual([
      "sb-access-token=fresh; Path=/; HttpOnly",
      "sb-refresh-token=rotated; Path=/; HttpOnly",
    ]);

    const pageResponse = applyProductionMiddlewareHeaders(
      new Response("<html>dashboard</html>", {
        headers: { "set-cookie": "theme=dark; Path=/" },
      }),
      runtime.withFarmIntegrationSetCookies(undefined, setCookies),
    );

    expect(pageResponse.headers.getSetCookie()).toEqual([
      "theme=dark; Path=/",
      "sb-access-token=fresh; Path=/; HttpOnly",
      "sb-refresh-token=rotated; Path=/; HttpOnly",
    ]);
  });

  it("carries forwarded Set-Cookie onto a later short-circuiting response", async () => {
    const refreshing = defineIntegration({
      category: "auth",
      type: "supabase",
      middleware: [
        {
          matcher: ["/(.*)"],
          handler(_request: Request, context) {
            forwardIntegrationSetCookies(context, ["sb-access-token=fresh; Path=/"]);
            return undefined;
          },
        },
      ],
    });
    const blocking = defineIntegration({
      category: "analytics",
      type: "posthog",
      middleware: [
        {
          matcher: ["/dashboard(.*)"],
          handler() {
            return new Response(null, { status: 302, headers: { location: SIGN_IN_PATH } });
          },
        },
      ],
    });

    const runtime = createProductionIntegrationRuntime({ auth: refreshing, analytics: blocking });
    const { response } = await runtime.handleIntegrationRequest(
      new Request("https://app.test/dashboard"),
    );

    expect(response?.status).toBe(302);
    expect(response?.headers.getSetCookie()).toEqual(["sb-access-token=fresh; Path=/"]);
  });
});

describe("dev and production run the same integration middleware", () => {
  /** Minimal ServerResponse surface `sendWebResponse` touches for a bodyless response. */
  function createRecordingResponse() {
    const headers = new Map<string, string | string[]>();
    return {
      statusCode: 200,
      ended: false,
      setHeader(key: string, value: string | string[]) {
        headers.set(key.toLowerCase(), value);
      },
      getHeader(key: string) {
        return headers.get(key.toLowerCase());
      },
      end() {
        this.ended = true;
        return this;
      },
      get location() {
        return headers.get("location");
      },
    };
  }

  it("guards an anonymous protected page identically in both runtimes", async () => {
    const integrations = { auth: createClerkShapedIntegration() };

    const production = createProductionIntegrationRuntime(integrations);
    const { response } = await production.handleIntegrationRequest(
      new Request("https://app.test/dashboard"),
    );

    // The dev server runs the same middleware through the plugin manager's
    // `beforeRequest` hook (vite.ts), so drive that hook, not the handler.
    const manager = new PluginManager({ config: {}, isDev: true, isProd: false } as never);
    manager.addPlugins(resolveIntegrationPlugins(integrations as never));
    const req = {
      url: "/dashboard",
      method: "GET",
      headers: { host: "app.test" },
    };
    const res = createRecordingResponse();
    await manager.runHookParallel("beforeRequest", req, res);

    expect(response?.status).toBe(302);
    expect(res.statusCode).toBe(response?.status);
    expect(res.location).toBe(response?.headers.get("location"));
  });
});
