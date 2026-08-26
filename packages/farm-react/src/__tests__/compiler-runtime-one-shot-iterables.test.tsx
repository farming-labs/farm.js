import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { compileReactModule } from "../compiler";
import { createCompiledComponent } from "../compiler-runtime";
import { normalizeReactCompilerOptions } from "../index";
import { List } from "../list";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

interface Item {
  id: string;
  label: string;
}

const roots: Array<{ unmount(): void }> = [];

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.replaceChildren();
});

function oneShotItems(
  items: readonly Item[] = [
    { id: "a", label: "Alpha" },
    { id: "b", label: "Beta" },
  ],
): IterableIterator<Item> {
  return (function* () {
    yield* items;
  })();
}

describe("one-shot iterable lists", () => {
  it("keeps rows when React renders the public List without compiler adoption", async () => {
    const items = oneShotItems();

    function Baseline() {
      return (
        <section>
          <List each={items} by={(item) => item.id}>
            {(item) => <li>{item.label}</li>}
          </List>
        </section>
      );
    }

    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);

    await act(async () => root.render(<Baseline />));

    expect([...container.querySelectorAll("li")].map((row) => row.textContent)).toEqual([
      "Alpha",
      "Beta",
    ]);

    await act(async () => root.render(<Baseline />));

    expect([...container.querySelectorAll("li")].map((row) => row.textContent)).toEqual([
      "Alpha",
      "Beta",
    ]);
  });

  it("selects the host-owned keyed-row path for a public List backed by a generator", async () => {
    const result = await compileReactModule(
      `
        import { useState } from "react";
        import { List } from "@farm.js/react/list";

        const items = (function* () {
          yield { id: "a", label: "Alpha" };
          yield { id: "b", label: "Beta" };
        })();

        export function Inventory() {
          const [count, setCount] = useState(0);
          return (
            <section>
              <button onClick={() => setCount(count + 1)}>{count}</button>
              <List each={items} by={(item) => item.id}>
                {(item) => <li>{item.label}</li>}
              </List>
            </section>
          );
        }
      `,
      "/app/Inventory.tsx",
      normalizeReactCompilerOptions(true),
    );

    expect(result.compiled).toEqual(["Inventory"]);
    expect(result.code).toContain("farmBlocks.KeyedRanges");
  });

  it("keeps rows rendered from a one-shot iterable after adoption", async () => {
    const items = oneShotItems();
    let replaceItems: ((next: Iterable<Item>) => void) | undefined;
    const Panel = createCompiledComponent({
      displayName: "OneShotList",
      initialize: () => [items],
      render(_props: Record<string, never>, state, blocks) {
        const KeyedRanges = blocks.KeyedRanges;
        const source = state[0].get() as Iterable<Item>;
        replaceItems = (next) => state[0].set(next);
        return (
          <KeyedRanges
            id={0}
            render={() => (
              <section>
                <button>0</button>
                <List each={source} by={(item) => item.id}>
                  {(item) => <li>{item.label}</li>}
                </List>
              </section>
            )}
            ranges={[
              {
                before: 1,
                items: () => state[0].get() as Iterable<Item>,
                rowKey: (item) => (item as Item).id,
                create: (item) => ({
                  kind: "element",
                  tag: "li",
                  attributes: [],
                  styles: [],
                  children: [(item as Item).label],
                }),
                bindings: [],
              },
            ]}
            trailing={0}
          />
        );
      },
      bindings: [{ kind: "block", id: 0, dependencies: [0] }],
    });

    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);

    await act(async () => root.render(<Panel />));

    expect([...container.querySelectorAll("li")].map((row) => row.textContent)).toEqual([
      "Alpha",
      "Beta",
    ]);

    await act(async () => {
      replaceItems?.(
        oneShotItems([
          { id: "c", label: "Charlie" },
          { id: "d", label: "Delta" },
        ]),
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect([...container.querySelectorAll("li")].map((row) => row.textContent)).toEqual([
      "Charlie",
      "Delta",
    ]);
  });
});
