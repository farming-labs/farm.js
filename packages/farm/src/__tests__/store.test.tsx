/**
 * @vitest-environment jsdom
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createStore } from "../store";

describe("createStore", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot> | undefined;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    (globalThis as any).window = globalThis;
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
    }

    container.remove();
    root = undefined;
    delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
  });

  it("supports whole-store methods, direct field accessors, and direct custom methods", () => {
    const store = createStore(
      {
        theme: "light" as "light" | "dark",
        sidebar: false,
        count: 0,
      },
      (app) => ({
        toggleSidebar() {
          app.sidebar.set((value) => !value);
        },
        bump() {
          app.count.set((value) => value + 1);
        },
      }),
    );

    expect(store.get()).toEqual({
      theme: "light",
      sidebar: false,
      count: 0,
    });
    expect(store.theme.get()).toBe("light");
    expect(store.get("sidebar")).toBe(false);

    expect(store.set("theme", "dark")).toBe("dark");
    expect(store.theme.get()).toBe("dark");

    store.set({ sidebar: true });
    expect(store.sidebar.get()).toBe(true);

    store.bump();
    expect(store.count.get()).toBe(1);

    store.toggleSidebar();
    expect(store.sidebar.get()).toBe(false);

    store.reset();
    expect(store.get()).toEqual({
      theme: "light",
      sidebar: false,
      count: 0,
    });
  });

  it("notifies only the subscribers whose keys changed", () => {
    const store = createStore({
      theme: "light" as "light" | "dark",
      sidebar: false,
      count: 0,
    });

    const rootListener = [] as number[];
    const sidebarListener = [] as boolean[];
    const pairListener = [] as string[];

    const unsubscribeRoot = store.subscribe(() => {
      rootListener.push(1);
    });
    const unsubscribeSidebar = store.sidebar.subscribe((value) => {
      sidebarListener.push(value);
    });
    const unsubscribePair = store.subscribe(["theme", "sidebar"], (value) => {
      pairListener.push(`${value.theme}:${String(value.sidebar)}`);
    });

    store.count.set((value) => value + 1);
    store.sidebar.set(true);
    store.theme.set("dark");

    unsubscribeRoot();
    unsubscribeSidebar();
    unsubscribePair();

    expect(rootListener).toHaveLength(3);
    expect(sidebarListener).toEqual([true]);
    expect(pairListener).toEqual(["light:true", "dark:true"]);
  });

  it("rerenders only components subscribed to the changed keys", () => {
    const store = createStore({
      theme: "light" as "light" | "dark",
      sidebar: false,
    });

    const renderCounts = {
      whole: 0,
      theme: 0,
      sidebar: 0,
      pair: 0,
    };

    function WholeState() {
      const state = store.use();
      renderCounts.whole += 1;
      return createElement(
        "div",
        { "data-testid": "whole" },
        `${state.theme}:${String(state.sidebar)}:${renderCounts.whole}`,
      );
    }

    function ThemeState() {
      const theme = store.theme();
      renderCounts.theme += 1;
      return createElement("div", { "data-testid": "theme" }, `${theme}:${renderCounts.theme}`);
    }

    function SidebarState() {
      const sidebar = store.sidebar();
      renderCounts.sidebar += 1;
      return createElement(
        "div",
        { "data-testid": "sidebar" },
        `${String(sidebar)}:${renderCounts.sidebar}`,
      );
    }

    function PairState() {
      const pair = store.use(["theme", "sidebar"]);
      renderCounts.pair += 1;
      return createElement(
        "div",
        { "data-testid": "pair" },
        `${pair.theme}:${String(pair.sidebar)}:${renderCounts.pair}`,
      );
    }

    function App() {
      return createElement(
        "div",
        null,
        createElement(WholeState),
        createElement(ThemeState),
        createElement(SidebarState),
        createElement(PairState),
      );
    }

    root = createRoot(container);
    act(() => {
      root?.render(createElement(App));
    });

    const initialCounts = { ...renderCounts };

    act(() => {
      store.sidebar.set(true);
    });

    expect(renderCounts.whole).toBe(initialCounts.whole + 1);
    expect(renderCounts.sidebar).toBe(initialCounts.sidebar + 1);
    expect(renderCounts.pair).toBe(initialCounts.pair + 1);
    expect(renderCounts.theme).toBe(initialCounts.theme);

    const afterSidebarCounts = { ...renderCounts };

    act(() => {
      store.theme.set("dark");
    });

    expect(renderCounts.whole).toBe(afterSidebarCounts.whole + 1);
    expect(renderCounts.theme).toBe(afterSidebarCounts.theme + 1);
    expect(renderCounts.pair).toBe(afterSidebarCounts.pair + 1);
    expect(renderCounts.sidebar).toBe(afterSidebarCounts.sidebar);
  });
});
