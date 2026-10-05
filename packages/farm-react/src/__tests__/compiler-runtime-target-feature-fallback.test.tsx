import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import {
  createCompiledComponentWithFeatures,
  keyedRowsIdentityRuntimeFeature,
  keyedRowsMapLookupRuntimeFeature,
  keyedRowsMembershipRuntimeFeature,
  type CompilerStateUpdater,
} from "../compiler-runtime";

it.each([
  keyedRowsIdentityRuntimeFeature,
  keyedRowsMembershipRuntimeFeature,
  keyedRowsMapLookupRuntimeFeature,
])("$name falls back before patching a definition with another target kind", async (feature) => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const read = vi.fn((item) => item);
  let update!: (value: CompilerStateUpdater) => void;
  const actualKind =
    feature === keyedRowsIdentityRuntimeFeature ? "membershipTarget" : "identityTarget";
  const target = (key: string) => (actualKind === "membershipTarget" ? new Set([key]) : key);
  const Rows = createCompiledComponentWithFeatures(
    {
      displayName: "UnexpectedTargetKind",
      initialize: () => [target("a")],
      render(_props: Record<string, never>, state, blocks) {
        const value = () => state[0].get();
        const selected = (key: string) =>
          actualKind === "membershipTarget" ? (value() as Set<string>).has(key) : value() === key;
        update = (next) => state[0].set(next);
        const KeyedRows = blocks.KeyedRows;
        return (
          <section>
            <KeyedRows
              id={0}
              items={() => ["a", "b"]}
              rowKey={(item) => String(item)}
              bindings={[
                {
                  kind: "attribute",
                  name: "data-selected",
                  path: [],
                  dependencies: [0],
                  [actualKind]: { dependency: 0, read: value },
                  read,
                },
              ]}
              create={(item) => ({
                kind: "element",
                tag: "li",
                attributes: [{ name: "data-selected", value: selected(String(item)) }],
                styles: [],
                children: [String(item)],
              })}
              render={() => (
                <ul>
                  {["a", "b"].map((key) => (
                    <li key={key} data-selected={selected(key)}>
                      {key}
                    </li>
                  ))}
                </ul>
              )}
            />
          </section>
        );
      },
      bindings: [{ kind: "block", id: 0, dependencies: [0] }],
    },
    [feature],
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<Rows />));
    await act(async () => {
      update(target("b"));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect([...container.querySelectorAll("li")].map((row) => row.dataset.selected)).toEqual([
      "false",
      "true",
    ]);
    expect(read).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
