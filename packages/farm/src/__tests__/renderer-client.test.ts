// @vitest-environment jsdom

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

describe("renderer-neutral client primitives", () => {
  beforeEach(() => {
    getFarmClientDataCache().clear();
    window.history.replaceState(null, "", "/products/42?tab=details");
  });

  afterEach(() => {
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
});
