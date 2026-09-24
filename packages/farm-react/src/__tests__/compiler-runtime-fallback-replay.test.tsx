import React, { act, StrictMode, useState } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createCompiledComponent,
  type CompilerCell,
  type CompilerHostElement,
} from "../compiler-runtime";

const roots = new Set<Root>();
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(async () => {
  await act(async () => {
    for (const root of roots) root.unmount();
  });
  roots.clear();
  document.body.replaceChildren();
});

const host = (
  tag: string,
  children: CompilerHostElement["children"] = [],
): CompilerHostElement => ({
  kind: "element",
  tag,
  attributes: [],
  styles: [],
  children,
});
function LocalCounter() {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount((previous) => previous + 1)}>Local: {count}</button>;
}

function view(visible: boolean, count: number, descendants: boolean) {
  return (
    <section>
      <aside>
        {descendants ? <span>Extra</span> : null}
        <LocalCounter />
        <input aria-label="Text" defaultValue="draft" />
        <textarea aria-label="Note" defaultValue="draft" />
        <select aria-label="Choice" defaultValue="a">
          <option value="a">A</option>
          <option value="b">B</option>
        </select>
      </aside>
      {visible ? <article>{count >= 0 ? <em>{count}</em> : null}</article> : null}
    </section>
  );
}

