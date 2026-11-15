// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { notFound, permanentRedirect, redirect } from "../navigation-errors";
import {
  createFarmPageDataRedirectResponse,
  getFarmPageDataRedirect,
  readFarmPageDataRedirect,
} from "../navigation/page-data-redirect";

function thrown(fn: () => never): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("expected a throw");
}

describe("page-data redirects", () => {
  it("maps redirect() and permanentRedirect() to their target and status", () => {
    expect(getFarmPageDataRedirect(thrown(() => redirect("/dashboard")))).toEqual({
      location: "/dashboard",
      status: 307,
    });
    expect(getFarmPageDataRedirect(thrown(() => redirect("/login?next=/a;b", 303)))).toEqual({
      location: "/login?next=/a;b",
      status: 303,
    });
    expect(getFarmPageDataRedirect(thrown(() => permanentRedirect("/new")))).toEqual({
      location: "/new",
      status: 308,
    });
  });

  it("maps a thrown 3xx Response with a Location", () => {
    expect(getFarmPageDataRedirect(Response.redirect("https://farm.test/sign-in", 302))).toEqual({
      location: "https://farm.test/sign-in",
      status: 302,
    });
  });

  it("leaves other outcomes to the failure mapping", () => {
    expect(getFarmPageDataRedirect(new Response(null, { status: 307 }))).toBeNull();
    expect(
      getFarmPageDataRedirect(new Response(null, { status: 304, headers: { location: "/x" } })),
    ).toBeNull();
    expect(getFarmPageDataRedirect(new Response(null, { status: 401 }))).toBeNull();
    expect(getFarmPageDataRedirect(thrown(() => notFound()))).toBeNull();
    expect(getFarmPageDataRedirect(new Error("FARM_REDIRECT;307;/dashboard"))).toBeNull();
  });

  it("answers with a 200 instruction fetch does not follow", async () => {
    const response = createFarmPageDataRedirectResponse({ location: "/dashboard", status: 307 });

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-farm-navigation")).toBe("redirect");
    await expect(readFarmPageDataRedirect(response)).resolves.toEqual({
      location: "/dashboard",
      status: 307,
    });
  });

  it("reads ordinary page data as no redirect without consuming it", async () => {
    const response = Response.json(
      { redirect: { location: "/not-an-instruction", status: 307 } },
      { headers: { "X-Farm-Navigation": "html-fragment" } },
    );

    await expect(readFarmPageDataRedirect(response)).resolves.toBeNull();
    expect(response.bodyUsed).toBe(false);
  });

  it("answers redirecting page data in the secondary production handler", async () => {
    const { fetch: handle } = await import("../nitro/server-entry");
    const previousRegistry = globalThis.__FARM_REGISTRY__;
    globalThis.__FARM_REGISTRY__ = {
      routeManager: {
        matchRedirect: () => null,
        matchRoute: () => ({
          route: { pattern: "/", modulePath: "/src/app/page.tsx" },
          params: {},
          layouts: [],
        }),
        getMatchingLoading: () => null,
        generateClientManifest: () => ({ routes: [], layouts: [] }),
        loadRouteModule: async () => ({
          default: () => null,
          generateMetadata: () => redirect("/dashboard"),
        }),
      } as never,
    };
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = await handle(new Request("https://farm.test/__farm/page-data?path=/"));

      expect(response.status).toBe(200);
      expect(response.headers.get("x-farm-navigation")).toBe("redirect");
      await expect(response.json()).resolves.toEqual({
        redirect: { location: "/dashboard", status: 307 },
      });
      expect(errors).not.toHaveBeenCalled();
    } finally {
      errors.mockRestore();
      globalThis.__FARM_REGISTRY__ = previousRegistry;
    }
  });

  it("rejects a malformed redirect instruction", async () => {
    const response = Response.json(
      { redirect: { location: "/dashboard", status: 200 } },
      { headers: { "X-Farm-Navigation": "redirect" } },
    );

    await expect(readFarmPageDataRedirect(response)).rejects.toThrow("invalid redirect");
  });
});
