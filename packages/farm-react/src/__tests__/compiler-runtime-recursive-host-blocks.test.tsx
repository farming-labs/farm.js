import React, { StrictMode, useState } from "react";
import { act } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createCompiledComponent,
  type CompilerCell,
  type CompilerHostConditionalBranch,
  type CompilerHostElement,
} from "../compiler-runtime";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

interface Item {
  id: string;
  label: string;
}

const roots: Array<{ unmount(): void }> = [];
const stressIt = process.env.FARM_REACT_STRESS === "1" ? it : it.skip;

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

function host(
  tag: string,
  children: readonly unknown[] = [],
  attributes: readonly { name: string; value: unknown }[] = [],
): CompilerHostElement {
  return { kind: "element", tag, attributes, styles: [], children };
}

function LocalFallbackCounter() {
  const [count, setCount] = useState(0);
  return (
    <button type="button" onClick={() => setCount((value) => value + 1)}>
      Local: {count}
    </button>
  );
}

function click(container: Element, action: string): void {
  const button = container.querySelector<HTMLButtonElement>(`[data-action="${action}"]`);
  if (!button) throw new Error(`Missing action: ${action}`);
  button.click();
}

class RuntimeErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    return this.state.error ? (
      <p data-recursive-error>{this.state.error.message}</p>
    ) : (
      this.props.children
    );
  }
}

function recursiveBranch(state: readonly CompilerCell[]): CompilerHostConditionalBranch {
  const detailBranch: CompilerHostConditionalBranch = {
    create: () => host("strong", ["Details"]),
    bindings: [],
  };
  const loadingBranch: CompilerHostConditionalBranch = {
    create: () => ({
      ...host("article", [
        host("p", ["Loading…"]),
        {
          ...host("div", [state[2].get() ? detailBranch.create() : null]),
          block: {
            kind: "conditional-ranges",
            id: 2,
            ranges: [
              {
                before: 0,
                test: () => state[2].get(),
                logical: true,
                truthy: detailBranch,
              },
            ],
            trailing: 0,
          },
        },
      ]),
    }),
    bindings: [],
  };
  const items = () => state[3].get() as Item[];
  return {
    create: () => ({
      ...host("section", [
        host("header", ["Inbox"]),
        {
          ...host("div", [state[1].get() ? loadingBranch.create() : null]),
          block: {
            kind: "conditional-ranges",
            id: 1,
            ranges: [
              {
                before: 0,
                test: () => state[1].get(),
                logical: true,
                truthy: loadingBranch,
              },
            ],
            trailing: 0,
          },
        },
        {
          ...host(
            "ul",
            items().map((item) => host("li", [item.label], [{ name: "data-key", value: item.id }])),
          ),
          block: {
            kind: "keyed-ranges",
            id: 3,
            ranges: [
              {
                before: 0,
                items,
                rowKey: (item) => (item as Item).id,
                create: (item) => {
                  const row = item as Item;
                  return host("li", [row.label], [{ name: "data-key", value: row.id }]);
                },
                bindings: [
                  {
                    kind: "text",
                    path: [],
                    read: (item) => (item as Item).label,
                  },
                ],
              },
            ],
            trailing: 0,
          },
        },
      ]),
    }),
    bindings: [],
  };
}

