/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SPARouter,
  type FarmClientNavigationSession,
  type FarmClientPluginManager,
} from "../client";

describe("SPA router client plugin lifecycle", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("emits loaded, resolved, and rendered around a successful navigation", async () => {
    window.history.replaceState({}, "", "/from");
    const calls: string[] = [];
    const session = {
      id: "navigation:1",
      from: null,
      to: {
        href: "http://localhost:3000/to",
        pathname: "/to",
        search: "",
        hash: "",
      },
      action: "push",
      signal: new AbortController().signal,
      startedAt: 0,
    } satisfies FarmClientNavigationSession;
    const lifecycle = {
      async beginNavigation() {
        calls.push("before");
        return session;
      },
      async markNavigationLoaded(_session: FarmClientNavigationSession, data: unknown) {
        calls.push(`loaded:${(data as { modulePath: string }).modulePath}`);
      },
      async resolveNavigation() {
        calls.push("resolved");
      },
      scheduleNavigationRendered() {
        calls.push("rendered");
        return Promise.resolve();
      },
      async failNavigation() {
        calls.push("error");
      },
    } as unknown as FarmClientPluginManager;

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            props: {},
            modulePath: "/src/app/to/page.tsx",
            isClientComponent: true,
          }),
          { headers: { "content-type": "application/json" } },
        ),
      ),
    );

    const router = new SPARouter({ scrollRestoration: false });
    router.setClientPluginManager(lifecycle);
    router.setNavigationHandler(async () => {
      calls.push("render");
    });

    await router.navigate("/to", { scroll: false });

    expect(calls).toEqual([
      "before",
      "loaded:/src/app/to/page.tsx",
      "render",
      "resolved",
      "rendered",
    ]);
    expect(window.location.pathname).toBe("/to");
  });
});
