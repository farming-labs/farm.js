/** @vitest-environment jsdom */
import { act, createElement, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, expectTypeOf, it, vi } from "vitest";
import { asInteger, asString, useQueryState, useQueryStates } from "../query/client";

let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  window.history.replaceState(null, "", "/?q=original&page=1");
  root = createRoot(document.createElement("div"));
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
  delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
});

it.each([0, 100])(
  "shares a single writer's draft with a multi-key reader (throttle=%s)",
  async (throttleMs) => {
    let set!: (value: string | null) => void;
    let state!: { q: string | null; page: number | null };
    const parsers = { q: asString, page: asInteger };
    function View() {
      [, set] = useQueryState("q", asString, { throttleMs });
      [state] = useQueryStates(parsers);
      expectTypeOf(state.q).toEqualTypeOf<string | null>();
      expectTypeOf(state.page).toEqualTypeOf<number | null>();
      return null;
    }
    await act(async () => root.render(createElement(StrictMode, null, createElement(View))));
    await act(async () => set("draft"));
    expect(state).toEqual({ q: "draft", page: 1 });
    if (throttleMs) expect(window.location.search).toBe("?q=original&page=1");
    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    expect(state).toEqual({ q: "draft", page: 1 });
  },
);

it("composes rapid overlapping edits across two multi-key writers", async () => {
  const parsers = { q: asString, page: asInteger };
  const states: Array<{ q: string | null; page: number | null }> = [];
  const setters: Array<(value: { q?: string | null; page?: number | null }) => void> = [];
  function View() {
    [states[0], setters[0]] = useQueryStates(parsers, { throttleMs: 100 });
    [states[1], setters[1]] = useQueryStates(parsers, { throttleMs: 100 });
    return null;
  }
  await act(async () => root.render(createElement(View)));
  await act(async () => {
    setters[0]({ q: "first", page: 2 });
    setters[1]({ q: "latest" });
  });
  expect(states).toEqual([
    { q: "latest", page: 2 },
    { q: "latest", page: 2 },
  ]);
  await act(async () => {
    vi.advanceTimersByTime(100);
  });
  expect(window.location.search).toBe("?q=latest&page=2");
});

it.each(["42", "invalid", null])(
  "parses peer edits with each receiver's parser (value=%s)",
  async (value) => {
    let set!: (value: string | null) => void;
    let number!: number | null;
    let custom!: { value: string } | null;
    const parsers = {
      q: asInteger.withDefault!(7),
      page: {
        parse: (value: string) => (value ? { value } : null),
        serialize: (value: { value: string }) => value.value,
      },
    };
    let setPage!: (value: string | null) => void;
    function View() {
      [, set] = useQueryState("q", asString, { throttleMs: 100 });
      [, setPage] = useQueryState("page", asString, { throttleMs: 100 });
      const [state] = useQueryStates(parsers);
      number = state.q;
      custom = state.page;
      return null;
    }
    await act(async () => root.render(createElement(View)));
    await act(async () => {
      set(value);
      setPage("custom");
    });
    expect(number).toBe(value === "42" ? 42 : 7);
    expect(custom).toEqual({ value: "custom" });
  },
);

it("does not parse its own draft echo or overwrite unrelated local fields", async () => {
  const parsers = {
    q: { parse: (value: string) => value.toUpperCase(), serialize: (value: string) => value },
    page: asInteger,
  };
  let state!: { q: string; page: number | null };
  let set!: (value: { q?: string }) => void;
  let setPage!: (value: number | null) => void;
  function View() {
    [state, set] = useQueryStates(parsers, { throttleMs: 100 });
    [, setPage] = useQueryState("page", asInteger, { throttleMs: 100 });
    return null;
  }
  await act(async () => root.render(createElement(View)));
  await act(async () => {
    set({ q: "draft" });
    setPage(2);
  });
  expect(state).toEqual({ q: "draft", page: 2 });
  await act(async () => {
    vi.advanceTimersByTime(100);
  });
  expect(state).toEqual({ q: "DRAFT", page: 2 });
});

it("replaces subscriptions when parser keys change and ignores removed keys", async () => {
  const qParser = { parse: vi.fn(asString.parse), serialize: asString.serialize };
  const pageParser = { parse: vi.fn(asInteger.parse), serialize: asInteger.serialize };
  const qParsers = { q: qParser };
  const pageParsers = { page: pageParser };
  let setQ!: (value: string | null) => void;
  let setPage!: (value: number | null) => void;
  let state: object = {};
  function Writers() {
    [, setQ] = useQueryState("q", asString, { throttleMs: 100 });
    [, setPage] = useQueryState("page", asInteger, { throttleMs: 100 });
    return null;
  }
  function Reader({ page }: { page: boolean }) {
    [state] = useQueryStates(page ? pageParsers : qParsers);
    return null;
  }
  const render = (page: boolean) =>
    root.render(
      createElement(StrictMode, null, createElement(Writers), createElement(Reader, { page })),
    );
  await act(async () => render(false));
  await act(async () => render(true));
  qParser.parse.mockClear();
  pageParser.parse.mockClear();
  await act(async () => setQ("ignored"));
  expect(qParser.parse).not.toHaveBeenCalled();
  expect(state).toEqual({ page: 1 });
  await act(async () => setPage(2));
  expect(pageParser.parse).toHaveBeenCalledExactlyOnceWith("2");
  expect(state).toEqual({ page: 2 });
});

it("unsubscribes receivers without taking ownership of a peer's queued write", async () => {
  let set!: (value: string | null) => void;
  const parser = { parse: vi.fn(asString.parse), serialize: asString.serialize };
  const parsers = { q: parser };
  function Writer() {
    [, set] = useQueryState("q", asString, { throttleMs: 100 });
    return null;
  }
  function Reader() {
    useQueryStates(parsers);
    return null;
  }
  const render = (reader: boolean) =>
    root.render(createElement("div", null, createElement(Writer), reader && createElement(Reader)));
  await act(async () => render(true));
  await act(async () => set("draft"));
  await act(async () => render(false));
  parser.parse.mockClear();
  await act(async () => set("latest"));
  expect(parser.parse).not.toHaveBeenCalled();
  await act(async () => {
    vi.advanceTimersByTime(100);
  });
  expect(window.location.search).toBe("?q=latest&page=1");
  expect(parser.parse).not.toHaveBeenCalled();
});
