/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SPARouter } from "../client/spa-router";
import type { FarmClientPluginManager } from "../client/plugin";
import { createFarmPageDataRedirectResponse } from "../navigation/page-data-redirect";

const routers: SPARouter[] = [];

function createRouter() {
  const router = new SPARouter({ scrollRestoration: false });
  routers.push(router);
  const rendered: string[] = [];
  router.setNavigationHandler(async (data) => {
    rendered.push(data.modulePath);
  });
  return { router, rendered };
}

function pageData(path: string): Response {
  return Response.json({ props: {}, modulePath: `/src/app${path}/page.tsx` });
}

/** Page data per requested path: a redirect location, or rendered page data. */
function serve(routes: Record<string, string | null>) {
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const path = new URL(String(input), window.location.origin).searchParams.get("path")!;
    const pathname = new URL(path, window.location.origin).pathname;
    const location = routes[pathname];
    return location
      ? createFarmPageDataRedirectResponse({ location, status: 307 })
      : pageData(pathname);
  });
  vi.stubGlobal("fetch", fetch);
  return {
    fetch,
    requested: () =>
      fetch.mock.calls.map(([input]) =>
        new URL(String(input), window.location.origin).searchParams.get("path"),
      ),
  };
}

/** Swap window.location.assign/replace, which jsdom cannot perform, for spies. */
function spyOnDocumentNavigation() {
  const location = window.location;
  const assign = vi.fn();
  const replace = vi.fn();
  vi.stubGlobal(
    "location",
    new Proxy(
      {},
      {
        get(_target, property) {
          if (property === "assign") return assign;
          if (property === "replace") return replace;
          const value = Reflect.get(location, property, location);
          return typeof value === "function" ? value.bind(location) : value;
        },
      },
    ),
  );
  return { assign, replace };
}

async function settle(assertion: () => void): Promise<void> {
  let error: unknown;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      assertion();
      return;
    } catch (caught) {
      error = caught;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }
  throw error;
}

beforeEach(() => {
  window.history.replaceState(null, "", "/settings");
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
});

