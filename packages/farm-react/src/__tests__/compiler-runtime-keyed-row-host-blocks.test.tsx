import React, { Profiler, StrictMode, useState } from "react";
import { act } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createCompiledComponent,
  type CompiledComponentDefinition,
  type CompilerHostConditionalBranch,
  type CompilerHostElement,
  type CompilerStateUpdater,
} from "../compiler-runtime";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

interface Item {
  id: string;
  label: string;
  done: boolean;
  detail: boolean;
  expanded: boolean;
  fail?: boolean;
}

const initialItems: Item[] = [
  { id: "a", label: "Alpha", done: false, detail: false, expanded: true },
  { id: "b", label: "Beta", done: true, detail: true, expanded: false },
  { id: "c", label: "Gamma", done: false, detail: true, expanded: true },
];

const roots: Array<{ unmount(): void }> = [];

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

async function flushCompilerUpdates(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function host(
  tag: string,
  children: readonly unknown[] = [],
  attributes: readonly { name: string; value: unknown }[] = [],
  styles: readonly { name: string; value: unknown }[] = [],
): CompilerHostElement {
  return { kind: "element", tag, attributes, styles, children };
}

function rowDescriptor(item: Item, index: number, prefix: string): CompilerHostElement {
  const detailBranch: CompilerHostConditionalBranch = {
    create: () => host("small", [prefix, item.label], [{ name: "title", value: item.label }]),
    bindings: [
      { kind: "attribute", path: [], name: "title", read: () => item.label },
      { kind: "text", path: [], read: () => [prefix, item.label] },
    ],
  };
  const doneBranch: CompilerHostConditionalBranch = {
    create: () => ({
      ...host(
        "article",
        [
          host("p", [prefix, item.label, " done"]),
          {
            ...host("div", [item.detail ? detailBranch.create() : null]),
            block: {
              kind: "conditional-ranges",
              id: 2,
              ranges: [
                {
                  before: 0,
                  test: () => item.detail,
                  logical: true,
                  truthy: detailBranch,
                },
              ],
              trailing: 0,
            },
          },
        ],
        [{ name: "data-tone", value: prefix }],
        [{ name: "opacity", value: item.detail ? 1 : 0.7 }],
      ),
    }),
    bindings: [
      { kind: "attribute", path: [], name: "data-tone", read: () => prefix },
      { kind: "style", path: [], name: "opacity", read: () => (item.detail ? 1 : 0.7) },
      { kind: "text", path: [0], read: () => [prefix, item.label, " done"] },
    ],
  };
  const openBranch: CompilerHostConditionalBranch = {
    create: () => host("aside", [prefix, "Open"]),
    bindings: [{ kind: "text", path: [], read: () => [prefix, "Open"] }],
  };
  const expandedBranch: CompilerHostConditionalBranch = {
    create: () => host("em", [prefix, item.label]),
    bindings: [{ kind: "text", path: [], read: () => [prefix, item.label] }],
  };

  return host(
    "li",
    [
      host("span", [prefix, item.label]),
      {
        ...host(
          "div",
          [
            host("i", ["State"]),
            item.done ? doneBranch.create() : openBranch.create(),
            host("b", ["After"]),
          ],
          [{ name: "data-status", value: "" }],
        ),
        block: {
          kind: "conditional-ranges",
          id: 1,
          ranges: [
            {
              before: 1,
              test: () => item.done,
              truthy: doneBranch,
              falsy: openBranch,
            },
          ],
          trailing: 1,
        },
      },
      {
        ...host(
          "section",
          [item.expanded ? expandedBranch.create() : null],
          [{ name: "data-extra", value: "" }],
        ),
        block: {
          kind: "conditional-ranges",
          id: 3,
          ranges: [
            {
              before: 0,
              test: () => item.expanded,
              logical: true,
              truthy: expandedBranch,
            },
          ],
          trailing: 0,
        },
      },
    ],
    [
      { name: "data-key", value: item.id },
      { name: "data-index", value: index },
    ],
  );
}

function rowBindings(prefix: () => string) {
  return [
    {
      kind: "attribute" as const,
      path: [] as const,
      name: "data-index",
      read: (_item: unknown, index: number) => index,
    },
    {
      kind: "text" as const,
      path: [0] as const,
      read: (item: unknown) => [prefix(), (item as Item).label],
    },
  ];
}

function RowMarkup({ item, index, prefix }: { item: Item; index: number; prefix: string }) {
  return (
    <li data-index={index} data-key={item.id}>
      <span>
        {prefix}
        {item.label}
      </span>
      <div data-status>
        <i>State</i>
        {item.done ? (
          <article data-tone={prefix} style={{ opacity: item.detail ? 1 : 0.7 }}>
            <p>
              {prefix}
              {item.label} done
            </p>
            <div>
              {item.detail ? (
                <small title={item.label}>
                  {prefix}
                  {item.label}
                </small>
              ) : null}
            </div>
          </article>
        ) : (
          <aside>{prefix}Open</aside>
        )}
        <b>After</b>
      </div>
      <section data-extra>
        {item.expanded ? (
          <em>
            {prefix}
            {item.label}
          </em>
        ) : null}
      </section>
    </li>
  );
}

function createHostRowsFixture(onRender?: () => void) {
  let executions = 0;
  let setItems: (next: CompilerStateUpdater) => void = () => undefined;
  let setPrefix: (next: CompilerStateUpdater) => void = () => undefined;
  const Rows = createCompiledComponent({
    displayName: "CompilerOwnedKeyedRowHostBlocks",
    initialize: (props: { prefix: string }) => [initialItems, props.prefix],
    render(props: { prefix: string }, state, blocks) {
      executions += 1;
      onRender?.();
      setItems = state[0].set;
      setPrefix = state[1].set;
      const items = () => state[0].get() as Item[];
      const prefix = () => state[1].get() as string;
      const KeyedRows = blocks.KeyedRows;
      return (
        <main data-owner-prefix={props.prefix}>
          <KeyedRows
            bindings={rowBindings(prefix)}
            create={(item, index) => rowDescriptor(item as Item, index, prefix())}
            hostBlocks
            id={0}
            items={items}
            render={() => (
              <ul data-rows>
                {items().map((item, index) => (
                  <RowMarkup item={item} index={index} key={item.id} prefix={prefix()} />
                ))}
              </ul>
            )}
            rowKey={(item) => (item as Item).id}
          />
        </main>
      );
    },
    bindings: [
      { kind: "block", id: 0, dependencies: [0, 1] },
      { kind: "block", id: 1, parent: 0, dependencies: [] },
      { kind: "block", id: 2, parent: 1, dependencies: [] },
      { kind: "block", id: 3, parent: 0, dependencies: [] },
    ],
  });
  return {
    Rows,
    executions: () => executions,
    setItems: (next: CompilerStateUpdater) => setItems(next),
    setPrefix: (next: CompilerStateUpdater) => setPrefix(next),
  };
}

function semanticRows(container: Element, selector: string) {
  return [...container.querySelectorAll<HTMLElement>(`${selector} > li`)].map((row) => {
    const status = row.querySelector<HTMLElement>("[data-status] > article, [data-status] > aside");
    const detail = row.querySelector<HTMLElement>("[data-status] small");
    return {
      key: row.dataset.key,
      index: row.dataset.index,
      label: row.querySelector("span")?.textContent,
      statusTag: status?.tagName,
      statusText: status?.textContent,
      tone: status?.dataset.tone,
      opacity: status?.style.opacity,
      detail: detail?.textContent,
      detailTitle: detail?.getAttribute("title"),
      extra: row.querySelector("[data-extra]")?.textContent,
    };
  });
}

class Boundary extends React.Component<{ children: React.ReactNode }, { message: string | null }> {
  state = { message: null as string | null };

  static getDerivedStateFromError(error: Error) {
    return { message: error.message };
  }

  render() {
    return this.state.message ? <p data-error>{this.state.message}</p> : this.props.children;
  }
}

describe("compiler-owned keyed-row host blocks runtime", () => {
  it("patches recursive branches during an LIS reorder without React commits or lost identity", async () => {
    let profilerCommits = 0;
    const fixture = createHostRowsFixture();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () =>
      root.render(
        <StrictMode>
          <Profiler id="rows" onRender={() => (profilerCommits += 1)}>
            <fixture.Rows prefix="Initial: " />
          </Profiler>
        </StrictMode>,
      ),
    );

    const executionsAfterMount = fixture.executions();
    const commitsAfterMount = profilerCommits;
    const rows = new Map(
      [...container.querySelectorAll<HTMLElement>("[data-key]")].map((row) => [
        row.dataset.key,
        row,
      ]),
    );
    const betaArticle = rows.get("b")?.querySelector("article");
    const betaStaticBefore = rows.get("b")?.querySelector("i");
    const betaStaticAfter = rows.get("b")?.querySelector("b");

    await act(async () => {
      fixture.setItems((current) => {
        const [a, b, c] = current as Item[];
        return [
          { ...c, label: "Gamma newest", done: true, detail: false },
          { ...a, expanded: false },
          { ...b, label: "Beta newest", detail: true, expanded: true },
        ];
      });
      fixture.setPrefix("Live: ");
      await flushCompilerUpdates();
    });

    const reordered = [...container.querySelectorAll<HTMLElement>("[data-key]")];
    expect(reordered.map((row) => row.dataset.key)).toEqual(["c", "a", "b"]);
    expect(reordered[0]).toBe(rows.get("c"));
    expect(reordered[1]).toBe(rows.get("a"));
    expect(reordered[2]).toBe(rows.get("b"));
    expect(rows.get("b")?.querySelector("article")).toBe(betaArticle);
    expect(rows.get("b")?.querySelector("i")).toBe(betaStaticBefore);
    expect(rows.get("b")?.querySelector("b")).toBe(betaStaticAfter);
    expect(rows.get("b")?.querySelector("p")?.textContent).toBe("Live: Beta newest done");
    expect(rows.get("b")?.querySelector("small")?.textContent).toBe("Live: Beta newest");
    expect(rows.get("b")?.querySelector("em")?.textContent).toBe("Live: Beta newest");
    expect(rows.get("c")?.querySelector("article")?.style.opacity).toBe("0.7");
    expect(rows.get("a")?.querySelector("aside")?.textContent).toBe("Live: Open");
    expect(fixture.executions()).toBe(executionsAfterMount);
    expect(profilerCommits).toBe(commitsAfterMount);
  });

  it("combines parent props and local updates, then drops queued work on unmount", async () => {
    const fixture = createHostRowsFixture();
    function Parent() {
      const [prefix, setPrefix] = useState("Prop A");
      return (
        <>
          <button data-parent onClick={() => setPrefix("Prop B")} />
          <fixture.Rows prefix={prefix} />
        </>
      );
    }

    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<Parent />));

    await act(async () => {
      container.querySelector<HTMLButtonElement>("[data-parent]")?.click();
      fixture.setPrefix("Local: ");
      fixture.setItems((current) =>
        (current as Item[]).map((item) =>
          item.id === "a" ? { ...item, label: "Alpha updated", done: true } : item,
        ),
      );
      await flushCompilerUpdates();
    });
    expect(container.querySelector("main")?.getAttribute("data-owner-prefix")).toBe("Prop B");
    expect(container.querySelector('[data-key="a"] article p')?.textContent).toBe(
      "Local: Alpha updated done",
    );

    fixture.setItems((current) => [...(current as Item[])].reverse());
    await act(async () => root.unmount());
    roots.splice(roots.indexOf(root), 1);
    await flushCompilerUpdates();
    expect(container.innerHTML).toBe("");
  });

  it("preserves keyed state and replaces recursive descriptors through Fast Refresh", async () => {
    const hmrId = `keyed-row-host-blocks-refresh-${Math.random()}`;
    const definition = (prefix: string): CompiledComponentDefinition<Record<string, never>> => ({
      displayName: "RefreshKeyedRowHostBlocks",
      hmrId,
      stateSignature: "items",
      initialize: () => [[initialItems[1]]],
      render(_props, state, blocks) {
        const items = () => state[0].get() as Item[];
        const KeyedRows = blocks.KeyedRows;
        return (
          <main>
            <button
              onClick={() =>
                state[0].set((current) => [{ ...(current as Item[])[0], label: "Updated" }])
              }
              type="button"
            >
              Update
            </button>
            <KeyedRows
              bindings={rowBindings(() => prefix)}
              create={(item, index) => rowDescriptor(item as Item, index, prefix)}
              hostBlocks
              id={0}
              items={items}
              render={() => (
                <ul>
                  {items().map((item, index) => (
                    <RowMarkup item={item} index={index} key={item.id} prefix={prefix} />
                  ))}
                </ul>
              )}
              rowKey={(item) => (item as Item).id}
            />
          </main>
        );
      },
      bindings: [
        { kind: "block", id: 0, dependencies: [0] },
        { kind: "block", id: 1, parent: 0, dependencies: [] },
        { kind: "block", id: 2, parent: 1, dependencies: [] },
        { kind: "block", id: 3, parent: 0, dependencies: [] },
      ],
    });

    const Initial = createCompiledComponent(definition("Before: "));
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<Initial />));
    const row = container.querySelector("li");
    const branch = container.querySelector("article");

    let Refreshed = Initial;
    await act(async () => {
      Refreshed = createCompiledComponent(definition("After: "));
      root.render(<Refreshed />);
      await flushCompilerUpdates();
    });
    expect(Refreshed).toBe(Initial);
    expect(container.querySelector("li")).toBe(row);
    expect(container.querySelector("article")).toBe(branch);
    expect(container.querySelector("article p")?.textContent).toBe("After: Beta done");

    await act(async () => {
      container.querySelector<HTMLButtonElement>("button")?.click();
      await flushCompilerUpdates();
    });
    expect(container.querySelector("article")).toBe(branch);
    expect(container.querySelector("article p")?.textContent).toBe("After: Updated done");
  });

  it("falls back safely and stays live when runtime keys are duplicated", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    let setItems: (next: CompilerStateUpdater) => void = () => undefined;
    const BrokenRows = createCompiledComponent({
      displayName: "BrokenHostRows",
      initialize: () => [initialItems],
      render(_props: Record<string, never>, state, blocks) {
        setItems = state[0].set;
        const items = () => state[0].get() as Item[];
        const KeyedRows = blocks.KeyedRows;
        return (
          <main>
            <KeyedRows
              bindings={rowBindings(() => "")}
              create={(value, index) => rowDescriptor(value as Item, index, "")}
              hostBlocks
              id={0}
              items={items}
              render={() => (
                <ul>
                  {items().map((item, index) => (
                    <RowMarkup item={item} index={index} key={`${item.id}:${index}`} prefix="" />
                  ))}
                </ul>
              )}
              rowKey={(item) => (item as Item).id}
            />
          </main>
        );
      },
      bindings: [
        { kind: "block", id: 0, dependencies: [0] },
        { kind: "block", id: 1, parent: 0, dependencies: [] },
        { kind: "block", id: 2, parent: 1, dependencies: [] },
        { kind: "block", id: 3, parent: 0, dependencies: [] },
      ],
    });

    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () =>
      root.render(
        <Boundary>
          <BrokenRows />
        </Boundary>,
      ),
    );

    await act(async () => {
      setItems([
        { ...initialItems[0], label: "First" },
        { ...initialItems[0], label: "Duplicate" },
      ]);
      await flushCompilerUpdates();
    });
    expect(container.querySelectorAll("[data-key]")).toHaveLength(2);
    expect(container.textContent).toContain("Duplicate");

    await act(async () => {
      setItems([{ ...initialItems[2], id: "safe", label: "Safe again" }]);
      await flushCompilerUpdates();
    });
    expect(container.querySelector('[data-key="safe"] span')?.textContent).toBe("Safe again");
  });

  it("routes recursive row binding errors through the nearest React boundary", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    let setItems: (next: CompilerStateUpdater) => void = () => undefined;
    const ErrorRows = createCompiledComponent({
      displayName: "ErrorHostRows",
      initialize: () => [[initialItems[0]]],
      render(_props: Record<string, never>, state, blocks) {
        setItems = state[0].set;
        const items = () => state[0].get() as Item[];
        const KeyedRows = blocks.KeyedRows;
        return (
          <main>
            <KeyedRows
              bindings={rowBindings(() => "")}
              create={(value, index) => {
                const item = value as Item;
                const descriptor = rowDescriptor(item, index, "");
                const status = descriptor.children[1] as CompilerHostElement;
                const range =
                  status.block?.kind === "conditional-ranges" ? status.block.ranges[0] : null;
                if (range?.truthy && item.fail) {
                  range.truthy = {
                    ...range.truthy,
                    bindings: [
                      {
                        kind: "text",
                        path: [0],
                        read: () => {
                          throw new Error("keyed row host binding failed");
                        },
                      },
                    ],
                  };
                }
                return descriptor;
              }}
              hostBlocks
              id={0}
              items={items}
              render={() => (
                <ul>
                  {items().map((item, index) => (
                    <RowMarkup item={item} index={index} key={item.id} prefix="" />
                  ))}
                </ul>
              )}
              rowKey={(item) => (item as Item).id}
            />
          </main>
        );
      },
      bindings: [
        { kind: "block", id: 0, dependencies: [0] },
        { kind: "block", id: 1, parent: 0, dependencies: [] },
        { kind: "block", id: 2, parent: 1, dependencies: [] },
        { kind: "block", id: 3, parent: 0, dependencies: [] },
      ],
    });

    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () =>
      root.render(
        <Boundary>
          <ErrorRows />
        </Boundary>,
      ),
    );
    await act(async () => {
      setItems([{ ...initialItems[0], done: true, detail: true, fail: true }]);
      await flushCompilerUpdates();
    });
    expect(container.querySelector("[data-error]")?.textContent).toBe(
      "keyed row host binding failed",
    );
  });

  it("adopts server rows and remains live after recoverable hydration mismatches", async () => {
    for (const mismatch of [false, true]) {
      const fixture = createHostRowsFixture();
      const container = document.createElement("div");
      const serverHtml = renderToString(<fixture.Rows prefix="SSR: " />);
      container.innerHTML = mismatch ? serverHtml.replace("Alpha", "Server mismatch") : serverHtml;
      document.body.append(container);
      const recoverable = vi.fn();
      let root!: ReturnType<typeof hydrateRoot>;
      await act(async () => {
        root = hydrateRoot(container, <fixture.Rows prefix="SSR: " />, {
          onRecoverableError: recoverable,
        });
        await flushCompilerUpdates();
      });
      roots.push(root);

      expect(container.querySelector('[data-key="a"] span')?.textContent).toBe("SSR: Alpha");
      if (mismatch) expect(recoverable).toHaveBeenCalled();
      else expect(recoverable).not.toHaveBeenCalled();
      await act(async () => {
        fixture.setItems((current) =>
          (current as Item[]).map((item) =>
            item.id === "a" ? { ...item, label: "Hydrated", done: true, detail: true } : item,
          ),
        );
        await flushCompilerUpdates();
      });
      expect(container.querySelector('[data-key="a"] article p')?.textContent).toBe(
        "SSR: Hydrated done",
      );

      await act(async () => root.unmount());
      roots.splice(roots.indexOf(root), 1);
      container.remove();
    }
  });

  it("matches normal React through 2,000 deterministic row, branch, and order transitions", async () => {
    type Action = "reverse" | "rotate" | "toggle" | "detail" | "expand" | "edit" | "add" | "remove";
    let compiledSet: (next: CompilerStateUpdater) => void = () => undefined;
    let normalSet: React.Dispatch<React.SetStateAction<Item[]>> = () => undefined;
    let compiledExecutions = 0;

    const transition = (items: Item[], action: Action, step: number): Item[] => {
      if (action === "reverse") return [...items].reverse();
      if (action === "rotate" && items.length > 1) return [...items.slice(1), items[0]];
      if (action === "toggle" && items.length > 0) {
        return items.map((item, index) =>
          index === step % items.length ? { ...item, done: !item.done } : item,
        );
      }
      if (action === "detail" && items.length > 0) {
        return items.map((item, index) =>
          index === step % items.length ? { ...item, detail: !item.detail } : item,
        );
      }
      if (action === "expand" && items.length > 0) {
        return items.map((item, index) =>
          index === step % items.length ? { ...item, expanded: !item.expanded } : item,
        );
      }
      if (action === "edit" && items.length > 0) {
        return items.map((item, index) =>
          index === step % items.length ? { ...item, label: `${item.label}!` } : item,
        );
      }
      if (action === "add" && items.length < 12) {
        let candidate = step;
        const ids = new Set(items.map((item) => item.id));
        while (ids.has(`n${candidate}`)) candidate += 1;
        return [
          ...items,
          {
            id: `n${candidate}`,
            label: `New ${candidate}`,
            done: step % 2 === 0,
            detail: true,
            expanded: false,
          },
        ];
      }
      if (action === "remove" && items.length > 1) return items.slice(1);
      return items;
    };

    const Compiled = createCompiledComponent({
      displayName: "KeyedRowHostDifferential",
      initialize: () => [initialItems],
      render(_props: Record<string, never>, state, blocks) {
        compiledExecutions += 1;
        compiledSet = state[0].set;
        const items = () => state[0].get() as Item[];
        const KeyedRows = blocks.KeyedRows;
        return (
          <div data-compiled>
            <KeyedRows
              bindings={rowBindings(() => "Test: ")}
              create={(item, index) => rowDescriptor(item as Item, index, "Test: ")}
              hostBlocks
              id={0}
              items={items}
              render={() => (
                <ul>
                  {items().map((item, index) => (
                    <RowMarkup item={item} index={index} key={item.id} prefix="Test: " />
                  ))}
                </ul>
              )}
              rowKey={(item) => (item as Item).id}
            />
          </div>
        );
      },
      bindings: [
        { kind: "block", id: 0, dependencies: [0] },
        { kind: "block", id: 1, parent: 0, dependencies: [] },
        { kind: "block", id: 2, parent: 1, dependencies: [] },
        { kind: "block", id: 3, parent: 0, dependencies: [] },
      ],
    });

    function Normal() {
      const [items, setItems] = useState(initialItems);
      normalSet = setItems;
      return (
        <div data-normal>
          <ul>
            {items.map((item, index) => (
              <RowMarkup item={item} index={index} key={item.id} prefix="Test: " />
            ))}
          </ul>
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
    const executionsAfterMount = compiledExecutions;
    const actions: Action[] = [
      "reverse",
      "rotate",
      "toggle",
      "detail",
      "expand",
      "edit",
      "add",
      "remove",
    ];
    let random = 0x5eed1234;
    for (let step = 0; step < 2000; step += 1) {
      random = (random * 1664525 + 1013904223) >>> 0;
      const action = actions[random % actions.length];
      await act(async () => {
        compiledSet((current) => transition(current as Item[], action, step));
        normalSet((current) => transition(current, action, step));
        await flushCompilerUpdates();
      });
      expect(semanticRows(container, "[data-compiled] ul")).toEqual(
        semanticRows(container, "[data-normal] ul"),
      );
    }
    expect(compiledExecutions).toBe(executionsAfterMount);
  }, 15_000);
});
