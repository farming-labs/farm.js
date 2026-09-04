/**
 * @vitest-environment jsdom
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSearchParams } from "../navigation";
import { pushState as pushFarmPageState, readPageState, SPARouter } from "../client/spa-router";
import { usePageState } from "../client/router";
import { FARM_HISTORY_CHANGE_EVENT, notifyHistoryChange } from "../client/history-sync";
import {
  asArrayOf,
  asJson,
  asString,
  createParser,
  useQueryState,
  useQueryStates,
} from "../query/client";

describe("useQueryState shallow routing", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot> | undefined;
  let spaRouter: SPARouter | undefined;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    window.history.replaceState(null, "", "/");
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
    spaRouter?.destroy();
    spaRouter = undefined;
    delete (window as any).__FARM_SPA_ROUTER__;
    vi.restoreAllMocks();
    vi.useRealTimers();
    delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
  });

  it("dispatches synthetic popstate when shallow is true and no Farm router is installed", async () => {
    vi.useFakeTimers();
    const popstate = vi.fn();
    window.addEventListener("popstate", popstate);

    let setUrl!: (value: string | null) => void;

    function App() {
      const [, set] = useQueryState("url", asString);
      setUrl = set;
      return null;
    }

    root = createRoot(container);
    act(() => {
      root?.render(createElement(App));
    });

    act(() => {
      setUrl("https://example.com");
    });

    act(() => {
      vi.runAllTimers();
    });

    expect(window.location.search).toBe("?url=https%3A%2F%2Fexample.com");
    expect(popstate).toHaveBeenCalledTimes(1);
  });

  it("does not dispatch synthetic popstate when shallow is false", async () => {
    vi.useFakeTimers();
    const popstate = vi.fn();
    window.addEventListener("popstate", popstate);

    let setUrl!: (value: string | null) => void;

    function App() {
      const [, set] = useQueryState("url", asString, { shallow: false });
      setUrl = set;
      return null;
    }

    root = createRoot(container);
    act(() => {
      root?.render(createElement(App));
    });

    act(() => {
      setUrl("https://example.com");
    });

    act(() => {
      vi.runAllTimers();
    });

    expect(window.location.search).toBe("?url=https%3A%2F%2Fexample.com");
    expect(popstate).not.toHaveBeenCalled();
  });

  it("reads every repeated value through useQueryState", () => {
    window.history.replaceState(null, "", "/?tag=react&tag=vite");
    let value: string[] | null = null;

    function App() {
      [value] = useQueryState("tag", asArrayOf(asString));
      return null;
    }

    root = createRoot(container);
    act(() => {
      root?.render(createElement(App));
    });

    expect(value).toEqual(["react", "vite"]);
  });

  it("reads every repeated value through useQueryStates", () => {
    window.history.replaceState(null, "", "/?tag=react&tag=vite");
    let value: string[] | null = null;

    function App() {
      const [state] = useQueryStates({ tag: asArrayOf(asString) });
      value = state.tag;
      return null;
    }

    root = createRoot(container);
    act(() => {
      root?.render(createElement(App));
    });

    expect(value).toEqual(["react", "vite"]);
  });

  it("does not trigger SPA navigation when shallow is true and Farm router is installed", async () => {
    vi.useFakeTimers();
    const popstate = vi.fn();
    const historyChange = vi.fn();
    window.addEventListener("popstate", popstate);
    window.addEventListener(FARM_HISTORY_CHANGE_EVENT, historyChange);

    const fetchPage = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            props: {},
            modulePath: "/src/app/page.tsx",
            metadata: { title: "Next" },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchPage);

    spaRouter = new SPARouter({ scrollRestoration: false });
    const onNavigate = vi.fn();
    spaRouter.setNavigationHandler(onNavigate);
    (window as any).__FARM_SPA_ROUTER__ = spaRouter;

    let setUrl!: (value: string | null) => void;

    function App() {
      const [, set] = useQueryState("url", asString);
      setUrl = set;
      return null;
    }

    root = createRoot(container);
    act(() => {
      root?.render(createElement(App));
    });

    act(() => {
      setUrl("https://example.com");
    });

    await act(async () => {
      vi.runAllTimers();
      await Promise.resolve();
    });

    expect(window.location.search).toBe("?url=https%3A%2F%2Fexample.com");
    expect(fetchPage).not.toHaveBeenCalled();
    expect(onNavigate).not.toHaveBeenCalled();
    expect(popstate).not.toHaveBeenCalled();
    expect(historyChange).toHaveBeenCalledTimes(1);
  });

  it("keeps sibling useQueryState hooks in sync via emitter when Farm router is installed", async () => {
    vi.useFakeTimers();
    spaRouter = new SPARouter({ scrollRestoration: false });
    (window as any).__FARM_SPA_ROUTER__ = spaRouter;

    let primaryValue: string | null = null;
    let secondaryValue: string | null = null;
    let setUrl!: (value: string | null) => void;

    function App() {
      const [value, set] = useQueryState("url", asString);
      const [mirror] = useQueryState("url", asString);
      primaryValue = value;
      secondaryValue = mirror;
      setUrl = set;
      return null;
    }

    root = createRoot(container);
    act(() => {
      root?.render(createElement(App));
    });

    act(() => {
      setUrl("https://example.com");
    });

    act(() => {
      vi.runAllTimers();
    });

    expect(primaryValue).toBe("https://example.com");
    expect(secondaryValue).toBe("https://example.com");
  });

  it("keeps useSearchParams in sync when Farm router is installed", async () => {
    vi.useFakeTimers();
    spaRouter = new SPARouter({ scrollRestoration: false });
    (window as any).__FARM_SPA_ROUTER__ = spaRouter;

    let searchParams: URLSearchParams | undefined;
    let setUrl!: (value: string | null) => void;

    function App() {
      const [, set] = useQueryState("url", asString);
      searchParams = useSearchParams();
      setUrl = set;
      return null;
    }

    root = createRoot(container);
    act(() => {
      root?.render(createElement(App));
    });

    act(() => {
      setUrl("https://example.com");
    });

    act(() => {
      vi.runAllTimers();
    });

    expect(searchParams?.get("url")).toBe("https://example.com");
  });

  it("covers useQueryStates with the same URL sync path", async () => {
    vi.useFakeTimers();
    const historyChange = vi.fn();
    window.addEventListener(FARM_HISTORY_CHANGE_EVENT, historyChange);

    spaRouter = new SPARouter({ scrollRestoration: false });
    (window as any).__FARM_SPA_ROUTER__ = spaRouter;

    let setValues!: (updates: { q?: string | null }) => void;

    function App() {
      const [, set] = useQueryStates({ q: asString });
      setValues = set;
      return null;
    }

    root = createRoot(container);
    act(() => {
      root?.render(createElement(App));
    });

    act(() => {
      setValues({ q: "farm" });
    });

    act(() => {
      vi.runAllTimers();
    });

    expect(window.location.search).toBe("?q=farm");
    expect(historyChange).toHaveBeenCalledTimes(1);
  });

  it("reads the current URL when a useQueryState key changes", () => {
    window.history.replaceState(null, "", "/?first=one&second=two");
    let value: string | null = null;

    function App({ queryKey }: { queryKey: string }) {
      [value] = useQueryState(queryKey, asString);
      return null;
    }

    root = createRoot(container);
    act(() => {
      root?.render(createElement(App, { queryKey: "first" }));
    });
    expect(value).toBe("one");

    act(() => {
      root?.render(createElement(App, { queryKey: "second" }));
    });
    expect(value).toBe("two");
  });

  it("replaces useQueryStates output when its parser keys change", () => {
    window.history.replaceState(null, "", "/?first=one&second=two");
    let value: Record<string, string | null> = {};

    function App({ queryKey }: { queryKey: "first" | "second" }) {
      [value] = useQueryStates({ [queryKey]: asString });
      return null;
    }

    root = createRoot(container);
    act(() => {
      root?.render(createElement(App, { queryKey: "first" }));
    });
    expect(value).toEqual({ first: "one" });

    act(() => {
      root?.render(createElement(App, { queryKey: "second" }));
    });
    expect(value).toEqual({ second: "two" });
  });

  it("does not loop when useQueryState receives an inline parser returning objects", () => {
    window.history.replaceState(null, "", '/?filters={"status":"open"}');
    let renders = 0;

    function App() {
      renders += 1;
      useQueryState("filters", asJson<{ status: string }>());
      return null;
    }

    root = createRoot(container);
    act(() => {
      root?.render(createElement(App));
    });

    expect(renders).toBe(1);
  });

  it("does not loop when useQueryStates receives an inline parser map", () => {
    window.history.replaceState(null, "", '/?filters={"status":"open"}');
    let renders = 0;

    function App() {
      renders += 1;
      useQueryStates({ filters: asJson<{ status: string }>() });
      return null;
    }

    root = createRoot(container);
    act(() => {
      root?.render(createElement(App));
    });

    expect(renders).toBe(1);
  });

  it("compares self-referential array values without recursing forever", () => {
    type CyclicValue = Array<string | CyclicValue>;
    const parser = createParser({
      parse: (value): CyclicValue => {
        const parsed: CyclicValue = [value];
        parsed.push(parsed);
        return parsed;
      },
      serialize: (value) => String(value[0]),
    });
    let renders = 0;

    function App() {
      renders += 1;
      useQueryState("value", parser);
      return null;
    }

    window.history.replaceState(null, "", "/?value=one");
    root = createRoot(container);
    act(() => {
      root?.render(createElement(App));
    });
    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate"));
    });

    expect(renders).toBe(1);
  });

  it("resynchronizes primitive state when a default changes its serialized value", () => {
    vi.useFakeTimers();
    let value: string | null = null;
    let setValue!: (next: string | null) => void;

    function App() {
      [value, setValue] = useQueryState("q", asString.withDefault!("fallback"));
      return null;
    }

    root = createRoot(container);
    act(() => {
      root?.render(createElement(App));
    });
    act(() => {
      setValue("");
      vi.runAllTimers();
    });

    expect(window.location.search).toBe("?q=fallback");
    expect(value).toBe("fallback");
  });

  it("replaces object state when the useQueryState key changes", () => {
    window.history.replaceState(null, "", '/?first={"id":1}&second={"id":1}');
    const parser = asJson<{ id: number }>();
    let value: { id: number } | null = null;

    function App({ queryKey }: { queryKey: "first" | "second" }) {
      [value] = useQueryState(queryKey, parser);
      return null;
    }

    root = createRoot(container);
    act(() => {
      root?.render(createElement(App, { queryKey: "first" }));
    });
    const firstValue = value;
    act(() => {
      root?.render(createElement(App, { queryKey: "second" }));
    });

    expect(value).toEqual({ id: 1 });
    expect(value).not.toBe(firstValue);
  });

  it("replaces useQueryStates values when parser-visible hidden state changes", () => {
    window.history.replaceState(null, "", "/?item=one");
    type ParsedItem = { value: string; mode: string };
    const parseItem = (value: string, mode: string): ParsedItem => {
      const item = { value } as ParsedItem;
      Object.defineProperty(item, "mode", { value: mode, configurable: true });
      return item;
    };
    const oldParser = createParser({
      parse: (value) => parseItem(value, "old"),
      serialize: (value) => `${value.value}:${value.mode}`,
    });
    const nextParser = createParser({
      parse: (value) => parseItem(value, "next"),
      serialize: (value) => `${value.value}:${value.mode}`,
    });
    let values: { item: ParsedItem | null } = { item: null };

    function App({ parser }: { parser: typeof oldParser }) {
      [values] = useQueryStates({ item: parser });
      return null;
    }

    root = createRoot(container);
    act(() => {
      root?.render(createElement(App, { parser: oldParser }));
    });
    const oldValue = values.item;
    expect(oldValue?.mode).toBe("old");

    act(() => {
      root?.render(createElement(App, { parser: nextParser }));
    });
    expect(values.item?.mode).toBe("next");
    expect(values.item).not.toBe(oldValue);
  });

  it("composes throttled updates for different query keys", () => {
    vi.useFakeTimers();

    let setQuery!: (value: string | null) => void;
    let setPage!: (value: string | null) => void;

    function App() {
      const [, updateQuery] = useQueryState("q", asString, { throttleMs: 50 });
      const [, updatePage] = useQueryState("page", asString, { throttleMs: 50 });
      setQuery = updateQuery;
      setPage = updatePage;
      return null;
    }

    root = createRoot(container);
    act(() => {
      root?.render(createElement(App));
    });

    act(() => {
      setQuery("farm");
      setPage("2");
      vi.runAllTimers();
    });

    expect(window.location.search).toBe("?q=farm&page=2");
  });

  it("cancels a throttled update when the value returns to the current URL", () => {
    vi.useFakeTimers();
    window.history.replaceState(null, "", "/?q=old");

    let setQuery!: (value: string | null) => void;

    function App() {
      const [, updateQuery] = useQueryState("q", asString, { throttleMs: 50 });
      setQuery = updateQuery;
      return null;
    }

    root = createRoot(container);
    act(() => {
      root?.render(createElement(App));
    });

    act(() => {
      setQuery("new");
      setQuery("old");
      vi.runAllTimers();
    });

    expect(window.location.search).toBe("?q=old");
  });

  it("preserves Farm page history state when updating query params", async () => {
    vi.useFakeTimers();
    spaRouter = new SPARouter({ scrollRestoration: false });
    (window as any).__FARM_SPA_ROUTER__ = spaRouter;

    pushFarmPageState({ modal: "open" });
    expect(readPageState()).toEqual({ modal: "open" });

    let setUrl!: (value: string | null) => void;
    let pageState: { modal: string } | null = null;

    function App() {
      const [, set] = useQueryState("url", asString);
      pageState = usePageState<{ modal: string }>();
      setUrl = set;
      return null;
    }

    root = createRoot(container);
    act(() => {
      root?.render(createElement(App));
    });

    act(() => {
      setUrl("https://example.com");
    });

    act(() => {
      vi.runAllTimers();
    });

    expect(window.location.search).toBe("?url=https%3A%2F%2Fexample.com");
    expect(readPageState()).toEqual({ modal: "open" });
    expect(pageState).toEqual({ modal: "open" });
    expect((window.history.state as { path?: string }).path).toBe(
      "/?url=https%3A%2F%2Fexample.com",
    );
  });

  it("does not leak SPA router popstate listeners across tests", async () => {
    vi.useFakeTimers();
    spaRouter = new SPARouter({ scrollRestoration: false });
    (window as any).__FARM_SPA_ROUTER__ = spaRouter;

    const fetchPage = vi.fn(
      async () =>
        new Response(JSON.stringify({ props: {}, modulePath: "/page.tsx" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchPage);

    notifyHistoryChange("url-search");
    act(() => {
      vi.runAllTimers();
    });

    spaRouter.destroy();
    spaRouter = undefined;
    delete (window as any).__FARM_SPA_ROUTER__;

    fetchPage.mockClear();
    window.dispatchEvent(new PopStateEvent("popstate"));
    await Promise.resolve();

    expect(fetchPage).not.toHaveBeenCalled();
  });
});
