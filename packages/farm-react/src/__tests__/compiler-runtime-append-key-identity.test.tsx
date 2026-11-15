import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import {
  createCompiledComponent,
  createCompiledComponentWithFeatures,
  createCompilerKeyedArrayAppend,
  keyedRowsAppendOnlyRuntimeFeature,
  type CompiledComponentDefinition,
} from "../compiler-runtime";

interface Row {
  key: string | number;
  label: string;
}

describe.each([
  ["static", false],
  ["static", true],
  ["hybrid", false],
  ["hybrid", true],
] as const)("%s append key identity (append-only: %s)", (reactivity, appendOnly) => {
  it.each(["committed", "incoming"] as const)(
    "rejects number/string-equivalent %s keys before mutating the owned map",
    async (duplicate) => {
      globalThis.IS_REACT_ACT_ENVIRONMENT = true;
      const initial: Row[] = [{ key: 1, label: "One" }];
      let append!: (rows: Row[]) => void;
      let renders = 0;
      const create = appendOnly
        ? (definition: CompiledComponentDefinition<Record<string, never>>) =>
            createCompiledComponentWithFeatures(definition, [keyedRowsAppendOnlyRuntimeFeature])
        : createCompiledComponent;
      const Table = create({
        displayName: "AppendKeyIdentity",
        reactivity,
        initialize: () => [initial],
        render(_props: Record<string, never>, state, blocks) {
          const rows = () => state[0].get() as Row[];
          append = (added) =>
            state[0].set((previous) =>
              createCompilerKeyedArrayAppend(previous, [...(previous as Row[]), ...added]),
            );
          return (
            <section>
              <blocks.KeyedRows
                id={0}
                items={rows}
                collectionDependency={0}
                dependencies={[0]}
                structureDependencies={[0]}
                rowKey={(row) => (row as Row).key}
                create={(row) => ({
                  kind: "element",
                  tag: "li",
                  attributes: [],
                  styles: [],
                  children: [(row as Row).label],
                })}
                bindings={[{ kind: "text", path: [], read: (row) => [(row as Row).label] }]}
                render={() => {
                  renders += 1;
                  return (
                    <ul>
                      {rows().map((row) => (
                        <li key={row.key}>{row.label}</li>
                      ))}
                    </ul>
                  );
                }}
              />
            </section>
          );
        },
        bindings: [{ kind: "block", id: 0, dependencies: [0] }],
      });
      const container = document.createElement("div");
      document.body.append(container);
      const root = createRoot(container);
      const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const maps = new Set<Map<unknown, { element: Element }>>();
      const originalSet = Map.prototype.set;
      vi.spyOn(Map.prototype, "set").mockImplementation(function (key, value) {
        if (value?.element instanceof Element) maps.add(this);
        return originalSet.call(this, key, value);
      });
      try {
        await act(async () => root.render(<Table />));
        const retained = container.querySelector("li");
        await act(async () => {
          append([
            { key: 2, label: "Two" },
            { key: "01", label: "Zero one" },
          ]);
          await Promise.resolve();
        });
        expect(container.querySelector("li")).toBe(retained);
        expect(renders).toBe(1);
        const before = [...container.querySelectorAll("li")];
        const ownedMaps = [...maps].filter((map) =>
          [...map.values()].some((row) => row.element === retained),
        );
        expect(ownedMaps.length).toBeGreaterThan(0);
        const keysBefore = ownedMaps.map((map) => [...map.keys()]);
        let snapshot: { rows: Element[]; keys: unknown[][] } | undefined;
        const collision: Row = {
          get key() {
            snapshot ??= {
              rows: [...container.querySelectorAll("li")],
              keys: ownedMaps.map((map) => [...map.keys()]),
            };
            return duplicate === "committed" ? "1" : "3";
          },
          label: "Collision",
        };
        await act(async () => {
          append([{ key: 3, label: "Three" }, collision]);
          await Promise.resolve();
        });
        expect(snapshot).toEqual({ rows: before, keys: keysBefore });
        expect(renders).toBeGreaterThan(1);
        expect([...container.querySelectorAll("li")].map((row) => row.textContent)).toEqual([
          "One",
          "Two",
          "Zero one",
          "Three",
          "Collision",
        ]);
        expect(errors).toHaveBeenCalled();
        expect(errors.mock.calls.every(([message]) => String(message).includes("same key"))).toBe(
          true,
        );
      } finally {
        await act(async () => root.unmount());
        container.remove();
        vi.restoreAllMocks();
      }
    },
  );
});
