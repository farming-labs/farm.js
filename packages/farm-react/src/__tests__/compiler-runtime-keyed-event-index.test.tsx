import { observeWeakMapSets } from "./observe-weak-map-sets";
import React, { StrictMode, act } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createCompiledComponent,
  createCompiledComponentWithFeatures,
  createCompilerKeyedArrayAppend,
  createCompilerKeyedArrayFilter,
  createCompilerKeyedArrayMappedRollingWindow,
  createCompilerKeyedArrayPositionUpdate,
  createCompilerKeyedArrayPrepend,
  createCompilerKeyedArrayRollingWindow,
  createCompilerKeyedArraySlice,
  keyedRowsAppendOnlyRuntimeFeature,
  keyedRowsHintedRuntimeFeature,
  keyedRowsPrependHintedRuntimeFeature,
  keyedRowsPrependOnlyRuntimeFeature,
  keyedRowsMappedRollingWindowHintedRuntimeFeature,
  type CompiledComponentDefinition,
} from "../compiler-runtime";

type Mode = "none" | "empty" | "direct" | "missing-path" | "delegated";
interface Item {
  id: string;
  label: string;
}
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
  vi.unstubAllGlobals();
});

function trackRowIndexWrites() {
  const writes = { count: 0 };
  observeWeakMapSets((key, value) => {
    if (value && typeof value === "object" && "element" in value && value.element === key) {
      writes.count += 1;
    }
  });
  return writes;
}

function trackCopiedRowEntries() {
  const copies = { count: 0 };
  const NativeMap = globalThis.Map;
  vi.stubGlobal(
    "Map",
    new Proxy(NativeMap, {
      construct(target, args) {
        const source = args[0];
        if (
          source instanceof NativeMap &&
          source.values().next().value?.element instanceof Element
        ) {
          copies.count += source.size;
        }
        return Reflect.construct(target, args, target);
      },
    }),
  );
  return copies;
}

