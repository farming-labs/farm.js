import React, { StrictMode, useEffect, useState } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCompiledComponent } from "../compiler-runtime";

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

async function flushCompilerUpdates(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function click(container: Element, selector: string): void {
  const target = container.querySelector<HTMLElement>(selector);
  if (!target) throw new Error(`Missing test target: ${selector}`);
  target.click();
}

describe("compiled React composable block runtime", () => {
  it("coalesces nested refreshes and cleans subscriptions up with their outer branch", async () => {
    let ownerRenders = 0;
    let outerRenders = 0;
    let summaryRenders = 0;
    let listRenders = 0;
    let nestedRenders = 0;
    let summaryMounts = 0;
    let summaryUnmounts = 0;

    function Summary({ count }: { count: number }) {
      summaryRenders += 1;
      useEffect(() => {
        summaryMounts += 1;
        return () => {
          summaryUnmounts += 1;
        };
      }, []);
      return <output data-summary>{count}</output>;
    }

    const Dashboard = createCompiledComponent({
      displayName: "NestedComposableDashboard",
      initialize: () => [
        true,
        0,
        [
          { id: "a", label: "Alpha" },
          { id: "b", label: "Beta" },
        ],
        true,
      ],
      render(_props: Record<string, never>, state, blocks) {
        ownerRenders += 1;
        const Conditional = blocks.Conditional;
        const Component = blocks.Component;
        const KeyedList = blocks.KeyedList;
        const updateInner = () => {
          state[1].set((value) => Number(value) + 1);
          state[2].set((value) => [...(value as Item[])].reverse());
          state[3].set((value) => !value);
        };
        return (
          <main>
            <button data-action="inner" onClick={updateInner}>
              Inner
            </button>
            <button
              data-action="hide-update"
              onClick={() => {
                state[0].set(false);
                updateInner();
              }}
            >
              Hide and update
            </button>
            <button data-action="hidden-update" onClick={updateInner}>
              Update while hidden
            </button>
            <button data-action="show" onClick={() => state[0].set(true)}>
              Show
            </button>
            <h1 data-static>Static sibling</h1>
            <Conditional
              id={0}
              render={() => {
                outerRenders += 1;
                return state[0].get() ? (
                  <section data-outer>
                    <Component id={1} render={() => <Summary count={Number(state[1].get())} />} />
                    <ul>
                      <li data-static-row>Static row</li>
                      <KeyedList
                        id={2}
                        render={() => {
                          listRenders += 1;
                          return (state[2].get() as Item[]).map((item) => (
                            <li data-key={item.id} key={item.id}>
                              {item.label}
                            </li>
                          ));
                        }}
                      />
                    </ul>
                    <Conditional
                      id={3}
                      render={() => {
                        nestedRenders += 1;
                        return state[3].get() ? (
                          <strong data-nested>{Number(state[1].get())}</strong>
                        ) : null;
                      }}
                    />
                  </section>
                ) : null;
              }}
            />
          </main>
        );
      },
      bindings: [
        { kind: "block", id: 0, dependencies: [0] },
        { kind: "block", id: 1, parent: 0, dependencies: [1] },
        { kind: "block", id: 2, parent: 0, dependencies: [2] },
        { kind: "block", id: 3, parent: 0, dependencies: [1, 3] },
      ],
    });

    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () =>
      root.render(
        <StrictMode>
          <Dashboard />
        </StrictMode>,
      ),
    );

    const staticHeading = container.querySelector("[data-static]");
    const initialOwnerRenders = ownerRenders;
    const initialOuterRenders = outerRenders;

    await act(async () => {
      click(container, "[data-action='inner']");
      await flushCompilerUpdates();
    });
    expect(ownerRenders).toBe(initialOwnerRenders);
    expect(outerRenders).toBe(initialOuterRenders);
    expect(container.querySelector("[data-summary]")?.textContent).toBe("1");
    expect(
      [...container.querySelectorAll<HTMLElement>("[data-key]")].map((row) => row.dataset.key),
    ).toEqual(["b", "a"]);
    expect(container.querySelector("[data-nested]")).toBeNull();
    expect(container.querySelector("[data-static]")).toBe(staticHeading);

    const childRendersBeforeHide = [summaryRenders, listRenders, nestedRenders];
    const unmountsBeforeHide = summaryUnmounts;
    await act(async () => {
      click(container, "[data-action='hide-update']");
      await flushCompilerUpdates();
    });
    expect(container.querySelector("[data-outer]")).toBeNull();
    expect([summaryRenders, listRenders, nestedRenders]).toEqual(childRendersBeforeHide);
    expect(summaryUnmounts).toBeGreaterThan(unmountsBeforeHide);

    await act(async () => {
      click(container, "[data-action='hidden-update']");
      await flushCompilerUpdates();
    });
    expect([summaryRenders, listRenders, nestedRenders]).toEqual(childRendersBeforeHide);

    await act(async () => {
      click(container, "[data-action='show']");
      await flushCompilerUpdates();
    });
    expect(container.querySelector("[data-summary]")?.textContent).toBe("3");
    expect(
      [...container.querySelectorAll<HTMLElement>("[data-key]")].map((row) => row.dataset.key),
    ).toEqual(["b", "a"]);
    expect(container.querySelector("[data-nested]")).toBeNull();
    expect(summaryMounts).toBeGreaterThan(0);
    expect(ownerRenders).toBe(initialOwnerRenders);
  });

  it("updates multiple sibling lists and conditions without replacing static siblings", async () => {
    let ownerRenders = 0;
    const Panel = createCompiledComponent({
      displayName: "SiblingBlocks",
      initialize: () => [[{ id: "a", label: "Alpha" }], [{ id: "b", label: "Beta" }], true, false],
      render(_props: Record<string, never>, state, blocks) {
        ownerRenders += 1;
        const KeyedList = blocks.KeyedList;
        const Conditional = blocks.Conditional;
        return (
          <section>
            <button
              onClick={() => {
                state[0].set((items) => [...(items as Item[]), { id: "c", label: "Charlie" }]);
                state[1].set((items) => [...(items as Item[])].reverse());
                state[2].set((value) => !value);
                state[3].set((value) => !value);
              }}
            >
              Update all
            </button>
            <h2 data-static>Static</h2>
            <ul data-list="left">
              <li>Fixed</li>
              <KeyedList
                id={0}
                render={() =>
                  (state[0].get() as Item[]).map((item) => <li key={item.id}>{item.label}</li>)
                }
              />
            </ul>
            <div data-list="right">
              <KeyedList
                id={1}
                render={() =>
                  (state[1].get() as Item[]).map((item) => <span key={item.id}>{item.label}</span>)
                }
              />
            </div>
            <Conditional
              id={2}
              render={() => (state[2].get() ? <strong>On</strong> : <i>Off</i>)}
            />
            <Conditional id={3} render={() => Boolean(state[3].get()) && <em>Ready</em>} />
          </section>
        );
      },
      bindings: [
        { kind: "block", id: 0, dependencies: [0] },
        { kind: "block", id: 1, dependencies: [1] },
        { kind: "block", id: 2, dependencies: [2] },
        { kind: "block", id: 3, dependencies: [3] },
      ],
    });

    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<Panel />));
    const staticHeading = container.querySelector("[data-static]");

    await act(async () => {
      click(container, "button");
      await flushCompilerUpdates();
    });

    expect(container.querySelector("[data-list='left']")?.textContent).toBe("FixedAlphaCharlie");
    expect(container.querySelector("[data-list='right']")?.textContent).toBe("Beta");
    expect(container.querySelector("i")?.textContent).toBe("Off");
    expect(container.querySelector("em")?.textContent).toBe("Ready");
    expect(container.querySelector("[data-static]")).toBe(staticHeading);
    expect(ownerRenders).toBe(1);
  });

  it("matches React through 1,000 deterministic updates across a nested block graph", async () => {
    type Action =
      | { kind: "show" }
      | { kind: "nested" }
      | { kind: "count"; amount: number }
      | { kind: "reverse" }
      | { kind: "rename"; suffix: number }
      | { kind: "append"; item: Item }
      | { kind: "remove" };

    let seed = 0x4f1bbcdc;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed;
    };
    const actions: Action[] = Array.from({ length: 1000 }, (_, index) => {
      switch (random() % 7) {
        case 0:
          return { kind: "show" };
        case 1:
          return { kind: "nested" };
        case 2:
          return { kind: "count", amount: (random() % 5) + 1 };
        case 3:
          return { kind: "reverse" };
        case 4:
          return { kind: "rename", suffix: random() % 100 };
        case 5:
          return {
            kind: "append",
            item: { id: `generated-${index}`, label: `Generated ${index}` },
          };
        default:
          return { kind: "remove" };
      }
    });

    let compiledDispatch: (action: Action) => void = () => undefined;
    let reactDispatch: (action: Action) => void = () => undefined;
    let compiledOwnerRenders = 0;

    function Readout({ count }: { count: number }) {
      return <output data-count>{count}</output>;
    }

    const initialItems: Item[] = [
      { id: "a", label: "Alpha" },
      { id: "b", label: "Beta" },
      { id: "c", label: "Gamma" },
    ];
    const Compiled = createCompiledComponent({
      displayName: "RandomComposableGraph",
      initialize: () => [true, 0, initialItems, false],
      render(_props: Record<string, never>, state, blocks) {
        compiledOwnerRenders += 1;
        compiledDispatch = (action) => {
          if (action.kind === "show") state[0].set((value) => !value);
          if (action.kind === "nested") state[3].set((value) => !value);
          if (action.kind === "count") {
            state[1].set((value) => Number(value) + action.amount);
          }
          if (action.kind === "reverse") {
            state[2].set((items) => [...(items as Item[])].reverse());
          }
          if (action.kind === "rename") {
            state[2].set((items) =>
              (items as Item[]).map((item, index) =>
                index === 0 ? { ...item, label: `${item.label}:${action.suffix}` } : item,
              ),
            );
          }
          if (action.kind === "append") {
            state[2].set((items) => [...(items as Item[]), action.item]);
          }
          if (action.kind === "remove") {
            state[2].set((items) => (items as Item[]).slice(1));
          }
        };
        const Conditional = blocks.Conditional;
        const Component = blocks.Component;
        const KeyedList = blocks.KeyedList;
        return (
          <section>
            <Conditional
              id={0}
              render={() =>
                state[0].get() ? (
                  <article>
                    <Component id={1} render={() => <Readout count={Number(state[1].get())} />} />
                    <ul>
                      <KeyedList
                        id={2}
                        render={() =>
                          (state[2].get() as Item[]).map((item) => (
                            <li key={item.id}>{item.label}</li>
                          ))
                        }
                      />
                    </ul>
                    <Conditional
                      id={3}
                      render={() =>
                        state[3].get() ? <strong>{Number(state[1].get())}</strong> : <i>off</i>
                      }
                    />
                  </article>
                ) : null
              }
            />
          </section>
        );
      },
      bindings: [
        { kind: "block", id: 0, dependencies: [0] },
        { kind: "block", id: 1, parent: 0, dependencies: [1] },
        { kind: "block", id: 2, parent: 0, dependencies: [2] },
        { kind: "block", id: 3, parent: 0, dependencies: [1, 3] },
      ],
    });

    function Normal() {
      const [show, setShow] = useState(true);
      const [count, setCount] = useState(0);
      const [items, setItems] = useState(initialItems);
      const [nested, setNested] = useState(false);
      reactDispatch = (action) => {
        if (action.kind === "show") setShow((value) => !value);
        if (action.kind === "nested") setNested((value) => !value);
        if (action.kind === "count") setCount((value) => value + action.amount);
        if (action.kind === "reverse") setItems((value) => [...value].reverse());
        if (action.kind === "rename") {
          setItems((value) =>
            value.map((item, index) =>
              index === 0 ? { ...item, label: `${item.label}:${action.suffix}` } : item,
            ),
          );
        }
        if (action.kind === "append") setItems((value) => [...value, action.item]);
        if (action.kind === "remove") setItems((value) => value.slice(1));
      };
      return (
        <section>
          {show ? (
            <article>
              <Readout count={count} />
              <ul>
                {items.map((item) => (
                  <li key={item.id}>{item.label}</li>
                ))}
              </ul>
              {nested ? <strong>{count}</strong> : <i>off</i>}
            </article>
          ) : null}
        </section>
      );
    }

    const compiledContainer = document.createElement("div");
    const reactContainer = document.createElement("div");
    document.body.append(compiledContainer, reactContainer);
    const compiledRoot = createRoot(compiledContainer);
    const reactRoot = createRoot(reactContainer);
    roots.push(compiledRoot, reactRoot);
    await act(async () => {
      compiledRoot.render(<Compiled />);
      reactRoot.render(<Normal />);
    });

    for (let offset = 0; offset < actions.length; offset += 10) {
      await act(async () => {
        for (const action of actions.slice(offset, offset + 10)) {
          compiledDispatch(action);
          reactDispatch(action);
        }
        await flushCompilerUpdates();
      });
      expect(compiledContainer.innerHTML).toBe(reactContainer.innerHTML);
    }
    expect(compiledOwnerRenders).toBe(1);
  });
});
