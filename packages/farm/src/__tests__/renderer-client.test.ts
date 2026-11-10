// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getFarmClientDataCache } from "../client-cache";
import { _hydrateFarmI18n } from "../i18n/client-runtime";
import {
  createRendererAction,
  createRendererI18n,
  createRendererQuery,
  createRendererRouter,
  createRendererTheme,
} from "../renderer-client";
import type { ServerFn } from "../server-fn";
import type { ServerQuery } from "../server-query";
import { setFarmBasePath } from "../base-path";
import { useRouter } from "../client/router";
import { getRouter } from "../client/spa-router";

describe("renderer-neutral client primitives", () => {
  beforeEach(() => {
    setFarmBasePath("/");
    getFarmClientDataCache().clear();
    window.history.replaceState(null, "", "/products/42?tab=details");
  });

  afterEach(() => {
    setFarmBasePath("/");
    delete window.__FARM_THEME__;
    vi.restoreAllMocks();
  });

  it("publishes the current router location and parameters", () => {
    const router = createRendererRouter({ routes: ["/products/[id]"] });
    const listener = vi.fn();
    const unsubscribe = router.subscribe(listener);

    expect(router.getSnapshot()).toMatchObject({
      pathname: "/products/42",
      params: { id: "42" },
    });

    expect(listener).toHaveBeenCalled();
    unsubscribe();
  });

  it("uses the configured app base path for renderer-neutral routing", async () => {
    setFarmBasePath("/console");
    window.history.replaceState(null, "", "/console/products/42?tab=details");
    const router = createRendererRouter({ routes: ["/products/[id]"] });
    const navigate = vi.spyOn(getRouter(), "navigate").mockResolvedValue();

    expect(router.getSnapshot()).toMatchObject({
      pathname: "/products/42",
      params: { id: "42" },
    });
    await router.push("/orders");
    await router.replace("/console/settings");

    expect(navigate).toHaveBeenNthCalledWith(1, "/console/orders", undefined);
    expect(navigate).toHaveBeenNthCalledWith(2, "/console/settings", { replace: true });
  });

  it("runs typed actions with observable optimistic and settled state", async () => {
    const save = vi.fn(async (input: { name: string }) => ({ id: "1", name: input.name }));
    const action = createRendererAction(
      save as ServerFn<{ name: string }, { id: string; name: string }>,
      {
        initialResult: { id: "0", name: "Initial" },
        optimistic: ({ input }) => ({ id: "pending", name: (input as { name: string }).name }),
      },
    );
    const states: string[] = [];
    const unsubscribe = action.subscribe(() => states.push(action.getSnapshot().status));

    const pending = action.submit({ name: "FARMJS" });
    expect(action.getSnapshot()).toMatchObject({
      pending: true,
      status: "pending",
      data: { id: "pending", name: "FARMJS" },
    });
    await expect(pending).resolves.toEqual({ id: "1", name: "FARMJS" });
    expect(action.getSnapshot()).toMatchObject({ pending: false, status: "success" });
    expect(states).toEqual(["pending", "success"]);
    unsubscribe();
  });

  it("preserves zero-argument server action calls", async () => {
    const ping = vi.fn(async () => "pong") as unknown as ServerFn<unknown, string>;
    const action = createRendererAction(ping);

    await expect(action.submit()).resolves.toBe("pong");
    expect(ping).toHaveBeenCalledWith(undefined);
  });

  it("settles after an older concurrent action finishes last", async () => {
    const resolvers = new Map<number, (value: string) => void>();
    const save = vi.fn(
      (input: number) =>
        new Promise<string>((resolve) => {
          resolvers.set(input, resolve);
        }),
    ) as unknown as ServerFn<number, string>;
    const action = createRendererAction(save);

    const first = action.submit(1);
    const second = action.submit(2);
    resolvers.get(2)?.("second");
    await expect(second).resolves.toBe("second");
    expect(action.getSnapshot()).toMatchObject({
      pending: true,
      status: "pending",
      data: "second",
    });

    resolvers.get(1)?.("first");
    await expect(first).resolves.toBe("first");
    expect(action.getSnapshot()).toMatchObject({
      pending: false,
      status: "success",
      data: "second",
    });
  });

  it("shares query cache state and supports forced refetches", async () => {
    let version = 0;
    const query = (async ({ id }: { id: string }) => ({ id, version: ++version })) as ServerQuery<
      { id: string },
      { id: string; version: number }
    >;
    const observer = createRendererQuery(query, { id: "42" }, { staleTime: 10_000 });
    const updated = new Promise<void>((resolve) => {
      const unsubscribe = observer.subscribe(() => {
        if (observer.getSnapshot().status === "success") {
          unsubscribe();
          resolve();
        }
      });
    });

    await updated;
    expect(observer.getSnapshot().data).toEqual({ id: "42", version: 1 });
    await expect(observer.refetch()).resolves.toEqual({ id: "42", version: 2 });
    observer.dispose();
  });

  it("adapts theme and i18n runtimes as external stores", () => {
    const themeSnapshot = { theme: "dark", resolvedTheme: "dark", mounted: true } as const;
    window.__FARM_THEME__ = {
      config: {
        enabled: true,
        default: "system",
        storageKey: "farm-theme",
        cookiePath: "/",
      },
      serverSnapshot: themeSnapshot,
      snapshot: themeSnapshot,
      setTheme: vi.fn(),
    };
    const theme = createRendererTheme();
    expect(theme.getSnapshot()).toEqual(themeSnapshot);
    theme.setTheme("light");
    expect(window.__FARM_THEME__.setTheme).toHaveBeenCalledWith("light");

    _hydrateFarmI18n({
      locale: "en",
      source: "default",
      locales: ["en", "fr"],
      defaultLocale: "en",
      routing: "prefix-except-default",
      cookie: { name: "farm-locale", path: "/", sameSite: "lax", secure: false },
      direction: "ltr",
      messages: { greeting: "Hello {name}" },
    });
    const i18n = createRendererI18n();
    expect(i18n.getSnapshot()?.locale).toBe("en");
    expect(i18n.t("greeting", { name: "FARMJS" })).toBe("Hello FARMJS");
  });

  it("strips the base path once before the locale when matching params", () => {
    setFarmBasePath("/console");
    _hydrateFarmI18n({
      locale: "de",
      source: "path",
      locales: ["en", "de"],
      defaultLocale: "en",
      routing: "prefix-except-default",
      basePath: "/console",
      cookie: { name: "farm-locale", path: "/", sameSite: "lax", secure: false },
      direction: "ltr",
      messages: {},
    });
    const params = (url: string) => {
      window.history.replaceState(null, "", url);
      return createRendererRouter({ routes: ["/products/[id]"] }).getSnapshot().params;
    };
    expect(params("/console/de/products/42")).toEqual({ id: "42" });
    expect(params("/console/products/42")).toEqual({ id: "42" });
    // The server routes this to `/console/products/42`, not `/products/42`.
    expect(params("/console/console/products/42")).toEqual({});

    // React's useRouter reads params through the same strip.
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const hookParams = (url: string) => {
      window.history.replaceState(null, "", url);
      let read: Record<string, string> | undefined;
      const Probe = () => {
        read = useRouter({ routes: ["/products/[id]"] }).params as Record<string, string>;
        return null;
      };
      const root = createRoot(document.createElement("div"));
      act(() => root.render(createElement(Probe)));
      act(() => root.unmount());
      return read;
    };
    expect(hookParams("/console/de/products/42")).toEqual({ id: "42" });
    expect(hookParams("/console/console/products/42")).toEqual({});
  });
});
