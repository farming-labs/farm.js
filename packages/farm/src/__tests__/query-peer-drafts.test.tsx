/** @vitest-environment jsdom */
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

it.each([0, 100])("shares alternating edits immediately with throttleMs=%s", async (throttleMs) => {
  const values: Array<string | null> = [];
  const setters: Array<(value: string | null) => void> = [];
  function View() {
    [values[0], setters[0]] = useQueryState("q", asString, { throttleMs, shallow: false });
    [values[1], setters[1]] = useQueryState("q", asString, { throttleMs, shallow: false });
    return null;
  }
  await act(async () => root.render(createElement(StrictMode, null, createElement(View))));
  await act(async () => {
    setters[0]("first");
    setters[1]("latest");
  });
  expect(values).toEqual(["latest", "latest"]);
  if (throttleMs) expect(window.location.search).toBe("?q=original");
  await act(async () => setters[0]("final"));
  expect(values).toEqual(["final", "final"]);
  await act(async () => {
    vi.advanceTimersByTime(100);
  });
  expect(values).toEqual(["final", "final"]);
  expect(window.location.search).toBe("?q=final");
});

it("uses each writer's parser on a peer edit without waiting for the URL", async () => {
  let text: string | null = null;
  let number: number | null = null;
  let setText!: (value: string | null) => void;
  let setNumber!: (value: number | null) => void;
  const numberParser = asInteger.withDefault!(7);
  function View() {
    [text, setText] = useQueryState("q", asString, { throttleMs: 100 });
    [number, setNumber] = useQueryState("q", numberParser, { throttleMs: 100 });
    return null;
  }
  await act(async () => root.render(createElement(View)));
  await act(async () => {
    setText("1");
    setNumber(42);
  });
  expect(text).toBe("42");
  expect(number).toBe(42);
  await act(async () => setText(null));
  expect(text).toBeNull();
  expect(number).toBe(7);
  await act(async () => {
    vi.advanceTimersByTime(100);
  });
  expect(number).toBe(7);
  expect(window.location.search).toBe("");
});

it("receives a multi-key writer's newer edit immediately after its own write", async () => {
  let single: string | null = null;
  let setSingle!: (value: string | null) => void;
  let setBatch!: (value: { q?: string; page?: number }) => void;
  const parsers = { q: asString, page: asInteger };
  function View() {
    [single, setSingle] = useQueryState("q", asString, { throttleMs: 100 });
    [, setBatch] = useQueryStates(parsers, { throttleMs: 100 });
    return null;
  }
  await act(async () => root.render(createElement(View)));
  await act(async () => {
    setSingle("first");
    setBatch({ q: "latest", page: 2 });
  });
  expect(single).toBe("latest");
  expect(window.location.search).toBe("?q=original");
  await act(async () => {
    vi.advanceTimersByTime(100);
  });
  expect(window.location.search).toBe("?q=latest&page=2");
});

it("retains the writer's local value until commit rather than parsing its own echo", async () => {
  let value: string | null = null;
  let set!: (value: string | null) => void;
  const parser = {
    parse: (value: string) => value.toUpperCase(),
    serialize: (value: string) => value,
  };
  function View() {
    [value, set] = useQueryState("q", parser, { throttleMs: 100 });
    return null;
  }
  await act(async () => root.render(createElement(View)));
  await act(async () => set("draft"));
  expect(value).toBe("draft");
  await act(async () => {
    vi.advanceTimersByTime(100);
  });
  expect(value).toBe("DRAFT");
  expect(window.location.search).toBe("?q=draft");
});

it("does not suppress later peer updates after a serializer throws", async () => {
  let value: string | null = null;
  let bad!: (value: string | null) => void;
  let good!: (value: string | null) => void;
  const parser = {
    ...asString,
    serialize: () => {
      throw new Error("cannot serialize");
    },
  };
  function View() {
    [value, bad] = useQueryState("q", parser, { throttleMs: 100 });
    [, good] = useQueryState("q", asString, { throttleMs: 100 });
    return null;
  }
  await act(async () => root.render(createElement(View)));
  await act(async () => {
    expect(() => bad("invalid")).toThrow("cannot serialize");
    good("valid");
  });
  expect(value).toBe("valid");
  await act(async () => {
    vi.advanceTimersByTime(100);
  });
  expect(window.location.search).toBe("?q=valid");
});