describe("compiled recursive host-block runtime", () => {
  it("composes a nested host block inside a component-root conditional range", async () => {
    let ownerRenders = 0;
    const Panel = createCompiledComponent({
      displayName: "RootRecursiveRange",
      initialize: () => [true, false],
      render(_props: Record<string, never>, state, blocks) {
        ownerRenders += 1;
        const nested: CompilerHostConditionalBranch = {
          create: () => host("strong", ["Ready"]),
          bindings: [],
        };
        const branch: CompilerHostConditionalBranch = {
          create: () => ({
            ...host("section", [
              {
                ...host("div", [
                  host("header", [state[1].get() ? "On" : "Off"]),
                  state[1].get() ? nested.create() : null,
                ]),
                block: {
                  kind: "conditional-ranges",
                  id: 1,
                  ranges: [
                    {
                      before: 1,
                      test: () => state[1].get(),
                      logical: true,
                      truthy: nested,
                    },
                  ],
                  trailing: 0,
                  bindings: [
                    {
                      kind: "text",
                      segment: 0,
                      sibling: 0,
                      path: [],
                      read: () => (state[1].get() ? "On" : "Off"),
                    },
                  ],
                },
              },
            ]),
          }),
          bindings: [],
        };
        const ConditionalRanges = blocks.ConditionalRanges;
        return (
          <ConditionalRanges
            id={0}
            render={() => (
              <main>
                <button data-action="inner" onClick={() => state[1].set((value) => !value)} />
                {state[0].get() ? (
                  <section>
                    <div>
                      <header>{state[1].get() ? "On" : "Off"}</header>
                      {state[1].get() ? <strong>Ready</strong> : null}
                    </div>
                  </section>
                ) : (
                  <aside>Closed</aside>
                )}
              </main>
            )}
            ranges={[
              {
                before: 1,
                test: () => state[0].get(),
                truthy: branch,
                falsy: { create: () => host("aside", ["Closed"]), bindings: [] },
              },
            ]}
            trailing={0}
          />
        );
      },
      bindings: [
        { kind: "block", id: 0, dependencies: [0] },
        { kind: "block", id: 1, parent: 0, dependencies: [1] },
      ],
    });

    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<Panel />));
    const rendersAfterMount = ownerRenders;
    const section = container.querySelector("section");
    const staticHeader = container.querySelector("header");
    await act(async () => {
      click(container, "inner");
      await flushCompilerUpdates();
    });
    expect(container.querySelector("strong")?.textContent).toBe("Ready");
    expect(container.querySelector("header")).toBe(staticHeader);
    expect(staticHeader?.textContent).toBe("On");
    expect(container.querySelector("section")).toBe(section);
    expect(ownerRenders).toBe(rendersAfterMount);
  });

  it("updates nested conditions and LIS-keyed rows without rerunning the component", async () => {
    let ownerRenders = 0;
    const Panel = createCompiledComponent({
      displayName: "RecursiveHostPanel",
      initialize: () => [
        true,
        false,
        false,
        [
          { id: "a", label: "Alpha" },
          { id: "b", label: "Beta" },
          { id: "c", label: "Gamma" },
        ],
      ],
      render(_props: Record<string, never>, state, blocks) {
        ownerRenders += 1;
        const HostConditional = blocks.HostConditional;
        const branch = recursiveBranch(state);
        const items = state[3].get() as Item[];
        return (
          <main>
            <button data-action="loading" onClick={() => state[1].set((value) => !value)} />
            <button data-action="details" onClick={() => state[2].set((value) => !value)} />
            <button
              data-action="reorder"
              onClick={() =>
                state[3].set((value) => {
                  const [a, b, c] = value as Item[];
                  return [{ ...c, label: "Gamma updated" }, a, b];
                })
              }
            />
            <button
              data-action="hide-update"
              onClick={() => {
                state[0].set(false);
                state[1].set(true);
                state[2].set(true);
                state[3].set((value) => [...(value as Item[])].reverse());
              }}
            />
            <button data-action="hidden-update" onClick={() => state[1].set(false)} />
            <button data-action="show" onClick={() => state[0].set(true)} />
            <HostConditional
              id={0}
              render={() => (
                <div data-slot>
                  {state[0].get() ? (
                    <section>
                      <header>Inbox</header>
                      <div>
                        {state[1].get() ? (
                          <article>
                            <p>Loading…</p>
                            <div>{state[2].get() ? <strong>Details</strong> : null}</div>
                          </article>
                        ) : null}
                      </div>
                      <ul>
                        {items.map((item) => (
                          <li data-key={item.id} key={item.id}>
                            {item.label}
                          </li>
                        ))}
                      </ul>
                    </section>
                  ) : (
                    <aside>Closed</aside>
                  )}
                </div>
              )}
              test={() => state[0].get()}
              truthy={branch}
              falsy={{ create: () => host("aside", ["Closed"]), bindings: [] }}
            />
          </main>
        );
      },
      bindings: [
        { kind: "block", id: 0, dependencies: [0] },
        { kind: "block", id: 1, parent: 0, dependencies: [1] },
        { kind: "block", id: 2, parent: 1, dependencies: [2] },
        { kind: "block", id: 3, parent: 0, dependencies: [3] },
      ],
    });

    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () =>
      root.render(
        <StrictMode>
          <Panel />
        </StrictMode>,
      ),
    );

    const rendersAfterMount = ownerRenders;
    const section = container.querySelector("section");
    const rows = new Map(
      [...container.querySelectorAll<HTMLElement>("[data-key]")].map((row) => [
        row.dataset.key,
        row,
      ]),
    );

    await act(async () => {
      click(container, "loading");
      click(container, "details");
      await flushCompilerUpdates();
    });
    expect(container.querySelector("article strong")?.textContent).toBe("Details");
    expect(container.querySelector("section")).toBe(section);

    await act(async () => {
      click(container, "reorder");
      await flushCompilerUpdates();
    });
    const reordered = [...container.querySelectorAll<HTMLElement>("[data-key]")];
    expect(reordered.map((row) => row.dataset.key)).toEqual(["c", "a", "b"]);
    expect(reordered[0]).toBe(rows.get("c"));
    expect(reordered[1]).toBe(rows.get("a"));
    expect(reordered[2]).toBe(rows.get("b"));
    expect(reordered[0].textContent).toBe("Gamma updated");
    expect(ownerRenders).toBe(rendersAfterMount);

    await act(async () => {
      click(container, "hide-update");
      await flushCompilerUpdates();
    });
    expect(container.querySelector("aside")?.textContent).toBe("Closed");
    expect(container.querySelector("section")).toBeNull();

    await act(async () => {
      click(container, "hidden-update");
      click(container, "show");
      await flushCompilerUpdates();
    });
    expect(container.querySelector("section")).not.toBeNull();
    expect(container.querySelector("article")).toBeNull();
    expect(
      [...container.querySelectorAll<HTMLElement>("[data-key]")].map((row) => row.dataset.key),
    ).toEqual(["b", "a", "c"]);
    expect(ownerRenders).toBe(rendersAfterMount);
  });

  it("drops queued nested work when the compiled owner unmounts", async () => {
    let nestedSetter: ((next: unknown) => void) | undefined;
    const Panel = createCompiledComponent({
      displayName: "RecursiveUnmount",
      initialize: () => [true, false],
      render(_props: Record<string, never>, state, blocks) {
        nestedSetter = state[1].set;
        const branch: CompilerHostConditionalBranch = {
          create: () => ({
            ...host("section", [
              {
                ...host("div", [state[1].get() ? host("strong", ["Ready"]) : null]),
                block: {
                  kind: "conditional-ranges",
                  id: 1,
                  ranges: [
                    {
                      before: 0,
                      test: () => state[1].get(),
                      logical: true,
                      truthy: { create: () => host("strong", ["Ready"]), bindings: [] },
                    },
                  ],
                  trailing: 0,
                },
              },
            ]),
          }),
          bindings: [],
        };
        const HostConditional = blocks.HostConditional;
        return (
          <main>
            <HostConditional
              id={0}
              render={() => (
                <div>
                  {state[0].get() ? (
                    <section>
                      <div>{state[1].get() ? <strong>Ready</strong> : null}</div>
                    </section>
                  ) : null}
                </div>
              )}
              test={() => state[0].get()}
              truthy={branch}
            />
          </main>
        );
      },
      bindings: [
        { kind: "block", id: 0, dependencies: [0] },
        { kind: "block", id: 1, parent: 0, dependencies: [1] },
      ],
    });

    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<Panel />));
    nestedSetter?.(true);
    await act(async () => root.unmount());
    roots.splice(roots.indexOf(root), 1);
    await flushCompilerUpdates();
    expect(container.innerHTML).toBe("");
  });

  stressIt("matches normal React through 3,000 deterministic recursive updates", async () => {
    type Action =
      | "outer"
      | "loading"
      | "details"
      | "reverse"
      | "rotate"
      | "edit"
      | "append"
      | "remove";
    let compiledDispatch: ((action: Action) => void) | undefined;
    let reactDispatch: ((action: Action) => void) | undefined;
    let compiledRenders = 0;
    let normalRenders = 0;

    const applyListAction = (items: Item[], action: Action): Item[] => {
      if (action === "reverse") return [...items].reverse();
      if (action === "rotate" && items.length > 1) return [...items.slice(1), items[0]];
      if (action === "edit" && items.length > 0) {
        return [{ ...items[0], label: `${items[0].label}!` }, ...items.slice(1)];
      }
      if (action === "append" && items.length < 10) {
        const keys = new Set(items.map((item) => item.id));
        let candidate = 0;
        while (keys.has(String(candidate))) candidate += 1;
        const id = String(candidate);
        return [...items, { id, label: `Item ${id}` }];
      }
      if (action === "remove" && items.length > 1) return items.slice(0, -1);
      return items;
    };

    const initialItems: Item[] = [
      { id: "0", label: "Zero" },
      { id: "1", label: "One" },
      { id: "2", label: "Two" },
    ];

    const Compiled = createCompiledComponent({
      displayName: "RecursiveDifferential",
      initialize: () => [true, false, false, initialItems],
      render(_props: Record<string, never>, state, blocks) {
        compiledRenders += 1;
        compiledDispatch = (action) => {
          if (action === "outer") state[0].set((value) => !value);
          else if (action === "loading") state[1].set((value) => !value);
          else if (action === "details") state[2].set((value) => !value);
          else state[3].set((value) => applyListAction(value as Item[], action));
        };
        const branch = recursiveBranch(state);
        const HostConditional = blocks.HostConditional;
        const items = state[3].get() as Item[];
        return (
          <div data-compiled>
            <HostConditional
              id={0}
              render={() => (
                <div data-view>
                  {state[0].get() ? (
                    <section>
                      <header>Inbox</header>
                      <div>
                        {state[1].get() ? (
                          <article>
                            <p>Loading…</p>
                            <div>{state[2].get() ? <strong>Details</strong> : null}</div>
                          </article>
                        ) : null}
                      </div>
                      <ul>
                        {items.map((item) => (
                          <li data-key={item.id} key={item.id}>
                            {item.label}
                          </li>
                        ))}
                      </ul>
                    </section>
                  ) : (
                    <aside>Closed</aside>
                  )}
                </div>
              )}
              test={() => state[0].get()}
              truthy={branch}
              falsy={{ create: () => host("aside", ["Closed"]), bindings: [] }}
            />
          </div>
        );
      },
      bindings: [
        { kind: "block", id: 0, dependencies: [0] },
        { kind: "block", id: 1, parent: 0, dependencies: [1] },
        { kind: "block", id: 2, parent: 1, dependencies: [2] },
        { kind: "block", id: 3, parent: 0, dependencies: [3] },
      ],
    });

    function Normal() {
      normalRenders += 1;
      const [open, setOpen] = useState(true);
      const [loading, setLoading] = useState(false);
      const [details, setDetails] = useState(false);
      const [items, setItems] = useState(initialItems);
      reactDispatch = (action) => {
        if (action === "outer") setOpen((value) => !value);
        else if (action === "loading") setLoading((value) => !value);
        else if (action === "details") setDetails((value) => !value);
        else setItems((value) => applyListAction(value, action));
      };
      return (
        <div data-react>
          <div data-view>
            {open ? (
              <section>
                <header>Inbox</header>
                <div>
                  {loading ? (
                    <article>
                      <p>Loading…</p>
                      <div>{details ? <strong>Details</strong> : null}</div>
                    </article>
                  ) : null}
                </div>
                <ul>
                  {items.map((item) => (
                    <li data-key={item.id} key={item.id}>
                      {item.label}
                    </li>
                  ))}
                </ul>
              </section>
            ) : (
              <aside>Closed</aside>
            )}
          </div>
        </div>
      );
    }

    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () =>
      root.render(
        <>
          <Compiled />
          <Normal />
        </>,
      ),
    );
    const rendersAfterMount = compiledRenders;
    const actions: Action[] = [
      "outer",
      "loading",
      "details",
      "reverse",
      "rotate",
      "edit",
      "append",
      "remove",
    ];
    let random = 0x51f15e;
    for (let step = 0; step < 3000; step += 1) {
      random = (random * 1664525 + 1013904223) >>> 0;
      const action = actions[random % actions.length];
      await act(async () => {
        compiledDispatch?.(action);
        reactDispatch?.(action);
        await flushCompilerUpdates();
      });
      expect(container.querySelector("[data-compiled] [data-view]")?.innerHTML).toBe(
        container.querySelector("[data-react] [data-view]")?.innerHTML,
      );
    }
    expect(compiledRenders).toBe(rendersAfterMount);
    expect(normalRenders).toBeGreaterThan(compiledRenders);
  });

  it("adopts nested server markup and remains correct after a recoverable mismatch", async () => {
    let setLoading: ((next: unknown) => void) | undefined;
    let setItems: ((next: unknown) => void) | undefined;
    const Panel = createCompiledComponent({
      displayName: "RecursiveHydration",
      initialize: () => [true, false, false, [{ id: "a", label: "Alpha" }]],
      render(_props: Record<string, never>, state, blocks) {
        setLoading = state[1].set;
        setItems = state[3].set;
        const branch = recursiveBranch(state);
        const items = state[3].get() as Item[];
        const HostConditional = blocks.HostConditional;
        return (
          <main>
            <HostConditional
              id={0}
              render={() => (
                <div>
                  <section>
                    <header>Inbox</header>
                    <div>
                      {state[1].get() ? (
                        <article>
                          <p>Loading…</p>
                          <div />
                        </article>
                      ) : null}
                    </div>
                    <ul>
                      {items.map((item) => (
                        <li data-key={item.id} key={item.id}>
                          {item.label}
                        </li>
                      ))}
                    </ul>
                  </section>
                </div>
              )}
              test={() => state[0].get()}
              truthy={branch}
            />
          </main>
        );
      },
      bindings: [
        { kind: "block", id: 0, dependencies: [0] },
        { kind: "block", id: 1, parent: 0, dependencies: [1] },
        { kind: "block", id: 2, parent: 1, dependencies: [2] },
        { kind: "block", id: 3, parent: 0, dependencies: [3] },
      ],
    });

    for (const mismatch of [false, true]) {
      const container = document.createElement("div");
      document.body.append(container);
      const serverHtml = renderToString(<Panel />);
      container.innerHTML = mismatch
        ? serverHtml.replace('<li data-key="a">Alpha</li>', "<div>Wrong</div>")
        : serverHtml;
      const errors: unknown[] = [];
      let root!: ReturnType<typeof hydrateRoot>;
      await act(async () => {
        root = hydrateRoot(container, <Panel />, {
          onRecoverableError: (error) => errors.push(error),
        });
      });
      roots.push(root);
      if (mismatch) expect(errors.length).toBeGreaterThan(0);
      else expect(errors).toEqual([]);

      const section = container.querySelector("section");
      await act(async () => {
        setLoading?.(true);
        setItems?.([
          { id: "b", label: "Beta" },
          { id: "a", label: "Alpha 2" },
        ]);
        await flushCompilerUpdates();
      });
      expect(container.querySelector("section")).toBe(section);
      expect(container.querySelector("article")?.textContent).toContain("Loading");
      expect(
        [...container.querySelectorAll<HTMLElement>("[data-key]")].map((row) => [
          row.dataset.key,
          row.textContent,
        ]),
      ).toEqual([
        ["b", "Beta"],
        ["a", "Alpha 2"],
      ]);

      await act(async () => root.unmount());
      roots.splice(roots.indexOf(root), 1);
      container.remove();
    }
  });

  it.each(
    (["HostConditional", "ConditionalRanges"] as const).flatMap((kind) =>
      (["static", "hybrid"] as const).flatMap((reactivity) =>
        (["outer", "nested"] as const).flatMap((updates) =>
          (["keyed-ranges", "mixed-ranges"] as const).flatMap((nestedKind) =>
            (["mount", "hydrate"] as const).map((lifecycle) => ({
              kind,
              lifecycle,
              reactivity,
              updates,
              nestedKind,
            })),
          ),
        ),
      ),
    ),
  )(
    "preserves safe $kind nested fallback state ($reactivity, $updates, $nestedKind, $lifecycle)",
    async ({ kind, lifecycle, reactivity, updates, nestedKind }) => {
      let setItems: ((next: unknown) => void) | undefined;
      let ownerRenders = 0;
      const Panel = createCompiledComponent<{ prefix: string }>({
        displayName: "RecursiveFallbackState",
        reactivity,
        initialize: () => [
          true,
          [
            { id: "a", label: "Alpha" },
            { id: "b", label: "Beta" },
          ],
        ],
        render(props, state, blocks) {
          ownerRenders += 1;
          setItems = state[1].set;
          const items = () => state[1].get() as Item[];
          const keyedRange = {
            before: 0,
            items,
            rowKey: (item: unknown) => (item as Item).id,
            create: (item: unknown) => host("li", [(item as Item).label]),
            bindings: [
              { kind: "text" as const, path: [], read: (item: unknown) => (item as Item).label },
            ],
          };
          const nestedBlock: NonNullable<CompilerHostElement["block"]> =
            nestedKind === "keyed-ranges"
              ? {
                  kind: "keyed-ranges",
                  id: 1,
                  ranges: [keyedRange],
                  trailing: 0,
                }
              : {
                  kind: "mixed-ranges",
                  id: 1,
                  ranges: [{ kind: "keyed", ...keyedRange }],
                  trailing: 0,
                };
          const branch: CompilerHostConditionalBranch = {
            create: () => ({
              ...host("section", [
                {
                  ...host(
                    "ul",
                    items().map((item) => host("li", [item.label])),
                  ),
                  block: nestedBlock,
                },
              ]),
            }),
            bindings: [],
          };
          const blockProps = {
            id: 0,
            render: () => (
              <div data-surface="recursive-fallback" data-prefix={props.prefix}>
                <section data-state>
                  <aside>
                    <LocalFallbackCounter />
                    <input aria-label="Text" defaultValue="draft" />
                    <textarea aria-label="Note" defaultValue="draft" />
                    <select aria-label="Choice" defaultValue="a">
                      <option value="a">A</option>
                      <option value="b">B</option>
                    </select>
                  </aside>
                  <ul>
                    {items().map((item) => (
                      <li key={item.id}>{item.label}</li>
                    ))}
                  </ul>
                </section>
              </div>
            ),
          };
          const condition = { before: 0, test: () => state[0].get(), truthy: branch };
          return (
            <main>
              {kind === "HostConditional"
                ? React.createElement(blocks.HostConditional, { ...blockProps, ...condition })
                : React.createElement(blocks.ConditionalRanges, {
                    ...blockProps,
                    ranges: [condition],
                    trailing: 0,
                  })}
            </main>
          );
        },
        bindings: [
          { kind: "block", id: 0, dependencies: updates === "outer" ? [0, 1] : [0] },
          { kind: "block", id: 1, parent: 0, dependencies: updates === "outer" ? [] : [1] },
        ],
      });

      function Parent() {
        const [prefix, setPrefix] = useState("before");
        return (
          <>
            <button data-parent-prefix type="button" onClick={() => setPrefix("after")} />
            <Panel prefix={prefix} />
          </>
        );
      }

      const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const container = document.createElement("div");
      document.body.append(container);
      const tree = (
        <StrictMode>
          <Parent />
        </StrictMode>
      );
      if (lifecycle === "hydrate") container.innerHTML = renderToString(tree);
      const recoverable = vi.fn();
      const root =
        lifecycle === "hydrate"
          ? hydrateRoot(container, tree, { onRecoverableError: recoverable })
          : createRoot(container);
      roots.push(root);
      await act(async () => {
        if (lifecycle === "mount") root.render(tree);
        await flushCompilerUpdates();
      });
      expect(recoverable).not.toHaveBeenCalled();
      const surface = container.querySelector<HTMLElement>("[data-surface='recursive-fallback']")!;
      const input = container.querySelector<HTMLInputElement>("input")!;
      const textarea = container.querySelector<HTMLTextAreaElement>("textarea")!;
      const select = container.querySelector<HTMLSelectElement>("select")!;
      await act(async () => {
        surface.querySelector("button")!.click();
      });
      input.value = "typed text";
      textarea.value = "typed note";
      select.value = "b";
      input.focus();
      input.setSelectionRange(1, 4, "backward");

      await act(async () => {
        container.querySelector<HTMLButtonElement>("[data-parent-prefix]")?.click();
        setItems?.([
          { id: "b", label: "Beta renamed" },
          { id: "a", label: "Alpha renamed" },
        ]);
        await flushCompilerUpdates();
      });
      expect(container.querySelector("[data-surface='recursive-fallback']")).toBe(surface);
      expect(container.querySelector("input")).toBe(input);
      expect(container.querySelector("textarea")).toBe(textarea);
      expect(container.querySelector("select")).toBe(select);
      expect(input.value).toBe("typed text");
      expect(textarea.value).toBe("typed note");
      expect(select.value).toBe("b");
      expect(surface.querySelector("button")?.textContent).toBe("Local: 1");
      expect(document.activeElement).toBe(input);
      expect([input.selectionStart, input.selectionEnd, input.selectionDirection]).toEqual([
        1,
        4,
        "backward",
      ]);
      expect(surface.dataset.prefix).toBe("after");
      expect([...surface.querySelectorAll("li")].map((row) => row.textContent)).toEqual([
        "Beta renamed",
        "Alpha renamed",
      ]);
      const rendersAfterParentUpdate = ownerRenders;

      await act(async () => {
        setItems?.([
          { id: "duplicate", label: "First" },
          { id: "duplicate", label: "Second" },
        ]);
        await flushCompilerUpdates();
      });
      expect(container.querySelector("input")).not.toBe(input);
      expect(container.querySelector("[data-state] button")?.textContent).toBe("Local: 0");
      expect([...container.querySelectorAll("li")].map((row) => row.textContent)).toEqual([
        "First",
        "Second",
      ]);

      await act(async () => {
        setItems?.([
          { id: "a", label: "Alpha recovered" },
          { id: "b", label: "Beta recovered" },
        ]);
        await flushCompilerUpdates();
      });
      const recoveredInput = container.querySelector<HTMLInputElement>("input")!;
      recoveredInput.value = "recovered";
      await act(async () =>
        container.querySelector<HTMLButtonElement>("[data-state] button")?.click(),
      );

      await act(async () => {
        setItems?.([
          { id: "b", label: "Beta final" },
          { id: "a", label: "Alpha final" },
        ]);
        await flushCompilerUpdates();
      });
      expect(container.querySelector("input")).toBe(recoveredInput);
      expect(recoveredInput.value).toBe("recovered");
      expect(container.querySelector("[data-state] button")?.textContent).toBe("Local: 1");
      expect([...container.querySelectorAll("li")].map((row) => row.textContent)).toEqual([
        "Beta final",
        "Alpha final",
      ]);
      expect(ownerRenders).toBe(rendersAfterParentUpdate);
      consoleError.mockRestore();
    },
  );

  it.each(["keyed-ranges", "mixed-ranges"] as const)(
    "checks every nested keyed row before preserving %s fallback state",
    async (nestedKind) => {
      interface Group {
        id: string;
        items: Item[];
      }

      let setGroups: ((next: unknown) => void) | undefined;
      const Panel = createCompiledComponent({
        displayName: "RecursivePerRowFallbackState",
        initialize: () => [
          true,
          [
            {
              id: "first",
              items: [
                { id: "a", label: "Alpha" },
                { id: "b", label: "Beta" },
              ],
            },
            {
              id: "second",
              items: [
                { id: "x", label: "X-ray" },
                { id: "y", label: "Yankee" },
              ],
            },
          ] satisfies Group[],
        ],
        render(_props: Record<string, never>, state, blocks) {
          const groups = () => state[1].get() as Group[];
          setGroups = state[1].set;
          const groupRange = {
            before: 0,
            items: groups,
            rowKey: (group: unknown) => (group as Group).id,
            create: (groupValue: unknown) => {
              const group = groupValue as Group;
              const itemRange = {
                before: 0,
                items: () => group.items,
                rowKey: (item: unknown) => {
                  const key = (item as Item).id;
                  if (key === "throw-key") throw new Error("unreadable nested key");
                  return key;
                },
                create: (item: unknown) => host("li", [(item as Item).label]),
                bindings: [
                  {
                    kind: "text" as const,
                    path: [],
                    read: (item: unknown) => (item as Item).label,
                  },
                ],
              };
              const block: NonNullable<CompilerHostElement["block"]> =
                nestedKind === "keyed-ranges"
                  ? {
                      kind: "keyed-ranges",
                      id: 2,
                      ranges: [itemRange],
                      trailing: 0,
                    }
                  : {
                      kind: "mixed-ranges",
                      id: 2,
                      ranges: [{ kind: "keyed", ...itemRange }],
                      trailing: 0,
                    };
              return host("article", [
                host("h2", [group.id]),
                {
                  ...host(
                    "ul",
                    group.items.map((item) => host("li", [item.label])),
                  ),
                  block,
                },
              ]);
            },
            bindings: [],
          };
          const branch: CompilerHostConditionalBranch = {
            create: () => ({
              ...host("section", [
                {
                  ...host("div"),
                  block: {
                    kind: "keyed-ranges",
                    id: 1,
                    ranges: [groupRange],
                    trailing: 0,
                    staticChildrenOnly: true,
                  },
                },
              ]),
            }),
            bindings: [],
          };
          return (
            <main>
              <blocks.HostConditional
                id={0}
                render={() => (
                  <div>
                    <section>
                      <aside>
                        <input aria-label="Nested row draft" defaultValue="draft" />
                      </aside>
                      <div>
                        {groups().map((group) => (
                          <article key={group.id}>
                            <h2>{group.id}</h2>
                            <ul>
                              {group.items.map((item) => (
                                <li key={item.id}>{item.label}</li>
                              ))}
                            </ul>
                          </article>
                        ))}
                      </div>
                    </section>
                  </div>
                )}
                test={() => state[0].get()}
                truthy={branch}
              />
            </main>
          );
        },
        bindings: [
          { kind: "block", id: 0, dependencies: [0] },
          { kind: "block", id: 1, parent: 0, dependencies: [] },
          { kind: "block", id: 2, parent: 1, dependencies: [1] },
        ],
      });

      const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const container = document.createElement("div");
      document.body.append(container);
      const root = createRoot(container);
      roots.push(root);
      await act(async () => {
        root.render(
          <StrictMode>
            <Panel />
          </StrictMode>,
        );
        await flushCompilerUpdates();
      });

      const initialInput = container.querySelector<HTMLInputElement>(
        "[aria-label='Nested row draft']",
      )!;
      initialInput.value = "typed";
      await act(async () => {
        setGroups?.([
          { id: "first", items: [{ id: "a", label: "Alpha safe" }] },
          {
            id: "second",
            items: [
              { id: "y", label: "Yankee safe" },
              { id: "x", label: "X-ray safe" },
            ],
          },
        ] satisfies Group[]);
        await flushCompilerUpdates();
      });
      expect(container.querySelector("[aria-label='Nested row draft']")).toBe(initialInput);
      expect(initialInput.value).toBe("typed");

      await act(async () => {
        setGroups?.([
          { id: "first", items: [{ id: "a", label: "Alpha" }] },
          {
            id: "second",
            items: [
              { id: "duplicate", label: "One" },
              { id: "duplicate", label: "Two" },
            ],
          },
        ] satisfies Group[]);
        await flushCompilerUpdates();
      });
      expect(container.querySelector("[aria-label='Nested row draft']")).not.toBe(initialInput);

      await act(async () => {
        setGroups?.([
          { id: "first", items: [{ id: "a", label: "Alpha" }] },
          { id: "second", items: [{ id: "x", label: "Recovered" }] },
        ] satisfies Group[]);
        await flushCompilerUpdates();
      });
      const recoveredInput = container.querySelector<HTMLInputElement>(
        "[aria-label='Nested row draft']",
      )!;
      recoveredInput.value = "recovered";
      await act(async () => {
        setGroups?.([
          { id: "first", items: [{ id: "a", label: "Alpha final" }] },
          { id: "second", items: [{ id: "x", label: "Recovered final" }] },
        ] satisfies Group[]);
        await flushCompilerUpdates();
      });
      expect(container.querySelector("[aria-label='Nested row draft']")).toBe(recoveredInput);
      expect(recoveredInput.value).toBe("recovered");

      await act(async () => {
        setGroups?.([
          { id: "first", items: [{ id: "a", label: "Alpha" }] },
          { id: "second", items: [{ id: "throw-key", label: "Unreadable" }] },
        ] satisfies Group[]);
        await flushCompilerUpdates();
      });
      expect(container.querySelector("[aria-label='Nested row draft']")).not.toBe(recoveredInput);
      consoleError.mockRestore();
    },
  );

  it("rebinds nested descriptors when parent props and local state change together", async () => {
    let setItems: ((next: unknown) => void) | undefined;
    const Panel = createCompiledComponent<{ prefix: string }>({
      displayName: "RecursiveProps",
      initialize: () => [true, [{ id: "a", label: "Alpha" }]],
      render(props, state, blocks) {
        setItems = state[1].set;
        const items = () => state[1].get() as Item[];
        const row = (item: Item) => `${props.prefix}${item.label}`;
        const branch: CompilerHostConditionalBranch = {
          create: () => ({
            ...host("section", [
              {
                ...host(
                  "ul",
                  items().map((item) => host("li", [row(item)])),
                ),
                block: {
                  kind: "keyed-ranges",
                  id: 1,
                  ranges: [
                    {
                      before: 0,
                      items,
                      rowKey: (item) => (item as Item).id,
                      create: (item) => host("li", [row(item as Item)]),
                      bindings: [{ kind: "text", path: [], read: (item) => row(item as Item) }],
                    },
                  ],
                  trailing: 0,
                },
              },
            ]),
          }),
          bindings: [],
        };
        const HostConditional = blocks.HostConditional;
        return (
          <main>
            <HostConditional
              id={0}
              render={() => (
                <div>
                  <section>
                    <ul>
                      {items().map((item) => (
                        <li key={item.id}>{row(item)}</li>
                      ))}
                    </ul>
                  </section>
                </div>
              )}
              test={() => state[0].get()}
              truthy={branch}
            />
          </main>
        );
      },
      bindings: [
        { kind: "block", id: 0, dependencies: [0] },
        { kind: "block", id: 1, parent: 0, dependencies: [1] },
      ],
    });

    function Parent() {
      const [prefix, setPrefix] = useState("Old: ");
      return (
        <>
          <button data-props onClick={() => setPrefix("New: ")} />
          <Panel prefix={prefix} />
        </>
      );
    }
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<Parent />));
    await act(async () => {
      container.querySelector<HTMLButtonElement>("[data-props]")?.click();
      setItems?.([{ id: "a", label: "Updated" }]);
      await flushCompilerUpdates();
    });
    expect(container.querySelector("li")?.textContent).toBe("New: Updated");
  });

  it("routes nested binding failures through the nearest React error boundary", async () => {
    let fail: (() => void) | undefined;
    const Panel = createCompiledComponent({
      displayName: "RecursiveBindingError",
      initialize: () => [true, false],
      render(_props: Record<string, never>, state, blocks) {
        fail = () => state[1].set(true);
        const brokenBranch: CompilerHostConditionalBranch = {
          create: () => host("strong", ["Broken"]),
          bindings: [
            {
              kind: "text",
              path: [],
              read: () => {
                if (state[1].get()) throw new Error("recursive binding failed");
                return "Ready";
              },
            },
          ],
        };
        const outerBranch: CompilerHostConditionalBranch = {
          create: () => ({
            ...host("section", [
              {
                ...host("div", [state[1].get() ? brokenBranch.create() : null]),
                block: {
                  kind: "conditional-ranges",
                  id: 1,
                  ranges: [
                    {
                      before: 0,
                      test: () => state[1].get(),
                      logical: true,
                      truthy: brokenBranch,
                    },
                  ],
                  trailing: 0,
                },
              },
            ]),
          }),
          bindings: [],
        };
        const HostConditional = blocks.HostConditional;
        return (
          <main>
            <HostConditional
              id={0}
              render={() => (
                <div>
                  <section>
                    <div>{state[1].get() ? <strong>Broken</strong> : null}</div>
                  </section>
                </div>
              )}
              test={() => state[0].get()}
              truthy={outerBranch}
            />
          </main>
        );
      },
      bindings: [
        { kind: "block", id: 0, dependencies: [0] },
        { kind: "block", id: 1, parent: 0, dependencies: [1] },
      ],
    });

    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () =>
      root.render(
        <RuntimeErrorBoundary>
          <Panel />
        </RuntimeErrorBoundary>,
      ),
    );
    await act(async () => {
      fail?.();
      await flushCompilerUpdates();
    });
    expect(container.querySelector("[data-recursive-error]")?.textContent).toBe(
      "recursive binding failed",
    );
    consoleError.mockRestore();
  });
});
