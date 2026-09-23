/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, expect, expectTypeOf, it, vi } from "vitest";
import { createStore } from "../store";

let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
});

it("reads numeric keys and notifies their typed subscribers", async () => {
  const store = createStore({ 0: "first", other: false });
  const seen = vi.fn();
  const unsubscribe = store.subscribe(0, seen);
  let renders = 0;
  function View() {
    const value = store.use(0);
    expectTypeOf(value).toEqualTypeOf<string>();
    renders++;
    return createElement("output", null, value);
  }
  await act(async () => root.render(createElement(View)));
  expect(container.textContent).toBe("first");
  const before = renders;
  await act(async () => {
    store.set("other", true);
  });
  expect(renders).toBe(before);
  await act(async () => {
    store.set(0, "second");
  });
  expect(container.textContent).toBe("second");
  expect(seen).toHaveBeenCalledExactlyOnceWith("second", "first");
  expect(store[0].get()).toBe("second");
  unsubscribe();
});

it("keeps symbol field accessors, selectors and identities distinct", async () => {
  const first = Symbol("selection");
  const second = Symbol("selection");
  const store = createStore({ [first]: "first", [second]: "second" });
  const listener = vi.fn();
  const otherListener = vi.fn();
  const unsubscribe = store[first].subscribe(listener);
  const unsubscribeOther = store.subscribe(second, otherListener);
  function View() {
    const value = store.use(first);
    const other = store[second]();
    expectTypeOf(value).toEqualTypeOf<string>();
    expectTypeOf(other).toEqualTypeOf<string>();
    return createElement("output", null, `${value}:${other}`);
  }
  await act(async () => root.render(createElement(View)));
  await act(async () => {
    store[first].set((value) => `${value}!`);
  });
  expect(container.textContent).toBe("first!:second");
  expect(listener).toHaveBeenCalledExactlyOnceWith("first!", "first");
  expect(otherListener).not.toHaveBeenCalled();
  expect(store.get(first)).toBe("first!");
  unsubscribe();
  unsubscribeOther();
});

it("updates mixed slices only for changed keys, including patch, replace and reset", async () => {
  const symbol = Symbol("count");
  const store = createStore({ 0: "initial", [symbol]: 1, other: false });
  const listener = vi.fn();
  const whole = vi.fn();
  const unsubscribe = store.subscribe([0, symbol, 0], listener);
  const unsubscribeWhole = store.subscribe(whole);
  let renders = 0;
  function View() {
    const slice = store.use([0, symbol]);
    expectTypeOf(slice).toEqualTypeOf<{ 0: string; [symbol]: number }>();
    renders++;
    return createElement("output", null, `${slice[0]}:${slice[symbol]}`);
  }
  await act(async () => root.render(createElement(View)));
  const before = renders;
  await act(async () => {
    store.set({ other: true });
    store.set(symbol, 1);
  });
  expect(renders).toBe(before);
  expect(listener).not.toHaveBeenCalled();
  await act(async () => {
    store.set({ 0: "patched", [symbol]: 2 });
  });
  expect(container.textContent).toBe("patched:2");
  expect(listener).toHaveBeenLastCalledWith(
    { 0: "patched", [symbol]: 2 },
    { 0: "initial", [symbol]: 1 },
  );
  await act(async () => {
    store.replace({ 0: "replaced", [symbol]: 3, other: true });
  });
  expect(container.textContent).toBe("replaced:3");
  await act(async () => {
    store.reset();
  });
  expect(container.textContent).toBe("initial:1");
  expect(listener).toHaveBeenCalledTimes(3);
  expect(whole).toHaveBeenCalledTimes(4);
  unsubscribe();
  unsubscribeWhole();
  await act(async () => {
    store.set(symbol, 4);
  });
  expect(listener).toHaveBeenCalledTimes(3);
  expect(whole).toHaveBeenCalledTimes(4);
});

it("treats numeric keys and their string property names as the same subscription", () => {
  const store = createStore<Record<string | number, string>>({ 0: "initial", 1.5: "fraction" });
  const numeric = vi.fn();
  const string = vi.fn();
  const fraction = vi.fn();
  const unsubscribe = [
    store.subscribe(0, numeric),
    store.subscribe("0", string),
    store.subscribe(1.5, fraction),
  ];
  store.set("0", "changed");
  store.set("1.5", "changed fraction");
  expect(numeric).toHaveBeenCalledExactlyOnceWith("changed", "initial");
  expect(string).toHaveBeenCalledExactlyOnceWith("changed", "initial");
  expect(fraction).toHaveBeenCalledExactlyOnceWith("changed fraction", "fraction");
  unsubscribe.forEach((dispose) => dispose());
});

it("detects removal of a symbol field on replace", () => {
  const key = Symbol("optional");
  const store = createStore<{ [key]?: string }>({ [key]: "initial" });
  const listener = vi.fn();
  const unsubscribe = store.subscribe(key, listener);
  store.replace({});
  expect(listener).toHaveBeenCalledExactlyOnceWith(undefined, "initial");
  store.reset();
  expect(store.get(key)).toBe("initial");
  unsubscribe();
});

it("keeps own-enumerable state semantics and string API-name protection", () => {
  const visible = Symbol("use");
  const hidden = Symbol("hidden");
  const initial = Object.create({ inherited: "ignored" }) as { [visible]: string };
  initial[visible] = "visible";
  Object.defineProperty(initial, hidden, { value: "ignored", enumerable: false });
  const store = createStore(initial);
  expect(Reflect.ownKeys(store.get())).toEqual([visible]);
  expect(store[visible].get()).toBe("visible");
  expect(Object.prototype.hasOwnProperty.call(store, hidden)).toBe(false);
  expect(() => createStore({ use: "reserved" })).toThrow("reserved key");
});

it("uses field snapshots for numeric and symbol selectors during server rendering", () => {
  const key = Symbol("label");
  const store = createStore({ 0: "number", [key]: "symbol" });
  function View() {
    return createElement("output", null, `${store.use(0)}:${store.use(key)}`);
  }
  expect(renderToString(createElement(View))).toBe("<output>number:symbol</output>");
});