afterEach(() => {
  while (routers.length > 0) routers.pop()!.destroy();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

describe("SPA router page-data redirects", () => {
  it("continues a push at the target without an entry for the redirecting URL", async () => {
    const errors = vi.spyOn(console, "error");
    const { router, rendered } = createRouter();
    const { requested } = serve({ "/": "/dashboard" });
    const historyLength = window.history.length;

    await router.navigate("/");

    expect(requested()).toEqual(["/", "/dashboard"]);
    expect(window.location.pathname).toBe("/dashboard");
    expect(rendered).toEqual(["/src/app/dashboard/page.tsx"]);
    expect(window.history.length).toBe(historyLength + 1);
    expect(router.getNavigationState().state).toBe("idle");
    expect(errors).not.toHaveBeenCalled();

    // Back returns to the page the navigation started from.
    window.history.back();
    await settle(() => expect(window.location.pathname).toBe("/settings"));
    await settle(() =>
      expect(rendered).toEqual(["/src/app/dashboard/page.tsx", "/src/app/settings/page.tsx"]),
    );
  });

  it("keeps a replace navigation on the replaced entry", async () => {
    const { router } = createRouter();
    serve({ "/": "/dashboard" });
    const historyLength = window.history.length;

    await router.navigate("/", { replace: true });

    expect(window.location.pathname).toBe("/dashboard");
    expect(window.history.length).toBe(historyLength);
  });

  it("follows a chain and resolves relative targets against the redirecting URL", async () => {
    const { router } = createRouter();
    const { requested } = serve({ "/old/start": "next", "/old/next": "/final?from=chain" });

    await router.navigate("/old/start");

    expect(requested()).toEqual(["/old/start", "/old/next", "/final?from=chain"]);
    expect(window.location.pathname + window.location.search).toBe("/final?from=chain");
  });

  it("inherits the original fragment unless the target has its own", async () => {
    const { router } = createRouter();
    serve({ "/": "/dashboard", "/docs": "/guide#install" });

    await router.navigate("/#billing");
    expect(window.location.pathname + window.location.hash).toBe("/dashboard#billing");

    await router.navigate("/docs#intro");
    expect(window.location.pathname + window.location.hash).toBe("/guide#install");
  });

  it("replaces the entry when a redirect lands on the current URL", async () => {
    window.history.replaceState(null, "", "/dashboard");
    const { router, rendered } = createRouter();
    serve({ "/": "/dashboard" });
    const historyLength = window.history.length;

    await router.navigate("/");

    expect(window.location.pathname).toBe("/dashboard");
    expect(window.history.length).toBe(historyLength);
    expect(rendered).toEqual(["/src/app/dashboard/page.tsx"]);
  });

  it("leaves the app for a cross-origin target", async () => {
    const { router, rendered } = createRouter();
    const { requested } = serve({ "/": "https://accounts.example.com/sign-in" });
    const { assign, replace } = spyOnDocumentNavigation();

    await router.navigate("/");
    await router.navigate("/", { replace: true });

    expect(assign).toHaveBeenCalledExactlyOnceWith("https://accounts.example.com/sign-in");
    expect(replace).toHaveBeenCalledExactlyOnceWith("https://accounts.example.com/sign-in");
    expect(requested()).toEqual(["/", "/"]);
    expect(rendered).toEqual([]);
    expect(router.getNavigationState().state).toBe("idle");
  });

  it("hands a redirect loop to the browser as a document load", async () => {
    const errors = vi.spyOn(console, "error");
    const { router, rendered } = createRouter();
    const { requested } = serve({ "/a": "/b", "/b": "/a" });
    const { assign } = spyOnDocumentNavigation();

    await router.navigate("/a");

    expect(requested()).toHaveLength(21);
    expect(assign).toHaveBeenCalledExactlyOnceWith(`${window.location.origin}/b`);
    expect(rendered).toEqual([]);
    expect(window.location.pathname).toBe("/settings");
    expect(router.getNavigationState().state).toBe("idle");
    expect(errors).not.toHaveBeenCalled();
  });

  it("replaces a traversed entry whose page data now redirects", async () => {
    const { router, rendered } = createRouter();
    const routes: Record<string, string | null> = {};
    serve(routes);
    await router.navigate("/account");
    const historyLength = window.history.length;

    routes["/settings"] = "/sign-in";
    window.history.back();

    await settle(() => expect(window.location.pathname).toBe("/sign-in"));
    await settle(() =>
      expect(rendered).toEqual(["/src/app/account/page.tsx", "/src/app/sign-in/page.tsx"]),
    );
    expect(window.history.length).toBe(historyLength);
  });

  it("does not cache, warn about, or render a redirecting prefetch", async () => {
    const warnings = vi.spyOn(console, "warn");
    const { router, rendered } = createRouter();
    const { requested } = serve({ "/": "/dashboard" });

    await router.prefetch("/");

    expect(requested()).toEqual(["/"]);
    expect(warnings).not.toHaveBeenCalled();
    expect(rendered).toEqual([]);
    expect(window.location.pathname).toBe("/settings");

    // Navigation asks the server again: redirects depend on request state.
    await router.navigate("/");
    expect(requested()).toEqual(["/", "/", "/dashboard"]);
    expect(window.location.pathname).toBe("/dashboard");
  });

  it("supersedes the plugin navigation instead of reporting an error", async () => {
    const { router } = createRouter();
    serve({ "/": "/dashboard" });
    const calls: string[] = [];
    let sequence = 0;
    router.setClientPluginManager({
      async beginNavigation(input: { to: URL | string }) {
        calls.push(`before:${new URL(String(input.to)).pathname}`);
        return { id: String(++sequence), signal: new AbortController().signal };
      },
      async markNavigationLoaded() {
        calls.push("loaded");
      },
      async resolveNavigation() {
        calls.push("resolved");
      },
      scheduleNavigationRendered: () => Promise.resolve(),
      async failNavigation() {
        calls.push("error");
      },
      cancelNavigation(_session: unknown, reason: unknown) {
        calls.push(`cancel:${String(reason)}`);
      },
    } as unknown as FarmClientPluginManager);

    await router.navigate("/");

    expect(calls).toEqual([
      "before:/",
      "cancel:superseded",
      "before:/dashboard",
      "loaded",
      "resolved",
    ]);
  });

  it("runs blockers once for the navigation, not for each redirect", async () => {
    const { router } = createRouter();
    serve({ "/": "/dashboard" });
    const blocker = vi.fn(() => false);
    router.addBlocker(blocker);

    await router.navigate("/");

    expect(blocker).toHaveBeenCalledExactlyOnceWith({
      from: "/settings",
      to: "/",
      action: "push",
    });
    expect(window.location.pathname).toBe("/dashboard");
  });
});
