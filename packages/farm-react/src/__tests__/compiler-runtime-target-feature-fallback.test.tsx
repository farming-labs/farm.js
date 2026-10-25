import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import {
  createCompiledComponentWithFeatures,
  keyedRowsAppendOnlyRuntimeFeature,
  keyedRowsHintedRuntimeFeature,
  keyedRowsIdentityRuntimeFeature,
  keyedRowsIdentityFilterHintedRuntimeFeature,
  keyedRowsIdentityFilterOnlyRuntimeFeature,
  keyedRowsFilterHintedRuntimeFeature,
  keyedRowsFilterOnlyRuntimeFeature,
  keyedRowsMapLookupRuntimeFeature,
  keyedRowsMembershipRuntimeFeature,
  keyedRowsPrependHintedRuntimeFeature,
  keyedRowsPrependOnlyRuntimeFeature,
  keyedRowsPlainReorderHintedRuntimeFeature,
  keyedRowsReorderHintedRuntimeFeature,
  type CompilerStateUpdater,
} from "../compiler-runtime";

it.each([
  [keyedRowsPlainReorderHintedRuntimeFeature, keyedRowsReorderHintedRuntimeFeature],
  [keyedRowsAppendOnlyRuntimeFeature, keyedRowsHintedRuntimeFeature],
  [keyedRowsPrependOnlyRuntimeFeature, keyedRowsPrependHintedRuntimeFeature],
  [keyedRowsFilterOnlyRuntimeFeature, keyedRowsFilterHintedRuntimeFeature],
  [keyedRowsFilterOnlyRuntimeFeature, keyedRowsIdentityFilterOnlyRuntimeFeature],
  [keyedRowsIdentityFilterHintedRuntimeFeature, keyedRowsFilterHintedRuntimeFeature],
  [keyedRowsIdentityFilterOnlyRuntimeFeature, keyedRowsFilterHintedRuntimeFeature],
  [keyedRowsIdentityFilterOnlyRuntimeFeature, keyedRowsIdentityFilterHintedRuntimeFeature],
])("refreshes $0.name when changing to $1.name", (initialFeature, feature) => {
  const definition = {
    displayName: "FilteredTargetsRefresh",
    hmrId: `filtered-targets-refresh-${Math.random()}`,
    stateSignature: "0",
    initialize: () => [],
    render: () => <section />,
    bindings: [],
  };
  const Initial = createCompiledComponentWithFeatures(definition, [initialFeature]);
  const Compatible = createCompiledComponentWithFeatures(definition, [initialFeature]);
  const Mixed = createCompiledComponentWithFeatures(definition, [feature]);
  const SpecializedAgain = createCompiledComponentWithFeatures(definition, [initialFeature]);
  expect(Compatible).toBe(Initial);
  expect(Mixed).not.toBe(Initial);
  expect(SpecializedAgain).not.toBe(Mixed);
});

it.each([
  keyedRowsIdentityRuntimeFeature,
  keyedRowsIdentityFilterHintedRuntimeFeature,
  keyedRowsIdentityFilterOnlyRuntimeFeature,
  keyedRowsMembershipRuntimeFeature,
  keyedRowsMapLookupRuntimeFeature,
])("$name falls back before patching a definition with another target kind", async (feature) => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const read = vi.fn((item) => item);
  let update!: (value: CompilerStateUpdater) => void;
  const actualKind =
    feature === keyedRowsIdentityRuntimeFeature ||
    feature === keyedRowsIdentityFilterHintedRuntimeFeature ||
    feature === keyedRowsIdentityFilterOnlyRuntimeFeature
      ? "membershipTarget"
      : "identityTarget";
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

it.each([
  keyedRowsFilterOnlyRuntimeFeature,
  keyedRowsPrependOnlyRuntimeFeature,
  keyedRowsPlainReorderHintedRuntimeFeature,
])(
  "$name uses full binding reads when a target-free runtime receives valid target metadata",
  async (feature) => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    let update!: (value: CompilerStateUpdater) => void;
    const read = vi.fn();
    const Rows = createCompiledComponentWithFeatures(
      {
        displayName: "UntargetedBindingReads",
        initialize: () => ["a"],
        render(_props: Record<string, never>, state, blocks) {
          const selected = () => state[0].get();
          update = (next) => state[0].set(next);
          const value = (item: unknown) => {
            read(item);
            return selected() === item;
          };
          return (
            <section>
              <blocks.KeyedRows
                id={0}
                dependencies={[0]}
                items={() => ["a", "b"]}
                rowKey={(item) => String(item)}
                bindings={[
                  {
                    kind: "attribute",
                    name: "data-selected",
                    path: [],
                    dependencies: [0],
                    identityTarget: { dependency: 0, read: selected },
                    read: value,
                  },
                ]}
                create={(item) => ({
                  kind: "element",
                  tag: "li",
                  attributes: [{ name: "data-selected", value: selected() === item }],
                  styles: [],
                  children: [String(item)],
                })}
                render={() => (
                  <ul>
                    {["a", "b"].map((item) => (
                      <li key={item} data-selected={selected() === item}>
                        {item}
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
      read.mockClear();
      await act(async () => {
        update("b");
        await Promise.resolve();
        await Promise.resolve();
      });
      expect([...container.querySelectorAll("li")].map((row) => row.dataset.selected)).toEqual([
        "false",
        "true",
      ]);
      // Unlike a target-specialized feature, the target-free core performs
      // ordinary binding reads. The compiler forbids this selection for targets.
      expect(read.mock.calls.map(([item]) => item)).toEqual(["a", "b"]);
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  },
);
