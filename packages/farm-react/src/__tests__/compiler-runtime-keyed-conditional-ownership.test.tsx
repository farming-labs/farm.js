import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  keyedRowsConditionalRuntimeFeature,
  keyedRowsPlainRuntimeFeature,
  type CompilerKeyedRowsBlockProps,
  type CompilerRuntimeFeature,
} from "../compiler-runtime";

type Conditional = Parameters<CompilerKeyedRowsBlockProps["render"]>[1];

afterEach(() => vi.unstubAllGlobals());

function block(feature: CompilerRuntimeFeature, capture: (render: Conditional) => void) {
  const Block = feature.create({ setRoot() {}, subscribe: () => () => {} })
    .KeyedRows as React.ComponentClass<CompilerKeyedRowsBlockProps>;
  const props: CompilerKeyedRowsBlockProps = {
    id: 0,
    items: () => [],
    rowKey: (_item, index) => index,
    create: () => ({ kind: "element", tag: "li", attributes: [], styles: [], children: [] }),
    bindings: [],
    render: (_event, conditional) => {
      capture(conditional);
      return <ul />;
    },
  };
  return new Block(props);
}

describe("keyed conditional feature ownership", () => {
  it.each([
    ["plain", keyedRowsPlainRuntimeFeature, 2],
    ["conditional", keyedRowsConditionalRuntimeFeature, 3],
  ] as const)("allocates only the maps owned by the %s feature", (_name, feature, expected) => {
    const NativeMap = Map;
    let allocations = 0;
    vi.stubGlobal(
      "Map",
      class extends NativeMap {
        constructor(...args: ConstructorParameters<typeof Map>) {
          super(...args);
          allocations += 1;
        }
      },
    );
    block(feature, () => {});
    vi.unstubAllGlobals();
    // Every block needs rows and event handlers. Only conditional features need listeners.
    expect(allocations).toBe(expected);
  });

  it("shares the stateless plain renderer without changing manual callback values or errors", () => {
    const renderers: Conditional[] = [];
    const first = block(keyedRowsPlainRuntimeFeature, (render) => renderers.push(render));
    const second = block(keyedRowsPlainRuntimeFeature, (render) => renderers.push(render));
    first.render();
    second.render();
    expect(renderers[0]).toBe(renderers[1]);
    const item = {};
    const result = <strong>value</strong>;
    const render = vi.fn(() => result);
    expect(renderers[0](item, 7, 4, render)).toBe(result);
    expect(render).toHaveBeenCalledExactlyOnceWith(item, 7);
    const error = new Error("conditional callback failed");
    expect(() =>
      renderers[1](item, 2, 0, () => {
        throw error;
      }),
    ).toThrow(error);
  });

  it("keeps conditional owners separate even when blocks share keys and conditional IDs", () => {
    const renderers: Conditional[] = [];
    const first = block(keyedRowsConditionalRuntimeFeature, (render) => renderers.push(render));
    const second = block(keyedRowsConditionalRuntimeFeature, (render) => renderers.push(render));
    first.render();
    second.render();
    first.render();
    expect(renderers[0]).not.toBe(renderers[1]);
    expect(renderers[0]).toBe(renderers[2]);
    const render = () => <span />;
    const a = renderers[0]({}, 0, 0, render) as React.ReactElement<{ owner: unknown }>;
    const b = renderers[1]({}, 0, 0, render) as React.ReactElement<{ owner: unknown }>;
    expect(a.props.owner).not.toBe(b.props.owner);
  });
});
