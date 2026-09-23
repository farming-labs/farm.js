// @vitest-environment jsdom
import { act, createElement, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { asString, asInteger, useQueryState, useQueryStates } from "../query/client";

let root: ReturnType<typeof createRoot> | undefined;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  window.history.replaceState(null, "", "/");
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  vi.useRealTimers();
  delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
});

it.each(["single", "multiple"] as const)(
  "keeps %s inline parsers responsive throughout typing and parent renders",
  async (kind) => {
    let value!: string | null;
    let update!: (value: string) => void;
    function SingleView() {
      const [q, setQ] = useQueryState("q", asString.withDefault!(""), { throttleMs: 150 });
      value = q;
      update = setQ;
      return createElement("input", { value: value ?? "", readOnly: true });
    }
    function MultipleView() {
      const [state, set] = useQueryStates({ q: asString.withDefault!("") }, { throttleMs: 150 });
      value = state.q;
      update = (q) => set({ q });
      return createElement("input", { value: value ?? "", readOnly: true });
    }
    const container = document.createElement("div");
    root = createRoot(container);
    const render = () =>
      root!.render(
        createElement(
          StrictMode,
          null,
          createElement(kind === "single" ? SingleView : MultipleView),
        ),
      );
    await act(async () => render());
    for (const q of ["f", "fa", "far", "farm"]) {
      await act(async () => update(q));
      await act(async () => render());
      expect(value).toBe(q);
      expect(container.querySelector("input")!.value).toBe(q);
      expect(window.location.search).toBe("");
      await act(async () => {
        vi.advanceTimersByTime(20);
      });
    }
    await act(async () => {
      vi.advanceTimersByTime(150);
    });
    expect(value).toBe("farm");
    expect(window.location.search).toBe("?q=farm");
  },
);

it("keeps staggered multi-key drafts visible when another key commits", async () => {
  let state!: { q: string | null; page: number | null };
  let set!: (updates: { q?: string; page?: number }) => void;
  function View() {
    [state, set] = useQueryStates({ q: asString, page: asInteger }, { throttleMs: 100 });
    return null;
  }
  root = createRoot(document.createElement("div"));
  await act(async () => root!.render(createElement(View)));
  await act(async () => set({ q: "farm" }));
  await act(async () => {
    vi.advanceTimersByTime(50);
  });
  await act(async () => set({ page: 2 }));
  expect(state).toEqual({ q: "farm", page: 2 });
  await act(async () => {
    vi.advanceTimersByTime(50);
  });
  expect(window.location.search).toBe("?q=farm");
  expect(state).toEqual({ q: "farm", page: 2 });
  await act(async () => {
    vi.advanceTimersByTime(50);
  });
  expect(window.location.search).toBe("?q=farm&page=2");
  expect(state).toEqual({ q: "farm", page: 2 });
});

it("shares pending values with other inline consumers without transferring cleanup ownership", async () => {
  let update!: (q: string) => void;
  const values: (string | null)[] = [];
  function View({ index }: { index: number }) {
    const [q, set] = useQueryState("q", asString.withDefault!(""), { throttleMs: 100 });
    values[index] = q;
    if (index === 0) update = set;
    return null;
  }
  root = createRoot(document.createElement("div"));
  const render = (both: boolean) =>
    root!.render(
      createElement(
        "div",
        null,
        createElement(View, { index: 0 }),
        both && createElement(View, { index: 1 }),
      ),
    );
  await act(async () => render(true));
  await act(async () => update("farm"));
  expect(values).toEqual(["farm", "farm"]);
  await act(async () => render(false));
  await act(async () => {
    vi.advanceTimersByTime(100);
  });
  expect(window.location.search).toBe("?q=farm");
});

it("reparses queued serialized values when a parser changes and forgets them after commit", async () => {
  let value!: string | number | null;
  let update!: (q: string) => void;
  function View({ numeric }: { numeric: boolean }) {
    const parser = {
      parse: (input: string) => (numeric ? asInteger.parse(input) : asString.parse(input)),
      serialize: (input: string | number) => String(input),
    };
    const [q, set] = useQueryState("q", parser, { throttleMs: 100 });
    value = q;
    update = set;
    return null;
  }
  root = createRoot(document.createElement("div"));
  await act(async () => root!.render(createElement(View, { numeric: false })));
  await act(async () => update("42"));
  await act(async () => root!.render(createElement(View, { numeric: true })));
  expect(value).toBe(42);
  await act(async () => {
    vi.advanceTimersByTime(100);
  });
  await act(async () => {
    window.history.replaceState(null, "", "/?q=7");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  expect(value).toBe(7);
});

it("does not overlay queued drafts on a different history location", async () => {
  let value!: string | null;
  let update!: (q: string) => void;
  function View() {
    [value, update] = useQueryState("q", asString.withDefault!(""), { throttleMs: 100 });
    return null;
  }
  root = createRoot(document.createElement("div"));
  await act(async () => root!.render(createElement(View)));
  await act(async () => update("draft"));
  await act(async () => {
    window.history.replaceState(null, "", "/other?q=actual");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await act(async () => root!.render(createElement(View)));
  expect(value).toBe("actual");
  await act(async () => root!.unmount());
  root = undefined;
  await act(async () => {
    vi.advanceTimersByTime(100);
  });
  expect(window.location.pathname + window.location.search).toBe("/other?q=actual");
});

it("clears an inline-parser draft when its value returns to the URL", async () => {
  window.history.replaceState(null, "", "/?q=original");
  let value!: string | null;
  let update!: (q: string) => void;
  function View() {
    [value, update] = useQueryState("q", asString.withDefault!(""), { throttleMs: 100 });
    return null;
  }
  root = createRoot(document.createElement("div"));
  await act(async () => root!.render(createElement(View)));
  await act(async () => update("draft"));
  expect(value).toBe("draft");
  await act(async () => update("original"));
  await act(async () => root!.render(createElement(View)));
  expect(value).toBe("original");
  await act(async () => {
    vi.advanceTimersByTime(100);
  });
  expect(window.location.search).toBe("?q=original");
});
