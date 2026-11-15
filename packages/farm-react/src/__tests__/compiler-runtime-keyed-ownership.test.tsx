import React, { StrictMode, act } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCompiledComponent, type CompiledComponentDefinition } from "../compiler-runtime";

interface Item {
  id: string;
  label: string;
}
type Mode = "delegated" | "direct";
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
async function update(fn: () => void) {
  await act(async () => {
    fn();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function harness(reactivity: "static" | "hybrid") {
  const initial: Item[] = [
    { id: "a", label: "Alpha" },
    { id: "b", label: "Beta" },
    { id: "c", label: "Gamma" },
  ];
  const calls: string[] = [];
  let setItems: (items: Item[]) => void = () => undefined;
  const hmrId = `ownership-${Math.random()}`;
  function definition(
    mode: Mode,
    prefix = "",
    blockId = 0,
  ): CompiledComponentDefinition<{ mode?: Mode }> {
    return {
      displayName: "OwnershipRows",
      hmrId,
      stateSignature: "1",
      reactivity,
      initialize: () => [initial],
      render(props, state, blocks) {
        const items = () => state[0].get() as Item[];
        setItems = (next) => state[0].set(next);
        return (
          <section>
            <blocks.KeyedRows
              id={blockId}
              items={items}
              rowKey={(item) => (item as Item).id}
              delegateEvents={(props.mode ?? mode) === "delegated"}
              events={[
                {
                  name: "onClick",
                  path: [1],
                  invoke: (item, index, event) => {
                    calls.push(
                      `${prefix}${(item as Item).label}:${index}:${(event.currentTarget as HTMLElement).tagName}`,
                    );
                  },
                },
              ]}
              create={(item) => ({
                kind: "element",
                tag: "li",
                attributes: [{ name: "data-key", value: (item as Item).id }],
                styles: [],
                children: [
                  {
                    kind: "element",
                    tag: "input",
                    attributes: [{ name: "value", value: "draft" }],
                    styles: [],
                    children: [],
                  },
                  {
                    kind: "element",
                    tag: "button",
                    attributes: [],
                    styles: [],
                    children: [prefix + (item as Item).label],
                  },
                ],
              })}
              bindings={[
                { kind: "text", path: [1], read: (item) => [prefix + (item as Item).label] },
              ]}
              render={(event) => (
                <ul>
                  {items().map((item, index) => (
                    <li key={item.id} data-key={item.id}>
                      <input defaultValue="draft" />
                      <button onClick={event(item, index, 0)}>{prefix + item.label}</button>
                    </li>
                  ))}
                </ul>
              )}
            />
          </section>
        );
      },
      bindings: [{ kind: "block", id: blockId, dependencies: [0] }],
    };
  }
  return { initial, calls, definition, setItems: (items: Item[]) => setItems(items) };
}

async function mount(Table: React.ComponentType<{ mode?: Mode }>, hydrate: boolean) {
  const container = document.createElement("div");
  document.body.append(container);
  const content = (
    <StrictMode>
      <Table />
    </StrictMode>
  );
  if (hydrate) container.innerHTML = renderToString(content);
  const serverRows = [...container.querySelectorAll("li")];
  const errors: unknown[] = [];
  let root!: Root;
  await act(async () => {
    root = hydrate
      ? hydrateRoot(container, content, { onRecoverableError: (error) => errors.push(error) })
      : createRoot(container);
    roots.push(root);
    if (!hydrate) root.render(content);
  });
  expect(errors).toEqual([]);
  if (hydrate) expect([...container.querySelectorAll("li")]).toEqual(serverRows);
  return { root, container };
}

describe("keyed-row React ownership handoff", () => {
  for (const reactivity of ["static", "hybrid"] as const) {
    for (const hydrate of [false, true]) {
      for (const handoff of ["props", "refresh"] as const) {
        it.each(["remove", "append", "reorder", "clear", "replace"] as const)(
          `${reactivity}/hydrate=${hydrate}/${handoff}: safely hands off after %s`,
          async (operation) => {
            const h = harness(reactivity);
            const Table = createCompiledComponent(h.definition("delegated"));
            const { root, container } = await mount(Table, hydrate);
            const originalContainer = container.querySelector("ul");
            const retained = container.querySelector('[data-key="b"]');
            const next =
              operation === "remove"
                ? h.initial.slice(1)
                : operation === "append"
                  ? [...h.initial, { id: "d", label: "Delta" }]
                  : operation === "reorder"
                    ? [...h.initial].reverse()
                    : operation === "clear"
                      ? []
                      : [{ id: "d", label: "Delta" }, ...h.initial.slice(1)];
            await update(() => h.setItems(next));
            expect(container.querySelector("ul")).toBe(originalContainer);
            if (operation !== "clear")
              expect(container.querySelector('[data-key="b"]')).toBe(retained);
            await update(() => {
              if (handoff === "refresh")
                expect(createCompiledComponent(h.definition("direct", "New: ", 1))).toBe(Table);
              else
                root.render(
                  <StrictMode>
                    <Table mode="direct" />
                  </StrictMode>,
                );
            });
            // Compiler mutations are not reflected in React's old child fibers.
            // A stale host container must be replaced before React reconciles it.
            expect(container.querySelector("ul")).not.toBe(originalContainer);
            expect(
              [...container.querySelectorAll<HTMLElement>("li")].map((row) => row.dataset.key),
            ).toEqual(next.map((item) => item.id));
            const prefix = handoff === "refresh" ? "New: " : "";
            expect(
              [...container.querySelectorAll("button")].map((button) => button.textContent),
            ).toEqual(next.map((item) => prefix + item.label));
            await update(() => h.setItems([{ id: "b", label: "Latest" }]));
            const input = container.querySelector("input")!;
            input.value = "user draft";
            input.focus();
            input.setSelectionRange(2, 6);
            const adopted = container.querySelector("ul");
            await update(() => h.setItems([{ id: "b", label: "Current" }]));
            expect(container.querySelector("ul")).toBe(adopted);
            expect(container.querySelector("input")).toBe(input);
            expect(input.value).toBe("user draft");
            expect(document.activeElement).toBe(input);
            expect([input.selectionStart, input.selectionEnd]).toEqual([2, 6]);
            await update(() => container.querySelector("button")!.click());
            expect(h.calls.at(-1)).toBe(`${prefix}Current:0:BUTTON`);
            // Moving back to delegation does not remount a current React tree.
            await update(() => {
              if (handoff === "refresh")
                createCompiledComponent(h.definition("delegated", prefix, 1));
              else
                root.render(
                  <StrictMode>
                    <Table mode="delegated" />
                  </StrictMode>,
                );
            });
            expect(container.querySelector("ul")).toBe(adopted);
            expect(container.querySelector("input")).toBe(input);
            await update(() => container.querySelector("button")!.click());
            expect(h.calls.at(-1)).toBe(`${prefix}Current:0:BUTTON`);
          },
        );

        it(`${reactivity}/hydrate=${hydrate}/${handoff}: preserves current rows, focus and selection`, async () => {
          const h = harness(reactivity);
          const Table = createCompiledComponent(h.definition("delegated"));
          const { root, container } = await mount(Table, hydrate);
          const original = container.querySelector("ul");
          const input = container.querySelector<HTMLInputElement>('[data-key="b"] input')!;
          input.value = "user draft";
          input.focus();
          input.setSelectionRange(2, 6);
          await update(() =>
            h.setItems(h.initial.map((item) => ({ ...item, label: item.label + "!" }))),
          );
          await update(() => {
            if (handoff === "refresh") createCompiledComponent(h.definition("direct", "New: "));
            else
              root.render(
                <StrictMode>
                  <Table mode="direct" />
                </StrictMode>,
              );
          });
          expect(container.querySelector("ul")).toBe(original);
          expect(container.querySelector('[data-key="b"] input')).toBe(input);
          expect(input.value).toBe("user draft");
          expect(document.activeElement).toBe(input);
          expect([input.selectionStart, input.selectionEnd]).toEqual([2, 6]);
          await update(() =>
            container.querySelector<HTMLButtonElement>('[data-key="b"] button')!.click(),
          );
          expect(h.calls.at(-1)).toBe(`${handoff === "refresh" ? "New: " : ""}Beta!:1:BUTTON`);
        });
      }
    }
  }
});
