import { describe, expect, it } from "vitest";
import { resolveConfig } from "../config";
import { defineIntegration, resolveIntegrationPlugins } from "../integrations";
import { MiddlewareManager } from "../middleware/manager";
import { compileMiddlewareConfig, matchesMiddlewareConfig } from "../middleware/matcher";
import { createProductionMiddlewareRunner } from "../middleware/production-runtime";
import type { MiddlewareContext } from "../middleware/types";

// Strings the Next.js, Auth.js, Clerk, and Supabase docs tell apps to use. Farm
// compiled each to a literal that met no request, so the gate never ran.
const unsupported = [
  "/((?!api|_next/static|_next/image|favicon.ico).*)",
  "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
  "/(api|trpc)(.*)",
];

const rejection = /is not a supported string pattern[\s\S]*Pass a RegExp instead/;

function match(matcher: string | RegExp, pathname: string) {
  return matchesMiddlewareConfig(pathname, { matcher }, { pathname } as MiddlewareContext);
}

describe("middleware matcher strings", () => {
  it.each(unsupported)("rejects %s as a matcher and as an exclusion", (pattern) => {
    expect(() => compileMiddlewareConfig({ matcher: pattern })).toThrow(rejection);
    expect(() => compileMiddlewareConfig({ matcher: [pattern] })).toThrow(pattern);
    expect(() => compileMiddlewareConfig({ exclude: [pattern] })).toThrow(rejection);
  });

  it.each([
    "/team/:id(\\d+)",
    "/posts/:id.json",
    "/docs/[slug",
    "/:locale(.*)",
    "/docs/[id](.*)",
    "/admin$",
    "/search?q",
  ])("rejects %s, which compiled to a pattern other than the one written", (pattern) => {
    expect(() => compileMiddlewareConfig({ matcher: pattern })).toThrow(rejection);
  });

  it.each([
    ["/dashboard/:path*", "/dashboard/reports/weekly", true],
    ["/dashboard/:path+", "/dashboard", false],
    ["/team/:id?", "/team", true],
    ["/team/:id", "/team/42", true],
    ["/dashboard/[section]", "/dashboard/settings", true],
    ["/docs/[...slug]", "/docs/a/b", true],
    ["/docs/[[...slug]]", "/docs", true],
    ["/api/**", "/api/a/b", true],
    ["/api/*", "/api/a/b", false],
    ["/admin*", "/admin-panel", true],
    ["/auth(.*)", "/auth/callback", true],
    ["/members/(.*)", "/members/x", true],
    ["/(.*)", "/anything", true],
    ["*", "/anything", true],
    ["/favicon.ico", "/favicon.ico", true],
    ["/c++", "/c++", true],
  ])("keeps %s matching %s as before", (pattern, pathname, matched) => {
    expect(match(pattern, pathname).matched).toBe(matched);
  });

  it("accepts the RegExp form the error suggests", () => {
    const matcher = /^\/(?!api|_next).*/;
    expect(match(matcher, "/dashboard").matched).toBe(true);
    expect(match(matcher, "/api/users").matched).toBe(false);
  });

  it("fails when the production runner starts, not on the first request", () => {
    const handler = () => undefined;
    expect(() =>
      createProductionMiddlewareRunner({ config: { matcher: unsupported[0], handler } }),
    ).toThrow(rejection);
    expect(() => createProductionMiddlewareRunner({ config: { matcher: unsupported[2] } })).toThrow(
      rejection,
    );
    expect(() =>
      createProductionMiddlewareRunner({
        modules: [
          {
            path: "/",
            module: { default: handler, config: { matcher: unsupported[1] } },
          },
        ],
      }),
    ).toThrow(rejection);
  });

  it("fails when the dev middleware manager is configured", () => {
    expect(
      () => new MiddlewareManager("/nonexistent", undefined, { matcher: unsupported[0] }),
    ).toThrow(rejection);
  });

  it("fails config resolution, which farm dev and farm build share", async () => {
    await expect(
      resolveConfig({ middleware: { matcher: unsupported[2] }, telemetry: false }, "production"),
    ).rejects.toThrow(rejection);
    await expect(
      resolveConfig(
        { middleware: [{ matcher: ["/dashboard(.*)"], exclude: [unsupported[0]] }] },
        "production",
      ),
    ).rejects.toThrow(rejection);
  });

  it("fails an integration whose middleware matcher is unsupported", () => {
    const integration = defineIntegration({
      category: "auth",
      type: "test",
      instance: {},
      middleware: [{ matcher: ["/dashboard(.*)", unsupported[2]], handler: () => undefined }],
    } as never);
    expect(() => resolveIntegrationPlugins({ auth: integration })).toThrow(
      /Integration "auth": Middleware matcher "\/\(api\|trpc\)\(\.\*\)"/,
    );
    const supported = defineIntegration({
      category: "auth",
      type: "test",
      instance: {},
      middleware: [{ matcher: ["/dashboard(.*)", "/account/:path*"], handler: () => undefined }],
    } as never);
    expect(() => resolveIntegrationPlugins({ auth: supported })).not.toThrow();
  });
});
