import React, { StrictMode, act } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createCompiledComponent,
  type CompilerHostElement,
  type CompilerStateUpdater,
} from "../compiler-runtime";

interface Item {
  id: string;
  label: string;
}
const initial: Item[] = Array.from({ length: 8 }, (_, index) => ({
  id: `inner-${index}`,
  label: `Row ${index}`,
}));
const roots: Root[] = [];
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.replaceChildren();
  vi.restoreAllMocks();
});
const host = (
  tag: string,
  children: readonly unknown[] = [],
  attributes: { name: string; value: unknown }[] = [],
): CompilerHostElement => ({ kind: "element", tag, children, attributes, styles: [] });
async function change(run: () => void) {
  await act(async () => {
    run();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function mount(
  kind: "keyed-ranges" | "mixed-ranges",
  reactivity: "static" | "hybrid",
  hydrate: boolean,
  updates: "outer" | "nested",
) {
  const counts = { keys: 0, descriptors: 0, bindings: 0 };
  let setItems: (next: CompilerStateUpdater) => void = () => undefined;
  let setExtra: (next: CompilerStateUpdater) => void = () => undefined;
  let invalidDescriptor = false;
  const Panel = createCompiledComponent({
    displayName: "NestedStableRows",
    reactivity,
    initialize: () => [true, initial, true],
    render(_props: Record<string, never>, state, blocks) {
      setItems = state[1].set;
      setExtra = state[2].set;
      const items = () => state[1].get() as Item[];
      const descriptor = (item: Item) =>
        host(
          "input",
          [],
          [
            { name: "data-key", value: item.id },
            { name: "readOnly", value: true },
            { name: "value", value: item.label },
          ],
        );
      const range = {
        before: 1,
        items,
        rowKey: (item: unknown) => {
          counts.keys += 1;
          return (item as Item).id;
        },
        create: (item: unknown) => {
          counts.descriptors += 1;
          return invalidDescriptor && (item as Item).id === "inner-7"
            ? host("textarea")
            : descriptor(item as Item);
        },
        bindings: [
          {
            kind: "attribute" as const,
            path: [],
            name: "value",
            read: (item: unknown) => {
              counts.bindings += 1;
              return (item as Item).label;
            },
          },
          {
            kind: "attribute" as const,
            path: [],
            name: "data-index",
            read: (_item: unknown, index: number) => index,
          },
        ],
      };
      const create = (): CompilerHostElement => ({
        ...host("section", [
          host("i", ["Before"]),
          ...items().map(descriptor),
          ...(kind === "mixed-ranges" && state[2].get() ? [host("em", ["Extra"])] : []),
          host("b", ["After"]),
        ]),
        block:
          kind === "keyed-ranges"
            ? { kind, id: 1, ranges: [range], trailing: 1 }
            : {
                kind,
                id: 1,
                ranges: [
                  { kind: "keyed", ...range },
                  {
                    kind: "conditional",
                    before: 0,
                    test: () => state[2].get(),
                    truthy: { create: () => host("em", ["Extra"]), bindings: [] },
                  },
                ],
                trailing: 1,
              },
      });
      const render = () => (
        <div>
          <section>
            <i>Before</i>
            {items().map((item, index) => (
              <input
                key={item.id}
                data-key={item.id}
                data-index={index}
                value={item.label}
                readOnly
              />
            ))}
            {kind === "mixed-ranges" && state[2].get() ? <em>Extra</em> : null}
            <b>After</b>
          </section>
        </div>
      );
      return (
        <main>
          {updates === "outer" ? (
            <blocks.KeyedRows
              id={0}
              hostBlocks
              items={() => [true]}
              rowKey={() => "parent"}
              create={create}
              bindings={[]}
              render={render}
            />
          ) : (
            <blocks.HostConditional
              id={0}
              before={0}
              test={() => state[0].get()}
              truthy={{ create, bindings: [] }}
              render={render}
            />
          )}
        </main>
      );
    },
    bindings: [
      { kind: "block", id: 0, dependencies: updates === "outer" ? [0, 1, 2] : [0] },
      { kind: "block", id: 1, parent: 0, dependencies: updates === "outer" ? [] : [1, 2] },
    ],
  });
  const container = document.createElement("div");
  document.body.append(container);
  const content = (
    <StrictMode>
      <Panel />
    </StrictMode>
  );
  if (hydrate) container.innerHTML = renderToString(content);
  const recoverable = vi.fn();
  await act(async () => {
    const root = hydrate
      ? hydrateRoot(container, content, { onRecoverableError: recoverable })
      : createRoot(container);
    roots.push(root);
    if (!hydrate) root.render(content);
  });
  expect(recoverable).not.toHaveBeenCalled();
  return {
    container,
    counts,
    setItems: (next: CompilerStateUpdater) => setItems(next),
    setExtra: (next: boolean) => setExtra(next),
    failDescriptor: () => {
      invalidDescriptor = true;
    },
  };
}

describe("stable nested keyed order", () => {
  for (const kind of ["keyed-ranges", "mixed-ranges"] as const) {
    for (const reactivity of ["static", "hybrid"] as const) {
      for (const hydrate of [false, true]) {
        for (const updates of ["outer", "nested"] as const) {
          it(`${kind}/${reactivity}/hydrate=${hydrate}/${updates}: skips structural maps only for completely stable keys`, async () => {
            const h = await mount(kind, reactivity, hydrate, updates);
            const writes = { positions: 0, instances: 0 };
            const set = Map.prototype.set;
            vi.spyOn(Map.prototype, "set").mockImplementation(function (
              this: Map<unknown, unknown>,
              key: unknown,
              value: unknown,
            ) {
              if (typeof key === "string" && key.startsWith("inner-")) {
                if (typeof value === "number") writes.positions += 1;
                else if (value && typeof value === "object" && "element" in value)
                  writes.instances += 1;
              }
              return set.call(this, key, value);
            });
            const section = h.container.querySelector("section")!;
            const before = section.querySelector("i");
            const after = section.querySelector("b");
            const insert = vi.spyOn(section, "insertBefore");
            let items = initial;
            for (let round = 0; round < 4; round += 1) {
              const focused = h.container.querySelector<HTMLInputElement>('[data-key="inner-3"]')!;
              focused.focus();
              focused.setSelectionRange(1, 4, "backward");
              writes.positions = writes.instances = 0;
              h.counts.keys = h.counts.descriptors = h.counts.bindings = 0;
              insert.mockClear();
              items = items.map((item) =>
                item.id === "inner-3" ? item : { ...item, label: `${item.id}:${round}` },
              );
              await change(() => {
                h.setItems(items);
                h.setExtra(round % 2 === 0);
              });
              expect(writes).toEqual({ positions: 0, instances: 0 });
              expect(h.counts).toEqual({
                keys: items.length,
                descriptors: items.length,
                bindings: items.length,
              });
              const rows = [...section.querySelectorAll("input")];
              expect(rows.map((row) => [row.dataset.key, row.value, row.dataset.index])).toEqual(
                items.map((item, index) => [item.id, item.label, String(index)]),
              );
              expect(document.activeElement).toBe(focused);
              expect([
                focused.selectionStart,
                focused.selectionEnd,
                focused.selectionDirection,
              ]).toEqual([1, 4, "backward"]);
              expect(section.querySelector("i")).toBe(before);
              expect(section.querySelector("b")).toBe(after);
              expect(
                insert.mock.calls.filter(([node]) => (node as Element).tagName === "INPUT"),
              ).toHaveLength(0);
              if (kind === "mixed-ranges")
                expect(Boolean(section.querySelector("em"))).toBe(round % 2 === 0);
              // Reorder only the final keys: eligibility must be proven before any row is updated.
              items =
                round % 2
                  ? [...items.slice(0, -2), items.at(-1)!, items.at(-2)!]
                  : [...items].reverse();
              h.counts.keys = h.counts.descriptors = h.counts.bindings = 0;
              await change(() => h.setItems(items));
              expect(writes.positions).toBeGreaterThan(0);
              expect(h.counts).toEqual({
                keys: items.length,
                descriptors: items.length,
                bindings: items.length,
              });
              expect([...section.querySelectorAll("input")].map((row) => row.dataset.key)).toEqual(
                items.map((item) => item.id),
              );
            }
            await change(() => h.setItems([]));
            expect(section.querySelectorAll("input")).toHaveLength(0);
            await change(() => h.setItems(initial));
            writes.positions = writes.instances = 0;
            await change(() => {
              h.setItems([...initial]);
              h.setItems([...initial]);
            });
            expect(writes).toEqual({ positions: 0, instances: 0 });
            expect(section.querySelectorAll("input")).toHaveLength(initial.length);
          });

          it(`${kind}/${reactivity}/hydrate=${hydrate}/${updates}: retains duplicate and invalid-scope fallback`, async () => {
            const h = await mount(kind, reactivity, hydrate, updates);
            const original = h.container.querySelector("section")!;
            const nodes = [...original.children];
            const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
            await change(() =>
              h.setItems([
                { ...initial[0], label: "First" },
                { ...initial[0], label: "Duplicate" },
              ]),
            );
            expect(h.container.querySelector("section")).not.toBe(original);
            expect([...original.children]).toEqual(nodes);
            expect([...h.container.querySelectorAll("input")].map((row) => row.value)).toEqual([
              "First",
              "Duplicate",
            ]);
            expect(
              errors.mock.calls.every(([message]) =>
                String(message).includes("Encountered two children with the same key"),
              ),
            ).toBe(true);
            errors.mockRestore();
            const safe = await mount(kind, reactivity, hydrate, updates);
            const oldSection = safe.container.querySelector("section");
            safe.failDescriptor();
            await change(() => safe.setItems([...initial]));
            expect(safe.container.querySelector("section")).not.toBe(oldSection);
            expect([...safe.container.querySelectorAll("input")].map((row) => row.value)).toEqual(
              initial.map((item) => item.label),
            );
          });
        }
      }
    }
  }
});
