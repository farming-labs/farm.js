import React, { StrictMode, useState } from "react";
import { act } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createCompiledComponent,
  type CompilerKeyedRowElement,
  type CompilerStateUpdater,
} from "../compiler-runtime";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

interface Item {
  id: string;
  label: string;
  done?: boolean;
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
  vi.restoreAllMocks();
});

async function flushCompilerUpdates(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function interactiveRowDescriptor(item: Item, index: number): CompilerKeyedRowElement {
  return {
    kind: "element",
    tag: "li",
    attributes: [
      { name: "data-key", value: item.id },
      { name: "data-done", value: Boolean(item.done) },
    ],
    styles: [],
    children: [
      {
        kind: "element",
        tag: "span",
        attributes: [],
        styles: [],
        children: [item.label],
      },
      {
        kind: "element",
        tag: "button",
        attributes: [
          { name: "data-index", value: index },
          { name: "type", value: "button" },
        ],
        styles: [],
        children: ["Select"],
      },
      {
        kind: "element",
        tag: "button",
        attributes: [{ name: "type", value: "button" }],
        styles: [],
        children: ["Stop"],
      },
    ],
  };
}

describe("interactive compiled keyed-row runtime", () => {
  it("patches same-key rows without rerendering and invokes events with the newest item", async () => {
    let executions = 0;
    let listRenders = 0;
    const calls: string[] = [];
    const Tasks = createCompiledComponent({
      displayName: "InteractiveTasks",
      initialize: () => [
        [
          { id: "a", label: "Alpha" },
          { id: "b", label: "Beta" },
        ],
      ],
      render(_props: Record<string, never>, state, blocks) {
        executions += 1;
        const items = () => state[0].get() as Item[];
        const KeyedRows = blocks.KeyedRows;
        return (
          <section>
            <button
              data-action="replace"
              onClick={() =>
                state[0].set((current) =>
                  (current as Item[]).map((item) =>
                    item.id === "b" ? { ...item, label: "Beta newest", done: true } : item,
                  ),
                )
              }
              type="button"
            >
              Replace
            </button>
            <KeyedRows
              bindings={[
                {
                  kind: "attribute",
                  name: "data-done",
                  path: [],
                  read: (item) => Boolean((item as Item).done),
                },
                {
                  kind: "text",
                  path: [0],
                  read: (item) => [(item as Item).label],
                },
                {
                  kind: "attribute",
                  name: "data-index",
                  path: [1],
                  read: (_item, index) => index,
                },
              ]}
              create={(item, index) => interactiveRowDescriptor(item as Item, index)}
              events={[
                {
                  name: "onClick",
                  invoke: (item, index, event) => {
                    const button = event.currentTarget as HTMLButtonElement;
                    calls.push(`select:${(item as Item).label}:${index}:${button.dataset.index}`);
                  },
                },
                {
                  name: "onClick",
                  invoke: (item, _index, event) => {
                    calls.push(`stop:${(item as Item).label}`);
                    event.stopPropagation();
                  },
                },
              ]}
              id={0}
              items={items}
              render={(rowEvent) => {
                listRenders += 1;
                return (
                  <ul
                    onClick={() => calls.push("bubble")}
                    onClickCapture={() => calls.push("capture")}
                  >
                    {items().map((item, index) => (
                      <li data-done={Boolean(item.done)} data-key={item.id} key={item.id}>
                        <span>{item.label}</span>
                        <button data-index={index} onClick={rowEvent(item, index, 0)} type="button">
                          Select
                        </button>
                        <button onClick={rowEvent(item, index, 1)} type="button">
                          Stop
                        </button>
                      </li>
                    ))}
                  </ul>
                );
              }}
              rowKey={(item) => (item as Item).id}
            />
          </section>
        );
      },
      bindings: [{ kind: "block", id: 0, dependencies: [0] }],
    });

    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<Tasks />));
    const beta = container.querySelector<HTMLLIElement>('[data-key="b"]')!;

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-action="replace"]')!.click();
      await flushCompilerUpdates();
    });

    expect(container.querySelector('[data-key="b"]')).toBe(beta);
    expect(beta.querySelector("span")?.textContent).toBe("Beta newest");
    expect(beta.dataset.done).toBe("true");
    expect(executions).toBe(1);
    expect(listRenders).toBe(1);

    await act(async () => beta.querySelectorAll("button")[0].click());
    expect(calls).toEqual(["capture", "select:Beta newest:1:1", "bubble"]);

    calls.length = 0;
    await act(async () => beta.querySelectorAll("button")[1].click());
    expect(calls).toEqual(["capture", "stop:Beta newest"]);
  });

  it("asks React to reconcile structural changes, then resumes direct patches", async () => {
    let executions = 0;
    let listRenders = 0;
    let updateItems: (next: CompilerStateUpdater) => void = () => undefined;
    const selected: string[] = [];
    const Tasks = createCompiledComponent({
      displayName: "StructuralInteractiveTasks",
      initialize: () => [
        [
          { id: "a", label: "Alpha" },
          { id: "b", label: "Beta" },
        ],
      ],
      render(_props: Record<string, never>, state, blocks) {
        executions += 1;
        updateItems = (next) => state[0].set(next);
        const items = () => state[0].get() as Item[];
        const KeyedRows = blocks.KeyedRows;
        return (
          <main>
            <KeyedRows
              bindings={[
                {
                  kind: "text",
                  path: [0],
                  read: (item) => [(item as Item).label],
                },
                {
                  kind: "attribute",
                  name: "data-index",
                  path: [1],
                  read: (_item, index) => index,
                },
              ]}
              create={(item, index) => interactiveRowDescriptor(item as Item, index)}
              events={[
                {
                  name: "onClick",
                  invoke: (item, index) => selected.push(`${(item as Item).label}:${index}`),
                },
              ]}
              id={0}
              items={items}
              render={(rowEvent) => {
                listRenders += 1;
                return (
                  <ul>
                    {items().map((item, index) => (
                      <li data-key={item.id} key={item.id}>
                        <span>{item.label}</span>
                        <button data-index={index} onClick={rowEvent(item, index, 0)} type="button">
                          Select
                        </button>
                        <button type="button">Stop</button>
                      </li>
                    ))}
                  </ul>
                );
              }}
              rowKey={(item) => (item as Item).id}
            />
          </main>
        );
      },
      bindings: [{ kind: "block", id: 0, dependencies: [0] }],
    });

    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<Tasks />));
    const original = new Map(
      [...container.querySelectorAll<HTMLLIElement>("li")].map((row) => [row.dataset.key, row]),
    );

    await act(async () => {
      updateItems([
        { id: "c", label: "Gamma" },
        { id: "b", label: "Beta moved" },
        { id: "a", label: "Alpha moved" },
      ]);
      await flushCompilerUpdates();
    });

    const rows = [...container.querySelectorAll<HTMLLIElement>("li")];
    expect(rows.map((row) => row.dataset.key)).toEqual(["c", "b", "a"]);
    expect(rows[1]).toBe(original.get("b"));
    expect(rows[2]).toBe(original.get("a"));
    expect(listRenders).toBe(2);
    expect(executions).toBe(1);

    await act(async () => rows[1].querySelector("button")!.click());
    expect(selected).toEqual(["Beta moved:1"]);

    await act(async () => {
      updateItems((current) =>
        (current as Item[]).map((item) =>
          item.id === "b" ? { ...item, label: "Beta patched" } : item,
        ),
      );
      await flushCompilerUpdates();
    });
    expect(rows[1].querySelector("span")?.textContent).toBe("Beta patched");
    expect(listRenders).toBe(2);

    await act(async () => rows[1].querySelector("button")!.click());
    expect(selected).toEqual(["Beta moved:1", "Beta patched:1"]);
  });

  it("uses per-render event closures after duplicate keys switch the rows to React fallback", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    let updateItems: (next: CompilerStateUpdater) => void = () => undefined;
    const observed: string[] = [];
    const Tasks = createCompiledComponent({
      displayName: "DuplicateInteractiveTasks",
      initialize: () => [
        [
          { id: "a", label: "Alpha" },
          { id: "b", label: "Beta" },
        ],
      ],
      render(_props: Record<string, never>, state, blocks) {
        updateItems = (next) => state[0].set(next);
        const items = () => state[0].get() as Item[];
        const KeyedRows = blocks.KeyedRows;
        return (
          <main>
            <KeyedRows
              bindings={[
                {
                  kind: "text",
                  path: [0],
                  read: (item) => [(item as Item).label],
                },
              ]}
              create={(item, index) => interactiveRowDescriptor(item as Item, index)}
              events={[
                {
                  name: "onClick",
                  invoke: (item, index) => observed.push(`${(item as Item).label}:${index}`),
                },
              ]}
              id={0}
              items={items}
              render={(rowEvent) => (
                <ul>
                  {items().map((item, index) => (
                    <li data-done={false} data-key={item.id} key={item.id}>
                      <span>{item.label}</span>
                      <button data-index={index} onClick={rowEvent(item, index, 0)} type="button">
                        Select
                      </button>
                      <button type="button">Stop</button>
                    </li>
                  ))}
                </ul>
              )}
              rowKey={(item) => (item as Item).id}
            />
          </main>
        );
      },
      bindings: [{ kind: "block", id: 0, dependencies: [0] }],
    });

    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<Tasks />));

    await act(async () => {
      updateItems([
        { id: "a", label: "Alpha first" },
        { id: "a", label: "Alpha second" },
      ]);
      await flushCompilerUpdates();
    });
    let buttons = [...container.querySelectorAll<HTMLButtonElement>("li button:first-of-type")];
    await act(async () => {
      buttons[0].click();
      buttons[1].click();
    });
    expect(observed).toEqual(["Alpha first:0", "Alpha second:1"]);

    await act(async () => {
      updateItems([
        { id: "a", label: "First newest" },
        { id: "a", label: "Second newest" },
      ]);
      await flushCompilerUpdates();
    });
    buttons = [...container.querySelectorAll<HTMLButtonElement>("li button:first-of-type")];
    await act(async () => buttons[1].click());
    expect(observed[observed.length - 1]).toBe("Second newest:1");
  });

  it("keeps row DOM state across updates while in duplicate-key fallback", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    let updateItems: (next: CompilerStateUpdater) => void = () => undefined;
    const Tasks = createCompiledComponent({
      displayName: "FallbackRowDomState",
      initialize: () => [
        [
          { id: "a", label: "Alpha" },
          { id: "b", label: "Beta" },
        ],
      ],
      render(_props: Record<string, never>, state, blocks) {
        updateItems = (next) => state[0].set(next);
        const items = () => state[0].get() as Item[];
        const KeyedRows = blocks.KeyedRows;
        return (
          <main>
            <KeyedRows
              bindings={[
                {
                  kind: "text",
                  path: [0],
                  read: (item) => [(item as Item).label],
                },
              ]}
              create={(item, index) => interactiveRowDescriptor(item as Item, index)}
              events={[]}
              id={0}
              items={items}
              render={() => (
                <ul>
                  {items().map((item, index) => (
                    <li data-done={false} data-key={item.id} key={`${item.id}-${index}`}>
                      <span>{item.label}</span>
                      <input data-row={index} />
                    </li>
                  ))}
                </ul>
              )}
              rowKey={(item) => (item as Item).id}
            />
          </main>
        );
      },
      bindings: [{ kind: "block", id: 0, dependencies: [0] }],
    });

    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<Tasks />));

    // Duplicate keys force the block into permanent React fallback.
    await act(async () => {
      updateItems([
        { id: "a", label: "Alpha first" },
        { id: "a", label: "Alpha second" },
      ]);
      await flushCompilerUpdates();
    });

    // Back to unique keys: still fallback, but reconciliation is safe again
    // (one final remount is allowed for this transition).
    await act(async () => {
      updateItems([
        { id: "a", label: "Alpha" },
        { id: "b", label: "Beta" },
      ]);
      await flushCompilerUpdates();
    });

    const input = container.querySelector<HTMLInputElement>("input[data-row='0']");
    expect(input).not.toBeNull();
    input!.value = "typed";

    // Unique-key updates while in fallback must reconcile in place instead of
    // remounting the list and wiping uncontrolled inputs.
    await act(async () => {
      updateItems([
        { id: "a", label: "Alpha renamed" },
        { id: "b", label: "Beta renamed" },
      ]);
      await flushCompilerUpdates();
    });

    expect([...container.querySelectorAll("li span")].map((node) => node.textContent)).toEqual([
      "Alpha renamed",
      "Beta renamed",
    ]);
    const afterUpdate = container.querySelector<HTMLInputElement>("input[data-row='0']");
    expect(afterUpdate).toBe(input);
    expect(afterUpdate!.value).toBe("typed");
  });

  it("hydrates in StrictMode, recovers mismatched text, and drops queued work after unmount", async () => {
    let executions = 0;
    const observed: string[] = [];
    const Tasks = createCompiledComponent({
      displayName: "HydratedInteractiveTasks",
      initialize: () => [[{ id: "a", label: "Alpha" }]],
      render(_props: Record<string, never>, state, blocks) {
        executions += 1;
        const items = () => state[0].get() as Item[];
        const KeyedRows = blocks.KeyedRows;
        return (
          <section>
            <button
              data-action="update"
              onClick={() => state[0].set([{ id: "a", label: "Client newest" }])}
              type="button"
            >
              Update
            </button>
            <KeyedRows
              bindings={[
                {
                  kind: "text",
                  path: [0],
                  read: (item) => [(item as Item).label],
                },
              ]}
              create={(item, index) => interactiveRowDescriptor(item as Item, index)}
              events={[
                {
                  name: "onClick",
                  invoke: (item) => observed.push((item as Item).label),
                },
              ]}
              id={0}
              items={items}
              render={(rowEvent) => (
                <ul>
                  {items().map((item, index) => (
                    <li data-key={item.id} key={item.id}>
                      <span>{item.label}</span>
                      <button data-index={index} onClick={rowEvent(item, index, 0)} type="button">
                        Select
                      </button>
                      <button type="button">Stop</button>
                    </li>
                  ))}
                </ul>
              )}
              rowKey={(item) => (item as Item).id}
            />
          </section>
        );
      },
      bindings: [{ kind: "block", id: 0, dependencies: [0] }],
    });

    const serverHtml = renderToString(
      <StrictMode>
        <Tasks />
      </StrictMode>,
    );
    const container = document.createElement("div");
    container.innerHTML = serverHtml.replace("Alpha", "Server mismatch");
    document.body.append(container);
    const recoverable = vi.fn();
    const root = hydrateRoot(
      container,
      <StrictMode>
        <Tasks />
      </StrictMode>,
      { onRecoverableError: recoverable },
    );
    roots.push(root);
    await act(async () => flushCompilerUpdates());

    expect(container.querySelector("li span")?.textContent).toBe("Alpha");
    expect(recoverable).toHaveBeenCalled();
    const mountedExecutions = executions;

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-action="update"]')!.click();
      await flushCompilerUpdates();
    });
    expect(container.querySelector("li span")?.textContent).toBe("Client newest");
    expect(executions).toBe(mountedExecutions);

    await act(async () =>
      container.querySelector<HTMLLIElement>("li")!.querySelector("button")!.click(),
    );
    expect(observed).toEqual(["Client newest"]);

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-action="update"]')!.click();
      root.unmount();
      await flushCompilerUpdates();
    });
    roots.splice(roots.indexOf(root), 1);
    expect(container.innerHTML).toBe("");
  });

  it("keeps a parent prop commit and a local row event coherent in the same turn", async () => {
    const observed: string[] = [];

    interface TasksProps {
      onPrefixChange(): void;
      prefix: string;
    }

    const Tasks = createCompiledComponent({
      displayName: "ParentInteractiveTasks",
      initialize: () => [[{ id: "a", label: "Alpha" }]],
      render(props: TasksProps, state, blocks) {
        const items = () => state[0].get() as Item[];
        const KeyedRows = blocks.KeyedRows;
        return (
          <section>
            <KeyedRows
              bindings={[
                {
                  kind: "text",
                  path: [0],
                  read: (item) => [`${props.prefix}:${(item as Item).label}`],
                },
              ]}
              create={(item) => ({
                ...interactiveRowDescriptor(item as Item, 0),
                children: [
                  {
                    kind: "element",
                    tag: "span",
                    attributes: [],
                    styles: [],
                    children: [`${props.prefix}:${(item as Item).label}`],
                  },
                  ...interactiveRowDescriptor(item as Item, 0).children.slice(1),
                ],
              })}
              events={[
                {
                  name: "onClick",
                  invoke: (item) => {
                    observed.push(`${props.prefix}:${(item as Item).label}`);
                    props.onPrefixChange();
                    state[0].set((current) =>
                      (current as Item[]).map((row) =>
                        row.id === (item as Item).id
                          ? { ...row, label: `${(item as Item).label}!` }
                          : row,
                      ),
                    );
                  },
                },
              ]}
              id={0}
              items={items}
              render={(rowEvent) => (
                <ul>
                  {items().map((item, index) => (
                    <li data-done={false} data-key={item.id} key={item.id}>
                      <span>
                        {props.prefix}:{item.label}
                      </span>
                      <button data-index={index} onClick={rowEvent(item, index, 0)} type="button">
                        Select
                      </button>
                      <button type="button">Stop</button>
                    </li>
                  ))}
                </ul>
              )}
              rowKey={(item) => (item as Item).id}
            />
          </section>
        );
      },
      bindings: [{ kind: "block", id: 0, dependencies: [0] }],
    });

    function Parent() {
      const [prefix, setPrefix] = useState("old");
      return <Tasks onPrefixChange={() => setPrefix("new")} prefix={prefix} />;
    }

    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<Parent />));

    await act(async () => {
      container.querySelector<HTMLButtonElement>("li button")!.click();
      await flushCompilerUpdates();
    });
    expect(container.querySelector("li span")?.textContent).toBe("new:Alpha!");
    expect(observed).toEqual(["old:Alpha"]);

    await act(async () => {
      container.querySelector<HTMLButtonElement>("li button")!.click();
      await flushCompilerUpdates();
    });
    expect(container.querySelector("li span")?.textContent).toBe("new:Alpha!!");
    expect(observed).toEqual(["old:Alpha", "new:Alpha!"]);
  });

  it("preserves row state and replaces event behavior through compatible Fast Refresh", async () => {
    const hmrId = `interactive-keyed-rows-refresh-${Math.random()}`;
    const observed: string[] = [];

    const defineTasks = (version: string) =>
      createCompiledComponent({
        displayName: "RefreshableInteractiveTasks",
        hmrId,
        stateSignature: "items",
        initialize: () => [[{ id: "a", label: "Alpha" }]],
        render(_props: Record<string, never>, state, blocks) {
          const items = () => state[0].get() as Item[];
          const KeyedRows = blocks.KeyedRows;
          return (
            <section>
              <KeyedRows
                bindings={[
                  {
                    kind: "text",
                    path: [0],
                    read: (item) => [(item as Item).label],
                  },
                ]}
                create={(item, index) => interactiveRowDescriptor(item as Item, index)}
                events={[
                  ...(version === "v2"
                    ? [
                        {
                          name: "onMouseEnter",
                          invoke: (item: unknown) => observed.push(`hover:${(item as Item).label}`),
                        },
                      ]
                    : []),
                  {
                    name: "onClick",
                    invoke: (item) => {
                      observed.push(`${version}:${(item as Item).label}`);
                      state[0].set((current) =>
                        (current as Item[]).map((row) =>
                          row.id === (item as Item).id
                            ? { ...row, label: `${(item as Item).label}!` }
                            : row,
                        ),
                      );
                    },
                  },
                ]}
                id={0}
                items={items}
                render={(rowEvent) => (
                  <ul>
                    {items().map((item, index) => (
                      <li data-done={false} data-key={item.id} key={item.id}>
                        <span>{item.label}</span>
                        <button
                          data-index={index}
                          onClick={rowEvent(item, index, version === "v2" ? 1 : 0)}
                          onMouseEnter={version === "v2" ? rowEvent(item, index, 0) : undefined}
                          type="button"
                        >
                          Select
                        </button>
                        <button type="button">Stop</button>
                      </li>
                    ))}
                  </ul>
                )}
                rowKey={(item) => (item as Item).id}
              />
            </section>
          );
        },
        bindings: [{ kind: "block" as const, id: 0, dependencies: [0] }],
      });

    const InitialTasks = defineTasks("v1");
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<InitialTasks />));
    const row = container.querySelector("li");

    await act(async () => {
      container.querySelector<HTMLButtonElement>("li button")!.click();
      await flushCompilerUpdates();
    });
    expect(container.querySelector("li span")?.textContent).toBe("Alpha!");
    expect(observed).toEqual(["v1:Alpha"]);

    let RefreshedTasks = InitialTasks;
    await act(async () => {
      RefreshedTasks = defineTasks("v2");
      root.render(<RefreshedTasks />);
      await flushCompilerUpdates();
    });
    expect(RefreshedTasks).toBe(InitialTasks);
    expect(container.querySelector("li")).toBe(row);
    expect(container.querySelector("li span")?.textContent).toBe("Alpha!");

    await act(async () => {
      container.querySelector<HTMLButtonElement>("li button")!.click();
      await flushCompilerUpdates();
    });
    expect(container.querySelector("li span")?.textContent).toBe("Alpha!!");
    expect(observed).toEqual(["v1:Alpha", "v2:Alpha!"]);
  });

  it("routes an interactive row binding failure through the nearest React error boundary", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    class Boundary extends React.Component<
      { children: React.ReactNode },
      { message: string | null }
    > {
      state = { message: null as string | null };

      static getDerivedStateFromError(error: Error) {
        return { message: error.message };
      }

      render() {
        return this.state.message ? <p data-error>{this.state.message}</p> : this.props.children;
      }
    }

    const Tasks = createCompiledComponent({
      displayName: "FailingInteractiveTasks",
      initialize: () => [[{ id: "a", label: "Alpha" }]],
      render(_props: Record<string, never>, state, blocks) {
        const items = () => state[0].get() as Item[];
        const KeyedRows = blocks.KeyedRows;
        return (
          <section>
            <KeyedRows
              bindings={[
                {
                  kind: "text",
                  path: [0],
                  read: (item) => {
                    if ((item as Item).label === "Crash") throw new Error("row binding failed");
                    return [(item as Item).label];
                  },
                },
              ]}
              create={(item, index) => interactiveRowDescriptor(item as Item, index)}
              events={[
                {
                  name: "onClick",
                  invoke: (item) =>
                    state[0].set((current) =>
                      (current as Item[]).map((row) =>
                        row.id === (item as Item).id ? { ...row, label: "Crash" } : row,
                      ),
                    ),
                },
              ]}
              id={0}
              items={items}
              render={(rowEvent) => (
                <ul>
                  {items().map((item, index) => (
                    <li data-done={false} data-key={item.id} key={item.id}>
                      <span>{item.label}</span>
                      <button data-index={index} onClick={rowEvent(item, index, 0)} type="button">
                        Select
                      </button>
                      <button type="button">Stop</button>
                    </li>
                  ))}
                </ul>
              )}
              rowKey={(item) => (item as Item).id}
            />
          </section>
        );
      },
      bindings: [{ kind: "block", id: 0, dependencies: [0] }],
    });

    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () =>
      root.render(
        <Boundary>
          <Tasks />
        </Boundary>,
      ),
    );

    await act(async () => {
      container.querySelector<HTMLButtonElement>("li button")!.click();
      await flushCompilerUpdates();
    });
    expect(container.querySelector("[data-error]")?.textContent).toBe("row binding failed");
  });

  it("matches React across 4,000 deterministic data, structure, and event transitions", async () => {
    interface Model {
      items: Item[];
      selected: string | null;
    }
    type Update = (model: Model) => Model;
    const initial: Model = {
      items: Array.from({ length: 12 }, (_, index) => ({
        id: `i${index}`,
        label: `Item ${index}`,
        done: false,
      })),
      selected: null,
    };
    let compiledSet: (next: CompilerStateUpdater) => void = () => undefined;
    let reactSet: React.Dispatch<React.SetStateAction<Model>> = () => undefined;
    let compiledRead: () => Model = () => initial;
    let normalCurrent = initial;
    let compiledExecutions = 0;
    let compiledListRenders = 0;

    const Compiled = createCompiledComponent({
      displayName: "DifferentialInteractiveRows",
      initialize: () => [initial],
      render(_props: Record<string, never>, state, blocks) {
        compiledExecutions += 1;
        compiledSet = (next) => state[0].set(next);
        const model = () => state[0].get() as Model;
        compiledRead = model;
        const items = () => model().items;
        const KeyedRows = blocks.KeyedRows;
        return (
          <main>
            <KeyedRows
              bindings={[
                {
                  kind: "attribute",
                  name: "data-done",
                  path: [],
                  read: (item) => Boolean((item as Item).done),
                },
                {
                  kind: "attribute",
                  name: "data-selected",
                  path: [],
                  read: (item) => model().selected === (item as Item).id,
                },
                {
                  kind: "text",
                  path: [0],
                  read: (item) => [(item as Item).label],
                },
              ]}
              create={(item) => {
                const row = item as Item;
                return {
                  kind: "element",
                  tag: "li",
                  attributes: [
                    { name: "data-key", value: row.id },
                    { name: "data-done", value: Boolean(row.done) },
                    { name: "data-selected", value: model().selected === row.id },
                  ],
                  styles: [],
                  children: [
                    {
                      kind: "element",
                      tag: "span",
                      attributes: [],
                      styles: [],
                      children: [row.label],
                    },
                    {
                      kind: "element",
                      tag: "button",
                      attributes: [{ name: "type", value: "button" }],
                      styles: [],
                      children: ["Toggle"],
                    },
                  ],
                };
              }}
              events={[
                {
                  name: "onClick",
                  invoke: (item) => {
                    const id = (item as Item).id;
                    state[0].set((current) => {
                      const value = current as Model;
                      return {
                        items: value.items.map((row) =>
                          row.id === id ? { ...row, done: !row.done } : row,
                        ),
                        selected: id,
                      };
                    });
                  },
                },
              ]}
              id={0}
              items={items}
              render={(rowEvent) => {
                compiledListRenders += 1;
                return (
                  <ul>
                    {items().map((item, index) => (
                      <li
                        data-done={Boolean(item.done)}
                        data-key={item.id}
                        data-selected={model().selected === item.id}
                        key={item.id}
                      >
                        <span>{item.label}</span>
                        <button onClick={rowEvent(item, index, 0)} type="button">
                          Toggle
                        </button>
                      </li>
                    ))}
                  </ul>
                );
              }}
              rowKey={(item) => (item as Item).id}
            />
          </main>
        );
      },
      bindings: [{ kind: "block", id: 0, dependencies: [0] }],
    });

    function Normal() {
      const [model, setModel] = useState(initial);
      normalCurrent = model;
      reactSet = setModel;
      return (
        <ul>
          {model.items.map((item) => (
            <li
              data-done={Boolean(item.done)}
              data-key={item.id}
              data-selected={model.selected === item.id}
              key={item.id}
            >
              <span>{item.label}</span>
              <button
                onClick={() =>
                  setModel((current) => ({
                    items: current.items.map((row) =>
                      row.id === item.id ? { ...row, done: !row.done } : row,
                    ),
                    selected: item.id,
                  }))
                }
                type="button"
              >
                Toggle
              </button>
            </li>
          ))}
        </ul>
      );
    }

    let seed = 0x1a2b3c4d;
    let nextId = 0;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed;
    };
    const updates: Update[] = Array.from({ length: 4000 }, () => {
      const operation = random() % 8;
      const selector = random();
      if (operation <= 3) {
        return (model) => {
          if (model.items.length === 0) return model;
          const selected = selector % model.items.length;
          return {
            ...model,
            items: model.items.map((item, index) =>
              index === selected
                ? {
                    ...item,
                    done: operation === 0 ? !item.done : item.done,
                    label: operation === 0 ? item.label : `${item.label}!`,
                  }
                : item,
            ),
          };
        };
      }
      if (operation === 4) {
        const id = `n${nextId++}`;
        return (model) =>
          model.items.length >= 32
            ? model
            : {
                ...model,
                items: [...model.items, { id, label: id.toUpperCase(), done: false }],
              };
      }
      if (operation === 5) {
        return (model) =>
          model.items.length === 0
            ? model
            : {
                ...model,
                items: model.items.filter((_, index) => index !== selector % model.items.length),
              };
      }
      if (operation === 6) {
        return (model) => ({ ...model, items: [...model.items].reverse() });
      }
      const destination = random();
      return (model) => {
        if (model.items.length < 2) return model;
        const items = [...model.items];
        const [item] = items.splice(selector % items.length, 1);
        items.splice(destination % (items.length + 1), 0, item);
        return { ...model, items };
      };
    });

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

    const snapshot = (container: Element) =>
      [...container.querySelectorAll("li")].map((row) => [
        row.getAttribute("data-key"),
        row.getAttribute("data-done"),
        row.getAttribute("data-selected"),
        row.querySelector("span")?.textContent,
      ]);

    for (let offset = 0; offset < updates.length; offset += 20) {
      await act(async () => {
        for (const update of updates.slice(offset, offset + 20)) {
          compiledSet((value) => update(value as Model));
          reactSet(update);
        }
        await flushCompilerUpdates();
      });
      expect(compiledRead(), `model after update batch ${offset}`).toEqual(normalCurrent);
      expect(snapshot(compiledContainer), `DOM after update batch ${offset}`).toEqual(
        snapshot(reactContainer),
      );

      const compiledButton = compiledContainer.querySelector<HTMLButtonElement>("li button");
      const reactButton = reactContainer.querySelector<HTMLButtonElement>("li button");
      if (compiledButton && reactButton) {
        await act(async () => {
          compiledButton.click();
          reactButton.click();
          await flushCompilerUpdates();
        });
        expect(compiledRead(), `model after event batch ${offset}`).toEqual(normalCurrent);
        expect(snapshot(compiledContainer), `DOM after event batch ${offset}`).toEqual(
          snapshot(reactContainer),
        );
      }
    }

    expect(compiledExecutions).toBe(1);
    expect(compiledListRenders).toBeLessThanOrEqual(201);
  }, 30_000);
});
