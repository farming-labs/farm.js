import React, { act, StrictMode, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
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
function view(visible: boolean, count: number) {
  return (
    <section>
      <aside>Extra</aside>
      {visible ? <article>{count >= 0 ? <em>{count}</em> : null}</article> : null}
    </section>
  );
}

describe("conditional fallback lifecycle replay", () => {
  for (const kind of ["HostConditional", "ConditionalRanges"] as const) {
    it.each(["static", "hybrid"] as const)(
      `restores ${kind} nested subscriptions in %s mode`,
      async (reactivity) => {
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
                block: {
                  kind: "conditional-ranges",
                  id: 1,
                  trailing: 0,
                  ranges: [{ before: 0, test: () => Number(state[1].get()) >= 0, truthy: nested }],
                },
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
                return view(Boolean(state[0].get()), Number(state[1].get()));
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
          ],
        });
        function Control() {
          const [model, setModel] = useState<(boolean | number)[]>([true, 0]);
          updateControl = (index, value) =>
            setModel((previous) => previous.map((entry, slot) => (slot === index ? value : entry)));
          return <main>{view(Boolean(model[0]), Number(model[1]))}</main>;
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
          expect([...owner!.blockRefreshListeners.keys()].sort()).toEqual([0, 1]);
          expect(owners).toBe(initialOwners);
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
          expect([...owner!.blockRefreshListeners.keys()].sort()).toEqual([0, 1]);
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
});
