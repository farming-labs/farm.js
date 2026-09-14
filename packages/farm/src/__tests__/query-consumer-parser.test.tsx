// @vitest-environment jsdom
import { act, createElement, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { asInteger, asString, useQueryState, useQueryStates } from "../query/client";

let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  window.history.replaceState(null, "", "/?count=0");
  root = createRoot(document.createElement("div"));
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
  delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
});

it.each([0, 100])(
  "parses another consumer's serialized edit with throttleMs=%s",
  async (throttleMs) => {
    let text: string | null = null;
    let count: number | null = null;
    let setCount!: (value: number | null) => void;
    function View() {
      [text] = useQueryState("count", asString);
      [count, setCount] = useQueryState("count", asInteger, { throttleMs });
      return null;
    }
    await act(async () => root.render(createElement(StrictMode, null, createElement(View))));
    await act(async () => setCount(42));
    expect(text).toBe("42");
    expect(count).toBe(42);
    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    expect(text).toBe("42");
    expect(window.location.search).toBe("?count=42");
  },
);

it.each(["invalid", null])(
  "uses receiver defaults for a multi-key writer's %s value",
  async (value) => {
    let count: number | null = null;
    let set!: (updates: { count?: string | null }) => void;
    const parser = asInteger.withDefault!(7);
    function View() {
      [count] = useQueryState("count", parser);
      [, set] = useQueryStates({ count: asString }, { throttleMs: 100 });
      return null;
    }
    await act(async () => root.render(createElement(View)));
    await act(async () => set({ count: value }));
    expect(count).toBe(7);
    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    expect(count).toBe(7);
  },
);

it("preserves custom parser output and same-parser consumers before the URL commits", async () => {
  let custom: { value: string } | null = null;
  let peer: string | null = null;
  let set!: (value: string | null) => void;
  const parser = {
    parse: (value: string) => (value ? { value } : null),
    serialize: (value: { value: string }) => value.value,
  };
  function View() {
    [custom] = useQueryState("count", parser);
    [peer] = useQueryState("count", asString);
    [, set] = useQueryState("count", asString, { throttleMs: 100 });
    return null;
  }
  await act(async () => root.render(createElement(View)));
  await act(async () => set("next"));
  expect(custom).toEqual({ value: "next" });
  expect(peer).toBe("next");
  await act(async () => {
    vi.advanceTimersByTime(20);
  });
  await act(async () => set(null));
  expect(custom).toBeNull();
  expect(peer).toBeNull();
});
