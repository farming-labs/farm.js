// @vitest-environment node
import { describe, expect, it } from "vitest";
import { defineIntegration } from "../integrations";
import { farmPathGuardCoversPage } from "../middleware/may-handle";

/**
 * sitemap.xml, llms.txt and the default MCP server are public listings: a page a guard
 * written for its path covers is left out, so its path and title stay unpublished. A guard
 * covering every path names no page and hides nothing, or the listings would be empty.
 */
const guarded = (middleware: readonly unknown[]) =>
  defineIntegration({
    category: "auth",
    type: "listing-guard",
    instance: {},
    middleware: middleware as never,
  });
const deny = () => new Response(null, { status: 401 });

describe("farmPathGuardCoversPage", () => {
  it.each([
    ["config matcher", { middleware: [{ matcher: "/private/:path*" }] }, [], "/private/notes"],
    ["config RegExp matcher", { middleware: [{ matcher: /^\/private\// }] }, [], "/private/notes"],
    [
      "config matcher list with a catch-all",
      { middleware: [{ matcher: ["/(.*)", "/private/:path*"] }] },
      [],
      "/private/notes",
    ],
    ["file middleware", {}, [{ path: "/staff" }], "/staff/roster"],
    [
      "integration protectedRoutes",
      { integrations: { auth: guarded([{ matcher: ["/members(.*)"], handler: deny }]) } },
      [],
      "/members/area",
    ],
  ] as const)("hides a page behind a %s", (_label, config, middlewareRoutes, pathname) => {
    expect(farmPathGuardCoversPage({ config: config as never, middlewareRoutes }, pathname)).toBe(
      true,
    );
  });

  it.each([
    ["root file middleware", {}, [{ path: "/" }]],
    ["config middleware without a matcher", { middleware: [{ handler() {} }] }, []],
    ["config catch-all matcher", { middleware: [{ matcher: "/(.*)" }, { matcher: "*" }] }, []],
    ["config :path* from the root", { middleware: [{ matcher: "/:path*" }] }, []],
    ["config function matcher", { middleware: [{ matcher: () => true }] }, []],
    ["config exclude only", { middleware: [{ exclude: ["/public"] }] }, []],
    [
      "integration middleware without a matcher",
      { integrations: { auth: guarded([{ handler: deny }]) } },
      [],
    ],
    [
      "integration catch-all matcher",
      { integrations: { auth: guarded([{ matcher: "/(.*)", handler: deny }]) } },
      [],
    ],
  ] as const)("keeps pages listed behind a %s", (_label, config, middlewareRoutes) => {
    for (const pathname of ["/", "/about"]) {
      expect(farmPathGuardCoversPage({ config: config as never, middlewareRoutes }, pathname)).toBe(
        false,
      );
    }
  });

  it("keeps public pages next to guarded ones listed", () => {
    const guards = {
      config: {
        middleware: [{ matcher: "/private/:path*" }],
        integrations: { auth: guarded([{ matcher: ["/members(.*)"], handler: deny }]) },
      } as never,
      middlewareRoutes: [{ path: "/" }, { path: "/staff" }],
    };
    for (const pathname of ["/", "/about", "/privacy", "/staffing", "/membership"]) {
      expect({ pathname, covered: farmPathGuardCoversPage(guards, pathname) }).toEqual({
        pathname,
        covered: false,
      });
    }
  });
});