function harness(reactivity: "static" | "hybrid") {
  const calls: string[] = [];
  const initial = Array.from({ length: 64 }, (_, index) => ({
    id: `${index}`,
    label: `Row ${index}`,
  }));
  let update: (fn: (items: Item[]) => Item[]) => void = () => undefined;
  const hmrId = `event-index-${Math.random()}`;
  function definition(mode: Mode): CompiledComponentDefinition<{ mode?: Mode }> {
    return {
      displayName: "EventIndexRows",
      hmrId,
      stateSignature: "1",
      reactivity,
      initialize: () => [initial],
      render(props, state, blocks) {
        const currentMode = props.mode ?? mode;
        const hasEvents = !["none", "empty"].includes(currentMode);
        const items = () => state[0].get() as Item[];
        update = (fn) => state[0].set((previous) => fn(previous as Item[]));
        return (
          <section>
            <blocks.KeyedRows
              id={0}
              items={items}
              collectionDependency={0}
              dependencies={[0]}
              structureDependencies={[0]}
              prependIndexIndependent
              positionIndexIndependent
              filterIndexIndependent
              delegateEvents={currentMode !== "direct" && currentMode !== "none"}
              events={
                hasEvents
                  ? [
                      {
                        name: "onClick",
                        path: currentMode === "missing-path" ? undefined : [],
                        invoke: (item, index, event) =>
                          calls.push(
                            `${(item as Item).label}:${index}:${(event.currentTarget as HTMLElement).dataset.key}`,
                          ),
                      },
                    ]
                  : currentMode === "empty"
                    ? []
                    : undefined
              }
              rowKey={(item) => (item as Item).id}
              create={(item) => ({
                kind: "element",
                tag: "button",
                attributes: [{ name: "data-key", value: (item as Item).id }],
                styles: [],
                children: [(item as Item).label],
              })}
              bindings={[
                {
                  kind: "text",
                  path: [],
                  dependencies: [],
                  read: (item) => [(item as Item).label],
                },
              ]}
              render={(event) => (
                <div>
                  {items().map((item, index) => (
                    <button
                      data-key={item.id}
                      key={item.id}
                      onClick={hasEvents ? event(item, index, 0) : undefined}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              )}
            />
          </section>
        );
      },
      bindings: [{ kind: "block", id: 0, dependencies: [0] }],
    };
  }
  return { calls, initial, definition, update: (fn: (items: Item[]) => Item[]) => update(fn) };
}

async function change(fn: () => void) {
  await act(async () => {
    fn();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("keyed-row delegated element index", () => {
  for (const reactivity of ["static", "hybrid"] as const) {
    for (const lifecycle of ["mount", "hydrate"] as const) {
      it.each(
        [keyedRowsHintedRuntimeFeature, keyedRowsAppendOnlyRuntimeFeature].flatMap((feature) =>
          (["none", "delegated"] as const).map((mode) => ({ feature, mode })),
        ),
      )(
        `${reactivity}/${lifecycle}: $feature.name appends without copying retained rows or reindexing them in $mode mode`,
        async ({ feature, mode }) => {
          const h = harness(reactivity);
          const Table = createCompiledComponentWithFeatures(h.definition(mode), [feature]);
          const container = document.createElement("div");
          document.body.append(container);
          const content = (
            <StrictMode>
              <Table />
            </StrictMode>
          );
          if (lifecycle === "hydrate") container.innerHTML = renderToString(content);
          await act(async () => {
            const root =
              lifecycle === "hydrate" ? hydrateRoot(container, content) : createRoot(container);
            roots.push(root);
            if (lifecycle === "mount") root.render(content);
          });
          const retained = [...container.querySelectorAll<HTMLButtonElement>("button")];
          retained[32].focus();
          const writes = trackRowIndexWrites();
          const copies = trackCopiedRowEntries();
          await change(() => {
            for (let index = 0; index < 2; index += 1) {
              h.update(
                (items) =>
                  createCompilerKeyedArrayAppend(items, [
                    ...items,
                    { id: `added-${index}`, label: `Added ${index}` },
                  ]) as Item[],
              );
            }
          });
          expect(copies.count).toBe(0);
          expect(writes.count).toBe(mode === "delegated" ? 2 : 0);
          const rows = [...container.querySelectorAll<HTMLButtonElement>("button")];
          expect(rows).toHaveLength(66);
          expect(retained.every((row, index) => rows[index] === row)).toBe(true);
          expect(rows.slice(64).map((row) => row.textContent)).toEqual(["Added 0", "Added 1"]);
          expect(document.activeElement).toBe(retained[32]);
          if (mode === "delegated") {
            await change(() => {
              retained[32].click();
              rows[64].click();
              rows[65].click();
            });
            expect(h.calls).toEqual(["Row 32:32:32", "Added 0:64:added-0", "Added 1:65:added-1"]);
          }
          // Empty and later appends must not reuse an earlier append's index delta.
          writes.count = 0;
          await change(() =>
            h.update((items) => createCompilerKeyedArrayAppend(items, [...items]) as Item[]),
          );
          expect(writes.count).toBe(0);
          await change(() =>
            h.update(
              (items) =>
                createCompilerKeyedArrayAppend(items, [
                  ...items,
                  { id: "later", label: "Later" },
                ]) as Item[],
            ),
          );
          expect(copies.count).toBe(0);
          expect(writes.count).toBe(mode === "delegated" ? 1 : 0);
          if (mode === "delegated") {
            await change(() =>
              container.querySelector<HTMLButtonElement>('[data-key="later"]')!.click(),
            );
            expect(h.calls.at(-1)).toBe("Later:66:later");
          }
          // A smaller hint runtime is not an append-only state contract: opaque
          // replacement, mapping, removal and reorder still fully reconcile.
          await change(() => {
            h.update((items) =>
              items.slice(1).map((item) => ({ ...item, label: item.label + "!" })),
            );
            h.update(
              (items) =>
                createCompilerKeyedArrayAppend(items, [
                  ...items,
                  { id: "opaque", label: "Opaque" },
                ]) as Item[],
            );
          });
          expect(container.querySelector('[data-key="0"]')).toBeNull();
          expect(container.querySelector('[data-key="32"]')).toBe(retained[32]);
          expect(retained[32].textContent).toBe("Row 32!");
          expect(container.querySelector("button:last-child")?.textContent).toBe("Opaque");
          await change(() => h.update((items) => items.toReversed()));
          expect(container.querySelector("button")?.textContent).toBe("Opaque");
          expect(container.querySelector('[data-key="32"]')).toBe(retained[32]);
          if (mode === "delegated") {
            await change(() => retained[32].click());
            expect(h.calls.at(-1)).toBe("Row 32!:35:32");
          }
        },
      );

      it.each(["none", "empty", "direct", "missing-path", "delegated"] as const)(
        `${reactivity}/${lifecycle}: indexes only incoming delegated rolling-window rows in %s mode`,
        async (mode) => {
          const h = harness(reactivity);
          const Table = createCompiledComponentWithFeatures(h.definition(mode), [
            keyedRowsMappedRollingWindowHintedRuntimeFeature,
          ]);
          const container = document.createElement("div");
          document.body.append(container);
          const content = (
            <StrictMode>
              <Table />
            </StrictMode>
          );
          if (lifecycle === "hydrate") container.innerHTML = renderToString(content);
          await act(async () => {
            const root =
              lifecycle === "hydrate" ? hydrateRoot(container, content) : createRoot(container);
            roots.push(root);
            if (lifecycle === "mount") root.render(content);
          });
          const retained = container.querySelector<HTMLButtonElement>('[data-key="32"]')!;
          retained.focus();
          const writes = trackRowIndexWrites();
          let expected = h.initial;
          await change(() => {
            for (let index = 0; index < 2; index += 1) {
              h.update((items) => {
                const kept = createCompilerKeyedArraySlice(items, items.slice, 1) as Item[];
                expected = createCompilerKeyedArrayMappedRollingWindow(items, kept, [
                  ...kept,
                  { id: `added-${index}`, label: `Added ${index}` },
                ]) as Item[];
                return expected;
              });
            }
          });
          expect(writes.count).toBe(mode === "delegated" ? 2 : 0);
          const rows = [...container.querySelectorAll<HTMLButtonElement>("button")];
          expect(rows.map((row) => row.dataset.key)).toEqual(expected.map((item) => item.id));
          expect(rows.map((row) => row.textContent)).toEqual(expected.map((item) => item.label));
          expect(container.querySelector('[data-key="32"]')).toBe(retained);
          expect(document.activeElement).toBe(retained);
          if (!["none", "empty"].includes(mode)) {
            await change(() => {
              retained.click();
              rows.at(-1)!.click();
            });
            expect(h.calls.slice(-2)).toEqual(["Row 32:30:32", "Added 1:63:added-1"]);
          }
        },
      );

      it.each(
        (["none", "empty", "direct", "missing-path", "delegated"] as const).flatMap((mode) =>
          [undefined, keyedRowsPrependOnlyRuntimeFeature].map((feature) => ({ mode, feature })),
        ),
      )(
        `${reactivity}/${lifecycle}: indexes only delegated rows in $mode mode ($feature.name)`,
        async ({ mode, feature }) => {
          const h = harness(reactivity);
          const Table = feature
            ? createCompiledComponentWithFeatures(h.definition(mode), [feature])
            : createCompiledComponent(h.definition(mode));
          const container = document.createElement("div");
          document.body.append(container);
          const content = (
            <StrictMode>
              <Table />
            </StrictMode>
          );
          if (lifecycle === "hydrate") container.innerHTML = renderToString(content);
          const serverRows = [...container.querySelectorAll("button")];
          const writes = trackRowIndexWrites();
          await act(async () => {
            const root =
              lifecycle === "hydrate" ? hydrateRoot(container, content) : createRoot(container);
            roots.push(root);
            if (lifecycle === "mount") root.render(content);
          });
          if (lifecycle === "hydrate")
            expect([...container.querySelectorAll("button")]).toEqual(serverRows);
          if (mode === "delegated") expect(writes.count).toBeGreaterThan(0);
          else expect(writes.count).toBe(0);

          const retained = container.querySelector<HTMLButtonElement>('[data-key="32"]')!;
          retained.focus();
          const operations: Array<(items: Item[]) => Item[]> = [
            (items) =>
              createCompilerKeyedArrayAppend(items, [
                ...items,
                { id: "appended", label: "Appended" },
              ]) as Item[],
            (items) =>
              createCompilerKeyedArrayPrepend(items, [
                { id: "prepended", label: "Prepended" },
                ...items,
              ]) as Item[],
            (items) =>
              createCompilerKeyedArrayPositionUpdate(
                items,
                Array.prototype.toSpliced,
                "insert",
                1,
                0,
                { id: "inserted", label: "Inserted" },
              ) as Item[],
            (items) =>
              createCompilerKeyedArrayFilter(
                items,
                items.filter,
                (item: Item) => item.id !== "0",
              ) as Item[],
            (items) => {
              const kept = createCompilerKeyedArraySlice(items, items.slice, 1) as Item[];
              return createCompilerKeyedArrayRollingWindow(items, kept, [
                ...kept,
                { id: "rolled", label: "Rolled" },
              ]) as Item[];
            },
            (items) => [...items].reverse().map((item) => ({ ...item, label: `${item.label}!` })),
          ];
          let expected = h.initial;
          for (const operation of operations) {
            writes.count = 0;
            await change(() =>
              h.update((items) => {
                expected = operation(items);
                return expected;
              }),
            );
            const rows = [...container.querySelectorAll<HTMLButtonElement>("button")];
            expect(rows.map((row) => row.dataset.key)).toEqual(expected.map((item) => item.id));
            expect(rows.map((row) => row.textContent)).toEqual(expected.map((item) => item.label));
            expect(container.querySelector('[data-key="32"]')).toBe(retained);
            expect(document.activeElement).toBe(retained);
            if (mode !== "delegated") expect(writes.count).toBe(0);
            if (!["none", "empty"].includes(mode)) {
              await change(() => rows.at(-1)!.click());
              expect(h.calls.at(-1)).toBe(
                `${expected.at(-1)!.label}:${expected.length - 1}:${expected.at(-1)!.id}`,
              );
            }
          }
          await change(() => h.update(() => []));
          expect(container.querySelectorAll("button")).toHaveLength(0);
          await change(() => h.update(() => [{ id: "new", label: "New" }]));
          if (!["none", "empty"].includes(mode)) {
            await change(() => container.querySelector("button")!.click());
            expect(h.calls.at(-1)).toBe("New:0:new");
          }
        },
      );
    }

    it.each([
      keyedRowsHintedRuntimeFeature,
      keyedRowsAppendOnlyRuntimeFeature,
      keyedRowsPrependHintedRuntimeFeature,
      keyedRowsPrependOnlyRuntimeFeature,
    ])(
      `${reactivity}: $name rebuilds when Fast Refresh changes event ownership`,
      async (feature) => {
        const prepend =
          feature === keyedRowsPrependOnlyRuntimeFeature ||
          feature === keyedRowsPrependHintedRuntimeFeature;
        const h = harness(reactivity);
        const Table = createCompiledComponentWithFeatures(h.definition("none"), [feature]);
        const container = document.createElement("div");
        document.body.append(container);
        const root = createRoot(container);
        roots.push(root);
        await act(async () => root.render(<Table />));
        let retained = container.querySelector('[data-key="32"]');
        const writes = trackRowIndexWrites();
        let staleReactRows = false;
        let refreshIndex = 0;
        for (const mode of ["delegated", "direct", "empty", "delegated"] as const) {
          writes.count = 0;
          await change(() => {
            expect(createCompiledComponentWithFeatures(h.definition(mode), [feature])).toBe(Table);
          });
          const adopted = container.querySelector('[data-key="32"]');
          // The ownership fix resets stale React fibers once at the handoff,
          // but the following compiler/React update must retain the adopted row.
          if (staleReactRows) expect(adopted).not.toBe(retained);
          else expect(adopted).toBe(retained);
          retained = adopted;
          if (mode === "delegated") expect(writes.count).toBeGreaterThan(0);
          else expect(writes.count).toBe(0);
          writes.count = 0;
          const appendedId = `refresh-${refreshIndex++}`;
          await change(() =>
            h.update(
              (items) =>
                (prepend
                  ? createCompilerKeyedArrayPrepend(items, [
                      { id: appendedId, label: "After refresh" },
                      ...items,
                    ])
                  : createCompilerKeyedArrayAppend(items, [
                      ...items,
                      { id: appendedId, label: "After refresh" },
                    ])) as Item[],
            ),
          );
          expect(writes.count).toBe(
            mode === "delegated" ? (prepend ? container.querySelectorAll("button").length : 1) : 0,
          );
          if (mode !== "empty") {
            await change(() =>
              container.querySelector<HTMLButtonElement>(`[data-key="${appendedId}"]`)!.click(),
            );
            expect(h.calls.at(-1)).toBe(
              `After refresh:${prepend ? 0 : container.querySelectorAll("button").length - 1}:${appendedId}`,
            );
          }
          writes.count = 0;
          await change(() => h.update((items) => items.slice(1)));
          expect(container.querySelector('[data-key="32"]')).toBe(retained);
          if (mode !== "delegated") expect(writes.count).toBe(0);
          // Removing the just-prepended row leaves all original React fibers live.
          // Appending then removing the first original row does invalidate them.
          staleReactRows = mode !== "direct" && !prepend;
          const row = container.querySelector<HTMLButtonElement>("button")!;
          if (mode !== "empty") {
            await change(() => row.click());
            expect(h.calls.at(-1)).toBe(`${row.textContent}:0:${row.dataset.key}`);
          }
        }
      },
    );

    it(`${reactivity}: re-adopts ordinary callbacks when delegation toggles through props`, async () => {
      const h = harness(reactivity);
      const Table = createCompiledComponent(h.definition("direct"));
      const container = document.createElement("div");
      document.body.append(container);
      const root = createRoot(container);
      roots.push(root);
      const writes = trackRowIndexWrites();
      for (const mode of ["direct", "delegated", "direct", "delegated"] as const) {
        writes.count = 0;
        await act(async () => root.render(<Table mode={mode} />));
        if (mode === "delegated") expect(writes.count).toBeGreaterThan(0);
        else expect(writes.count).toBe(0);
        writes.count = 0;
        await change(() => h.update((items) => items.slice(1)));
        if (mode === "direct") expect(writes.count).toBe(0);
        const row = container.querySelector<HTMLButtonElement>("button")!;
        await change(() => row.click());
        expect(h.calls.at(-1)).toBe(`${row.textContent}:0:${row.dataset.key}`);
      }
    });
  }
});

describe("keyed-row delegated element index through the general reconcile", () => {
  for (const reactivity of ["static", "hybrid"] as const) {
    it(`${reactivity}: keeps surviving rows' entries across an unhinted swap`, async () => {
      const h = harness(reactivity);
      const Table = createCompiledComponent(h.definition("delegated"));
      const container = document.createElement("div");
      document.body.append(container);
      const root = createRoot(container);
      roots.push(root);
      await act(async () => root.render(<Table />));
      const writes = trackRowIndexWrites();

      await change(() =>
        h.update((items) => {
          const next = items.slice();
          [next[1], next[62]] = [next[62], next[1]];
          return next;
        }),
      );
      expect(writes.count).toBe(0);
      const rows = [...container.querySelectorAll<HTMLButtonElement>("button")];
      expect(rows[1].dataset.key).toBe("62");
      await change(() => {
        rows[1].click();
        rows[62].click();
        rows[5].click();
      });
      expect(h.calls).toEqual(["Row 62:1:62", "Row 1:62:1", "Row 5:5:5"]);
    });
  }
});