describe("conditional fallback lifecycle replay", () => {
  for (const kind of ["HostConditional", "ConditionalRanges"] as const) {
    it.each(
      (["static", "hybrid"] as const).flatMap((reactivity) =>
        [true, false].map((descendants) => ({ reactivity, descendants })),
      ),
    )(
      `${kind} fallback: $reactivity, nested blocks: $descendants`,
      async ({ reactivity, descendants }) => {
        interface BlockProbe {
          state: { fallback: boolean };
          componentWillUnmount(): void;
          componentDidMount(): void;
        }
        let block: BlockProbe;
        let owner: { blockRefreshListeners: Map<number, unknown> };
        let cells: readonly CompilerCell[];
        let updateControl: (index: number, value: boolean | number) => void;
        let owners = 0;
        let renders = 0;
        const Panel = createCompiledComponent({
          displayName: "FallbackReplay",
          reactivity,
          initialize: () => [true, 0],
          render(_props: Record<string, never>, state, blocks) {
            owners += 1;
            cells = state;
            const nested = { create: () => host("em", [Number(state[1].get())]), bindings: [] };
            const branch = {
              create: (): CompilerHostElement => ({
                ...host("article", Number(state[1].get()) >= 0 ? [nested.create()] : []),
                block: descendants
                  ? {
                      kind: "conditional-ranges",
                      id: 1,
                      trailing: 0,
                      ranges: [
                        { before: 0, test: () => Number(state[1].get()) >= 0, truthy: nested },
                      ],
                    }
                  : undefined,
              }),
              bindings: [],
            };
            const condition = { before: 0, test: () => state[0].get(), truthy: branch };
            const props = {
              id: 0,
              ref: (instance: unknown) => {
                if (instance) block = instance as BlockProbe;
              },
              // The undeclared aside forces complete React fallback for both block types.
              render: () => {
                renders += 1;
                return view(Boolean(state[0].get()), Number(state[1].get()), descendants);
              },
            };
            return (
              <main>
                {kind === "HostConditional"
                  ? React.createElement(blocks.HostConditional, { ...props, ...condition })
                  : React.createElement(blocks.ConditionalRanges, {
                      ...props,
                      ranges: [condition],
                      trailing: 0,
                    })}
              </main>
            );
          },
          bindings: descendants
            ? [
                { kind: "block", id: 0, dependencies: [0] },
                { kind: "block", id: 1, parent: 0, dependencies: [1] },
              ]
            : [{ kind: "block", id: 0, dependencies: [0, 1] }],
        });
        function Control() {
          const [model, setModel] = useState<(boolean | number)[]>([true, 0]);
          updateControl = (index, value) =>
            setModel((previous) => previous.map((entry, slot) => (slot === index ? value : entry)));
          return <main>{view(Boolean(model[0]), Number(model[1]), descendants)}</main>;
        }
        const target = document.createElement("div");
        const control = document.createElement("div");
        document.body.append(target, control);
        const root = createRoot(target);
        const controlRoot = createRoot(control);
        roots.add(root);
        roots.add(controlRoot);
        await act(async () => {
          root.render(
            <StrictMode>
              {React.createElement(Panel, {
                ref: (instance: unknown) => {
                  if (instance) owner = instance as typeof owner;
                },
              } as React.Attributes)}
            </StrictMode>,
          );
          controlRoot.render(
            <StrictMode>
              <Control />
            </StrictMode>,
          );
        });
        const initialOwners = owners;
        expect(block!.state.fallback).toBe(true);
        await act(async () => {
          target.querySelector("button")!.click();
          control.querySelector("button")!.click();
        });
        const container = target.querySelector("section");
        const input = target.querySelector("input")!;
        const textarea = target.querySelector("textarea")!;
        const select = target.querySelector("select")!;
        for (const surface of [target, control]) {
          surface.querySelector("input")!.value = "typed text";
          surface.querySelector("textarea")!.value = "typed note";
          surface.querySelector("select")!.value = "b";
        }
        input.focus();
        input.setSelectionRange(1, 4, "backward");
        const checkDomState = () => {
          expect(target.querySelector("section") === container).toBe(true);
          expect(target.querySelector("input") === input).toBe(true);
          expect(target.querySelector("textarea") === textarea).toBe(true);
          expect(target.querySelector("select") === select).toBe(true);
          expect(input.value).toBe(control.querySelector("input")!.value);
          expect(textarea.value).toBe(control.querySelector("textarea")!.value);
          expect(select.value).toBe(control.querySelector("select")!.value);
          expect(target.querySelector("button")?.textContent).toBe("Local: 1");
          expect(document.activeElement === input).toBe(true);
          expect([input.selectionStart, input.selectionEnd, input.selectionDirection]).toEqual([
            1,
            4,
            "backward",
          ]);
        };
        // A descendant-only update must work before an outer update can mask the lost listener.
        for (const [index, value] of [
          [1, 1],
          [0, false],
          [1, 2],
          [0, true],
          [1, -1],
          [1, 3],
        ] as const) {
          await act(async () => {
            cells[index].set(value);
            updateControl(index, value);
          });
          expect(target.innerHTML).toBe(control.innerHTML);
          expect([...owner!.blockRefreshListeners.keys()].sort()).toEqual(
            descendants && Boolean(cells[0].get()) ? [0, 1] : [0],
          );
          expect(owners).toBe(initialOwners);
          checkDomState();
        }
        // Replay an already committed fallback as well as the initial pending fallback.
        for (const count of [4, 5, 6]) {
          await act(async () => {
            block.componentWillUnmount();
            expect(owner.blockRefreshListeners.size).toBe(0);
            block.componentDidMount();
            cells[1].set(count);
            updateControl(1, count);
          });
          expect(target.innerHTML).toBe(control.innerHTML);
          expect([...owner!.blockRefreshListeners.keys()].sort()).toEqual(
            descendants ? [0, 1] : [0],
          );
          checkDomState();
        }
        const beforeUnmount = { owners, renders };
        const detached = target.firstElementChild!;
        await act(async () => {
          cells[1].set(99);
          root.unmount();
          roots.delete(root);
        });
        const detachedHTML = detached.outerHTML;
        await act(async () => cells[1].set(100));
        expect(owner!.blockRefreshListeners.size).toBe(0);
        expect({ owners, renders }).toEqual(beforeUnmount);
        expect(detached.outerHTML).toBe(detachedHTML);
        expect(detached.isConnected).toBe(false);
      },
    );
  }

  for (const kind of ["HostConditional", "ConditionalRanges"] as const) {
    it.each(
      (["static", "hybrid"] as const).flatMap((reactivity) =>
        (["mount", "hydrate"] as const).map((lifecycle) => ({ reactivity, lifecycle })),
      ),
    )(
      `${kind} fallback rebinds changing descendant listeners: $reactivity, $lifecycle`,
      async ({ reactivity, lifecycle }) => {
        let owner: { blockRefreshListeners: Map<number, unknown> };
        let cells: readonly CompilerCell[];
        let renders = 0;
        const Panel = createCompiledComponent({
          displayName: "FallbackListenerRebind",
          reactivity,
          initialize: () => [false, 1, 10],
          render(_props: Record<string, never>, state, blocks) {
            cells = state;
            const readNestedId = () => (state[0].get() ? 2 : 1);
            const branch = {
              create: (): CompilerHostElement => {
                const nestedId = readNestedId();
                const nested = {
                  create: () => host("span", [Number(state[nestedId].get())]),
                  bindings: [],
                };
                return {
                  ...host("article", [nested.create()]),
                  block: {
                    kind: "conditional-ranges",
                    id: nestedId,
                    trailing: 0,
                    ranges: [{ before: 0, test: () => true, truthy: nested }],
                  },
                };
              },
              bindings: [],
            };
            const condition = { before: 0, test: () => true, truthy: branch };
            const props = {
              id: 0,
              // The undeclared aside deliberately transfers this block to React.
              render: () => {
                renders += 1;
                const nestedId = readNestedId();
                return (
                  <section>
                    <aside>React fallback</aside>
                    <article>
                      <span data-descendant={nestedId}>{Number(state[nestedId].get())}</span>
                    </article>
                  </section>
                );
              },
            };
            return (
              <main>
                {kind === "HostConditional"
                  ? React.createElement(blocks.HostConditional, { ...props, ...condition })
                  : React.createElement(blocks.ConditionalRanges, {
                      ...props,
                      ranges: [condition],
                      trailing: 0,
                    })}
              </main>
            );
          },
          bindings: [
            { kind: "block", id: 0, dependencies: [0] },
            { kind: "block", id: 1, parent: 0, dependencies: [1] },
            { kind: "block", id: 2, parent: 0, dependencies: [2] },
          ],
        });
        const tree = React.createElement(Panel, {
          ref: (instance: unknown) => {
            if (instance) owner = instance as typeof owner;
          },
        } as React.Attributes);
        const container = document.createElement("div");
        document.body.append(container);
        if (lifecycle === "hydrate") container.innerHTML = renderToString(tree);
        const root = lifecycle === "hydrate" ? hydrateRoot(container, tree) : createRoot(container);
        roots.add(root);
        await act(async () => {
          if (lifecycle === "mount") root.render(tree);
        });

        expect([...owner!.blockRefreshListeners.keys()].sort()).toEqual([0, 1]);
        expect(container.querySelector("span")?.textContent).toBe("1");

        await act(async () => cells[0].set(true));
        expect([...owner!.blockRefreshListeners.keys()].sort()).toEqual([0, 2]);
        expect(container.querySelector("span")?.getAttribute("data-descendant")).toBe("2");
        expect(container.querySelector("span")?.textContent).toBe("10");

        const beforeCurrentUpdate = renders;
        await act(async () => cells[2].set(11));
        expect(renders).toBeGreaterThan(beforeCurrentUpdate);
        expect(container.querySelector("span")?.textContent).toBe("11");

        const beforeStaleUpdate = renders;
        await act(async () => cells[1].set(2));
        expect(renders).toBe(beforeStaleUpdate);
        expect(container.querySelector("span")?.textContent).toBe("11");

        await act(async () => cells[0].set(false));
        expect([...owner!.blockRefreshListeners.keys()].sort()).toEqual([0, 1]);
        await act(async () => cells[1].set(3));
        expect(container.querySelector("span")?.textContent).toBe("3");

        const beforeUnmountedUpdates = renders;
        await act(async () => root.unmount());
        roots.delete(root);
        expect(owner!.blockRefreshListeners.size).toBe(0);
        await act(async () => {
          cells[1].set(4);
          cells[2].set(12);
        });
        expect(renders).toBe(beforeUnmountedUpdates);
      },
    );
  }

  for (const kind of ["HostConditional", "ConditionalRanges"] as const) {
    it.each(
      (["static", "hybrid"] as const).flatMap((reactivity) =>
        (["mount", "hydrate"] as const).map((lifecycle) => ({ reactivity, lifecycle })),
      ),
    )(
      `${kind} fallback subscribes only to active descendants: $reactivity, $lifecycle`,
      async ({ reactivity, lifecycle }) => {
        let owner: { blockRefreshListeners: Map<number, unknown> };
        let cells: readonly CompilerCell[];
        let renders = 0;
        const creates = {
          truthy: 0,
          falsy: 0,
          nestedTruthy: 0,
          nestedFalsy: 0,
        };
        const Panel = createCompiledComponent({
          displayName: "FallbackActiveDescendants",
          reactivity,
          initialize: () => [true, 1, 10],
          render(_props: Record<string, never>, state, blocks) {
            cells = state;
            const makeBranch = (
              key: "truthy" | "falsy",
              nestedId: 1 | 2,
            ): { create(): CompilerHostElement; bindings: [] } => {
              const nestedTruthy = {
                create: () => {
                  creates.nestedTruthy += 1;
                  return host("em", [Number(state[nestedId].get())]);
                },
                bindings: [],
              };
              const nestedFalsy = {
                create: () => {
                  creates.nestedFalsy += 1;
                  return host("strong", ["hidden"]);
                },
                bindings: [],
              };
              return {
                create: () => {
                  creates[key] += 1;
                  return {
                    ...host("article", [nestedTruthy.create()]),
                    block: {
                      kind: "conditional-ranges",
                      id: nestedId,
                      ranges: [
                        {
                          before: 0,
                          test: () => true,
                          truthy: nestedTruthy,
                          falsy: nestedFalsy,
                        },
                      ],
                      trailing: 0,
                    },
                  };
                },
                bindings: [],
              };
            };
            const truthy = makeBranch("truthy", 1);
            const falsy = makeBranch("falsy", 2);
            const condition = {
              before: 0,
              test: () => Boolean(state[0].get()),
              truthy,
              falsy,
            };
            const props = {
              id: 0,
              // The undeclared aside deliberately transfers this block to React.
              render: () => {
                renders += 1;
                const visible = Boolean(state[0].get());
                const nestedId = visible ? 1 : 2;
                return (
                  <section>
                    <aside>React fallback</aside>
                    <article>
                      <em data-descendant={nestedId}>{Number(state[nestedId].get())}</em>
                    </article>
                  </section>
                );
              },
            };
            return (
              <main>
                {kind === "HostConditional"
                  ? React.createElement(blocks.HostConditional, { ...props, ...condition })
                  : React.createElement(blocks.ConditionalRanges, {
                      ...props,
                      ranges: [condition],
                      trailing: 0,
                    })}
              </main>
            );
          },
          bindings: [
            { kind: "block", id: 0, dependencies: [0] },
            { kind: "block", id: 1, parent: 0, dependencies: [1] },
            { kind: "block", id: 2, parent: 0, dependencies: [2] },
          ],
        });
        const container = document.createElement("div");
        document.body.append(container);
        const tree = React.createElement(Panel, {
          ref: (instance: unknown) => {
            if (instance) owner = instance as typeof owner;
          },
        } as React.Attributes);
        if (lifecycle === "hydrate") container.innerHTML = renderToString(tree);
        const root = lifecycle === "hydrate" ? hydrateRoot(container, tree) : createRoot(container);
        roots.add(root);
        await act(async () => {
          if (lifecycle === "mount") root.render(tree);
        });

        expect([...owner!.blockRefreshListeners.keys()].sort()).toEqual([0, 1]);
        expect(creates.truthy).toBeGreaterThan(0);
        expect(creates.nestedTruthy).toBeGreaterThan(0);
        expect(creates.falsy).toBe(0);
        expect(creates.nestedFalsy).toBe(0);

        const outerListener = owner!.blockRefreshListeners.get(0);
        creates.truthy = 0;
        creates.nestedTruthy = 0;
        await act(async () => cells[0].set(false));
        expect([...owner!.blockRefreshListeners.keys()].sort()).toEqual([0, 2]);
        expect(owner!.blockRefreshListeners.get(0)).toBe(outerListener);
        expect(creates.falsy).toBeGreaterThan(0);
        expect(creates.nestedFalsy).toBe(0);
        expect(creates.truthy).toBe(0);
        expect(creates.nestedTruthy).toBeGreaterThan(0);

        const activeListener = owner!.blockRefreshListeners.get(2);
        const beforeActiveUpdate = renders;
        await act(async () => cells[2].set(11));
        expect(renders).toBeGreaterThan(beforeActiveUpdate);
        expect(container.querySelector("em")?.textContent).toBe("11");
        expect(owner!.blockRefreshListeners.get(2)).toBe(activeListener);

        const beforeInactiveUpdate = renders;
        await act(async () => cells[1].set(2));
        expect(renders).toBe(beforeInactiveUpdate);
        expect(container.querySelector("em")?.textContent).toBe("11");

        await act(async () => cells[0].set(true));
        expect([...owner!.blockRefreshListeners.keys()].sort()).toEqual([0, 1]);
        expect(owner!.blockRefreshListeners.get(0)).toBe(outerListener);
        expect(container.querySelector("em")?.textContent).toBe("2");

        const beforeFormerBranchUpdate = renders;
        await act(async () => cells[2].set(12));
        expect(renders).toBe(beforeFormerBranchUpdate);
        expect(container.querySelector("em")?.textContent).toBe("2");
      },
    );
  }
});
