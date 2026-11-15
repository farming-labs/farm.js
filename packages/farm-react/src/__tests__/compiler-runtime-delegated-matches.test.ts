import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  keyedRowsIdentityFilterOnlyRuntimeFeature,
  type CompilerKeyedRowEvent,
  type CompilerKeyedRowsBlockProps,
} from "../compiler-runtime";

interface Block {
  currentProps: CompilerKeyedRowsBlockProps;
  root: Element;
  mounted: boolean;
  adopt(): boolean;
  dispatchDelegatedEvent(name: string, event: React.SyntheticEvent): void;
}

function harness(name = "onClick") {
  const calls: Array<{ label: string; target: EventTarget | null }> = [];
  let beforeInvoke: (label: string, event: React.SyntheticEvent) => void = () => {};
  const handler =
    (label: string) => (_item: unknown, _index: number, event: React.SyntheticEvent) => {
      calls.push({ label, target: event.currentTarget });
      beforeInvoke(label, event);
    };
  const events: CompilerKeyedRowEvent[] = [
    { name, path: [0], invoke: handler("outer") },
    { name, path: [0, 0], invoke: handler("inner-first") },
    { name, path: [0, 0], invoke: handler("inner-second") },
    { name, path: [1], invoke: handler("unrelated") },
    { name, path: [9], invoke: handler("missing") },
    { name: "onKeyDown", path: [0], invoke: handler("other-event") },
  ];
  const item = { id: "row" };
  const Component = keyedRowsIdentityFilterOnlyRuntimeFeature.create({
    setRoot() {},
    subscribe: () => () => {},
  }).KeyedRows as React.ComponentClass<CompilerKeyedRowsBlockProps>;
  const block = new Component({
    id: 0,
    items: () => [item],
    rowKey: () => item.id,
    events,
    delegateEvents: true,
    bindings: [],
    create: () => ({ kind: "element", tag: "li", attributes: [], styles: [], children: [] }),
    render: () => React.createElement("ul"),
  }) as unknown as Block;
  block.root = document.createElement("ul");
  block.root.innerHTML =
    "<li><div><button><span>click</span></button></div><button>other</button></li>";
  block.mounted = true;
  expect(block.adopt()).toBe(true);
  const outer = block.root.querySelector("div")!;
  const inner = outer.querySelector("button")!;
  let stopped = false;
  const event = {
    // The dispatcher must also handle targets which are text nodes.
    target: inner.querySelector("span")!.firstChild,
    currentTarget: block.root,
    isPropagationStopped: () => stopped,
    stopPropagation: () => {
      stopped = true;
    },
  } as unknown as React.SyntheticEvent;
  return {
    block,
    events,
    event,
    calls,
    outer,
    inner,
    beforeInvoke(fn: typeof beforeInvoke) {
      beforeInvoke = fn;
    },
    dispatch() {
      block.dispatchDelegatedEvent(name, event);
    },
  };
}

afterEach(() => vi.restoreAllMocks());

it("does not allocate filter/map result arrays while collecting delegated matches", () => {
  const h = harness();
  const chain = new Set<unknown[]>();
  const filter = Array.prototype.filter;
  const map = Array.prototype.map;
  const filterSpy = vi.spyOn(Array.prototype, "filter").mockImplementation(function (
    this: unknown[],
    ...args
  ) {
    const result = Reflect.apply(filter, this, args);
    if (this === h.events || chain.has(this)) chain.add(result);
    return result;
  });
  const mapSpy = vi.spyOn(Array.prototype, "map").mockImplementation(function (
    this: unknown[],
    ...args
  ) {
    const result = Reflect.apply(map, this, args);
    if (chain.has(this)) chain.add(result);
    return result;
  });
  try {
    h.dispatch();
  } finally {
    filterSpy.mockRestore();
    mapSpy.mockRestore();
  }
  expect(chain.size).toBe(0);
  expect(h.calls.map((call) => call.label)).toEqual(["inner-first", "inner-second", "outer"]);
});

describe.each(["onClick", "onClickCapture"])("%s", (name) => {
  const expected = name.endsWith("Capture")
    ? ["outer", "inner-first", "inner-second"]
    : ["inner-first", "inner-second", "outer"];

  it("snapshots all matches before invoking handlers and keeps equal-depth order", () => {
    const h = harness(name);
    const original = Object.getOwnPropertyDescriptor(h.event, "currentTarget");
    h.beforeInvoke((label) => {
      if (label === expected[0]) h.outer.replaceChildren();
    });
    h.dispatch();
    expect(h.calls.map((call) => call.label)).toEqual(expected);
    expect(h.calls.map((call) => call.target)).toEqual(
      expected.map((label) => (label === "outer" ? h.outer : h.inner)),
    );
    expect(Object.getOwnPropertyDescriptor(h.event, "currentTarget")).toEqual(original);
  });

  it("stops dispatch after stopPropagation", () => {
    const h = harness(name);
    h.beforeInvoke((_label, event) => event.stopPropagation());
    h.dispatch();
    expect(h.calls.map((call) => call.label)).toEqual(expected.slice(0, 1));
    expect(h.event.currentTarget).toBe(h.block.root);
  });
});

it.each([false, true])("restores the currentTarget descriptor after a throw (own: %s)", (own) => {
  const h = harness();
  if (!own) Reflect.deleteProperty(h.event, "currentTarget");
  const original = Object.getOwnPropertyDescriptor(h.event, "currentTarget");
  const error = new Error("handler failed");
  h.beforeInvoke(() => {
    throw error;
  });
  expect(() => h.dispatch()).toThrow(error);
  expect(h.calls).toHaveLength(1);
  expect(Object.getOwnPropertyDescriptor(h.event, "currentTarget")).toEqual(original);
});

it("uses current committed event descriptors instead of caching earlier matches", () => {
  const h = harness();
  h.dispatch();
  const invoke = vi.fn();
  h.block.currentProps = {
    ...h.block.currentProps,
    events: [{ name: "onClick", path: [0], invoke }],
  };
  h.dispatch();
  expect(h.calls).toHaveLength(3);
  expect(invoke).toHaveBeenCalledTimes(1);
});

it("preserves native filter's handling of holes in the descriptor array", () => {
  const h = harness();
  Reflect.deleteProperty(h.events, 1);
  h.dispatch();
  expect(h.calls.map((call) => call.label)).toEqual(["inner-second", "outer"]);
});

it("does not dispatch a target owned by another list", () => {
  const h = harness();
  Object.defineProperty(h.event, "target", { value: document.createElement("span") });
  h.dispatch();
  expect(h.calls).toEqual([]);
});
