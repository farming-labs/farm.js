// @vitest-environment jsdom
import { act, createElement, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { asInteger, asString, useQueryState, useQueryStates } from "../query/client";

let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  window.history.replaceState(null, "", "/?q=original");
  root = createRoot(document.createElement("div"));
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
  delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
});

it.each([0, 50])(
  "keeps the newer writer with throttleMs=%s when the older owner unmounts",
  async (throttleMs) => {
    const setters: Array<(value: string | null) => void> = [];
    const values: Array<string | null> = [];
    function Consumer({ index }: { index: number }) {
      [values[index], setters[index]] = useQueryState("q", asString.withDefault!(""), {
        throttleMs: index === 0 ? 200 : throttleMs,
      });
      return null;
    }
    const render = (old: boolean) =>
      root.render(
        createElement(
          StrictMode,
          null,
          old && createElement(Consumer, { index: 0, key: "old" }),
          createElement(Consumer, { index: 1, key: "new" }),
        ),
      );
    await act(async () => render(true));
    await act(async () => setters[0]("old"));
    await act(async () => {
      vi.advanceTimersByTime(20);
    });
    await act(async () => setters[1]("new"));
    await act(async () => {
      vi.advanceTimersByTime(60);
    });
    expect(window.location.search).toBe("?q=new");
    expect(values).toEqual(["new", "new"]);
    // Test the late old timer first, then the stale owner's cleanup handle.
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    expect(window.location.search).toBe("?q=new");
    await act(async () => setters[1]("latest"));
    await act(async () => render(false));
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    expect(window.location.search).toBe("?q=latest");
  },
);

it.each(["new", "original", null])(
  "preserves unrelated batch keys when a newer writer sets q=%s",
  async (latest) => {
    let batch!: (updates: { q?: string; page?: number }) => void;
    let single!: (q: string | null) => void;
    let state!: { q: string | null; page: number | null };
    function View() {
      [state, batch] = useQueryStates({ q: asString, page: asInteger }, { throttleMs: 200 });
      [, single] = useQueryState("q", asString, { throttleMs: 50 });
      return null;
    }
    await act(async () => root.render(createElement(View)));
    await act(async () => batch({ q: "old", page: 2 }));
    await act(async () => {
      vi.advanceTimersByTime(20);
    });
    await act(async () => single(latest));
    await act(async () => {
      vi.advanceTimersByTime(50);
    });
    expect(new URLSearchParams(window.location.search).get("q")).toBe(latest);
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    expect(new URLSearchParams(window.location.search).get("q")).toBe(latest);
    expect(new URLSearchParams(window.location.search).get("page")).toBe("2");
    expect(state).toEqual({ q: latest, page: 2 });
  },
);

it("does not resurrect a superseded batch value when the newer owner cancels", async () => {
  let batch!: (updates: { q?: string; page?: number }) => void;
  let single!: (q: string) => void;
  function Batch() {
    [, batch] = useQueryStates({ q: asString, page: asInteger }, { throttleMs: 200 });
    return null;
  }
  function Single() {
    [, single] = useQueryState("q", asString, { throttleMs: 100 });
    return null;
  }
  const render = (both: boolean) =>
    root.render(createElement("div", null, createElement(Batch), both && createElement(Single)));
  await act(async () => render(true));
  await act(async () => batch({ q: "old", page: 2 }));
  await act(async () => single("cancelled"));
  await act(async () => render(false));
  await act(async () => {
    vi.advanceTimersByTime(300);
  });
  expect(window.location.search).toBe("?q=original&page=2");
});

it("keeps disjoint queued keys and overlapping writes from one multi-key hook", async () => {
  let set!: (updates: { q?: string; page?: number; sort?: string }) => void;
  function View() {
    [, set] = useQueryStates({ q: asString, page: asInteger, sort: asString }, { throttleMs: 100 });
    return null;
  }
  await act(async () => root.render(createElement(View)));
  await act(async () => set({ q: "old", page: 2 }));
  await act(async () => {
    vi.advanceTimersByTime(20);
  });
  await act(async () => set({ q: "new" }));
  await act(async () => set({ sort: "date" }));
  await act(async () => {
    vi.advanceTimersByTime(80);
  });
  expect(window.location.search).toBe("?q=original&page=2");
  await act(async () => {
    vi.advanceTimersByTime(20);
  });
  expect(window.location.search).toBe("?q=new&page=2&sort=date");
});
