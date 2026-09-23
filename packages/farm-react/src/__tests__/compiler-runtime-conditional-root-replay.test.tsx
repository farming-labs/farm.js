import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCompiledComponent, type CompilerCell } from "../compiler-runtime";

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

describe("conditional root registration during lifecycle replay", () => {
  it.each(["static", "hybrid"] as const)(
    "preserves %s path boundaries and releases them on real detachments",
    async (reactivity) => {
      interface Lifecycle {
        componentWillUnmount(): void;
        componentDidMount(): void;
      }
      interface Owner extends Lifecycle {
        blockRoots: Map<number, Element>;
        blockRootElements: Set<Element>;
        blockRefreshListeners: Map<number, unknown>;
      }
      let owner: Owner;
      let block: Lifecycle;
      let cells: readonly CompilerCell[];
      let executions = 0;
      const Panel = createCompiledComponent({
        displayName: "ConditionalRootReplay",
        reactivity,
        initialize: () => [true, 0],
        render(_props: Record<string, never>, state, blocks) {
          cells = state;
          executions += 1;
          return (
            <main>
              {React.createElement(blocks.Conditional, {
                id: 0,
                ref: (instance: unknown) => {
                  if (instance) block = instance as Lifecycle;
                },
                render: () => (state[0].get() ? <strong>Branch</strong> : null),
              } as React.ComponentProps<typeof blocks.Conditional>)}
              <output>{Number(state[1].get())}</output>
            </main>
          );
        },
        bindings: [
          { kind: "block", id: 0, dependencies: [0] },
          {
            kind: "text",
            path: [0],
            dependencies: [1],
            tracking: "dynamic",
            read: (_props, state) => state[1].get(),
          },
        ],
      });
      const target = document.createElement("div");
      document.body.append(target);
      const root = createRoot(target);
      roots.add(root);
      await act(async () =>
        root.render(
          React.createElement(Panel, {
            ref: (instance: unknown) => {
              if (instance) owner = instance as Owner;
            },
          } as React.Attributes),
        ),
      );
      const branch = target.querySelector("strong")!;
      const output = target.querySelector("output")!;
      const initialExecutions = executions;
      for (let replay = 1; replay <= 3; replay += 1) {
        // React 18 leaves refs attached while replaying class lifecycles.
        // The packaged matrix separately exercises real StrictMode in both versions.
        await act(async () => {
          block.componentWillUnmount();
          owner.componentWillUnmount();
          expect(owner.blockRefreshListeners.size).toBe(0);
          block.componentDidMount();
          owner.componentDidMount();
          cells[1].set(replay);
        });
        expect(owner!.blockRoots.get(0) === branch).toBe(true);
        expect(owner!.blockRootElements.has(branch)).toBe(true);
        expect(owner!.blockRefreshListeners.size).toBe(1);
        expect(branch.textContent).toBe("Branch");
        expect(output.textContent).toBe(String(replay));
        expect(executions).toBe(initialExecutions);
      }
      await act(async () => cells[0].set(false));
      expect(owner!.blockRoots.size).toBe(0);
      expect(owner!.blockRootElements.size).toBe(0);
      await act(async () => {
        cells[0].set(true);
        cells[1].set(4);
      });
      expect(owner!.blockRoots.size).toBe(1);
      expect(owner!.blockRootElements.has(branch)).toBe(false);
      expect(target.querySelector("strong")?.textContent).toBe("Branch");
      expect(target.querySelector("output") === output).toBe(true);
      expect(output.textContent).toBe("4");
      await act(async () => {
        cells[1].set(99);
        root.unmount();
        roots.delete(root);
      });
      await act(async () => cells[1].set(100));
      expect(owner!.blockRoots.size).toBe(0);
      expect(owner!.blockRootElements.size).toBe(0);
      expect(owner!.blockRefreshListeners.size).toBe(0);
      expect(output.textContent).toBe("4");
    },
  );
});
