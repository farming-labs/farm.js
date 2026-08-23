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
  done: boolean;
  expanded?: boolean;
  fail?: boolean;
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

function rowDescriptor(item: Item, index: number): CompilerKeyedRowElement {
  return {
    kind: "element",
    tag: "li",
    attributes: [
      { name: "data-key", value: item.id },
      { name: "data-index", value: index },
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
        tag: "div",
        attributes: [{ name: "data-status", value: "" }],
        styles: [],
        children: [],
      },
      {
        kind: "element",
        tag: "section",
        attributes: [{ name: "data-details", value: "" }],
        styles: [],
        children: [],
      },
    ],
  };
}

function rowBindings() {
  return [
    {
      kind: "attribute" as const,
      name: "data-index",
      path: [] as const,
      read: (_item: unknown, index: number) => index,
    },
    {
      kind: "text" as const,
      path: [0] as const,
      read: (item: unknown) => [(item as Item).label],
    },
  ];
}

function rowConditionals() {
  return [
    {
      id: 0,
      path: [1],
      logical: false,
      test: (item: unknown) => (item as Item).done,
      truthy: {
        bindings: [
          {
            kind: "text" as const,
            path: [] as const,
            read: (item: unknown) => [(item as Item).label],
          },
        ],
      },
      falsy: { bindings: [] },
    },
    {
      id: 1,
      path: [2],
      logical: true,
      test: (item: unknown) => (item as Item).expanded,
      truthy: {
        bindings: [
          {
            kind: "text" as const,
            path: [] as const,
            read: (item: unknown) => [(item as Item).label],
          },
        ],
      },
    },
  ];
}

describe("compiled keyed-row conditionals runtime", () => {
  it("refreshes only the changed conditional in the changed keyed row", async () => {
    let executions = 0;
    let listRenders = 0;
    let setItems: (next: CompilerStateUpdater) => void = () => undefined;
    const conditionalRenders = new Map<string, number>();
    const Tasks = createCompiledComponent({
      displayName: "RowLocalConditionals",
      initialize: () => [
        [
          { id: "a", label: "Alpha", done: false, expanded: false },
          { id: "b", label: "Beta", done: false, expanded: true },
        ],
      ],
      render(_props: Record<string, never>, state, blocks) {
        executions += 1;
        setItems = (next) => state[0].set(next);
        const items = () => state[0].get() as Item[];
        const KeyedRows = blocks.KeyedRows;
        return (
          <main>
            <KeyedRows
              bindings={rowBindings()}
              conditionals={rowConditionals()}
              create={(item, index) => rowDescriptor(item as Item, index)}
              id={0}
              items={items}
              render={(_rowEvent, rowConditional) => {
                listRenders += 1;
                return (
                  <ul>
                    {items().map((item, index) => (
                      <li data-index={index} data-key={item.id} key={item.id}>
                        <span>{item.label}</span>
                        <div data-status>
                          {rowConditional(item, index, 0, (current) => {
                            const latest = current as Item;
                            conditionalRenders.set(
                              `status:${latest.id}`,
                              (conditionalRenders.get(`status:${latest.id}`) || 0) + 1,
                            );
                            return latest.done ? (
                              <strong>{latest.label} completed</strong>
                            ) : (
                              <small>Open</small>
                            );
                          })}
                        </div>
                        <section data-details>
                          {rowConditional(item, index, 1, (current) => {
                            const latest = current as Item;
                            conditionalRenders.set(
                              `details:${latest.id}`,
                              (conditionalRenders.get(`details:${latest.id}`) || 0) + 1,
                            );
                            return latest.expanded ? <p>{latest.label} details</p> : null;
                          })}
                        </section>
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

    const alpha = container.querySelector<HTMLLIElement>('[data-key="a"]')!;
    const beta = container.querySelector<HTMLLIElement>('[data-key="b"]')!;
    const initialRenders = new Map(conditionalRenders);

    await act(async () => {
      setItems((current) =>
        (current as Item[]).map((item) =>
          item.id === "b" ? { ...item, label: "Beta newest", done: true } : item,
        ),
      );
      await flushCompilerUpdates();
    });

    expect(container.querySelector('[data-key="a"]')).toBe(alpha);
    expect(container.querySelector('[data-key="b"]')).toBe(beta);
    expect(beta.querySelector("span")?.textContent).toBe("Beta newest");
    expect(beta.querySelector("[data-status]")?.textContent).toBe("Beta newest completed");
    expect(beta.querySelector("[data-details]")?.textContent).toBe("Beta newest details");
    expect(conditionalRenders.get("status:a")).toBe(initialRenders.get("status:a"));
    expect(conditionalRenders.get("details:a")).toBe(initialRenders.get("details:a"));
    expect(conditionalRenders.get("status:b")).toBe((initialRenders.get("status:b") || 0) + 1);
    expect(conditionalRenders.get("details:b")).toBe((initialRenders.get("details:b") || 0) + 1);
    expect(executions).toBe(1);
    expect(listRenders).toBe(1);
  });

  it("lets React reorder row-local boundaries, preserves keyed DOM, then resumes direct refreshes", async () => {
    let executions = 0;
    let listRenders = 0;
    let setItems: (next: CompilerStateUpdater) => void = () => undefined;
    const Tasks = createCompiledComponent({
      displayName: "StructuralRowConditionals",
      initialize: () => [
        [
          { id: "a", label: "Alpha", done: false },
          { id: "b", label: "Beta", done: true },
          { id: "c", label: "Gamma", done: false },
        ],
      ],
      render(_props: Record<string, never>, state, blocks) {
        executions += 1;
        setItems = (next) => state[0].set(next);
        const items = () => state[0].get() as Item[];
        const KeyedRows = blocks.KeyedRows;
        return (
          <main>
            <KeyedRows
              bindings={rowBindings()}
              conditionals={rowConditionals().slice(0, 1)}
              create={(item, index) => rowDescriptor(item as Item, index)}
              id={0}
              items={items}
              render={(_rowEvent, rowConditional) => {
                listRenders += 1;
                return (
                  <ul>
                    {items().map((item, index) => (
                      <li data-index={index} data-key={item.id} key={item.id}>
                        <span>{item.label}</span>
                        <div data-status>
                          {rowConditional(item, index, 0, (current) =>
                            (current as Item).done ? (
                              <strong>{(current as Item).label} completed</strong>
                            ) : (
                              <small>Open</small>
                            ),
                          )}
                        </div>
                        <section data-details />
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
      setItems([
        { id: "c", label: "Gamma", done: true },
        { id: "a", label: "Alpha", done: false },
        { id: "b", label: "Beta newest", done: true },
      ]);
      await flushCompilerUpdates();
    });

    const rows = [...container.querySelectorAll<HTMLLIElement>("li")];
    expect(rows.map((row) => row.dataset.key)).toEqual(["c", "a", "b"]);
    expect(rows.every((row) => row === original.get(row.dataset.key))).toBe(true);
    expect(rows[0].querySelector("[data-status]")?.textContent).toBe("Gamma completed");
    expect(rows[2].querySelector("[data-status]")?.textContent).toBe("Beta newest completed");
    expect(executions).toBe(1);
    expect(listRenders).toBe(2);

    await act(async () => {
      setItems((current) =>
        (current as Item[]).map((item) => (item.id === "a" ? { ...item, done: true } : item)),
      );
      await flushCompilerUpdates();
    });
    expect(container.querySelector('[data-key="a"] [data-status]')?.textContent).toBe(
      "Alpha completed",
    );
    expect(listRenders).toBe(2);
  });

  it("updates a row conditional from a React event without stale item data", async () => {
    const observed: string[] = [];
    let listRenders = 0;
    const Tasks = createCompiledComponent({
      displayName: "InteractiveRowConditionals",
      initialize: () => [[{ id: "a", label: "Alpha", done: false }]],
      render(_props: Record<string, never>, state, blocks) {
        const items = () => state[0].get() as Item[];
        const KeyedRows = blocks.KeyedRows;
        return (
          <main>
            <KeyedRows
              bindings={rowBindings()}
              conditionals={rowConditionals().slice(0, 1)}
              create={(item, index) => ({
                ...rowDescriptor(item as Item, index),
                children: [
                  ...rowDescriptor(item as Item, index).children.slice(0, 2),
                  {
                    kind: "element",
                    tag: "section",
                    attributes: [{ name: "data-details", value: "" }],
                    styles: [],
                    children: [
                      {
                        kind: "element",
                        tag: "button",
                        attributes: [{ name: "type", value: "button" }],
                        styles: [],
                        children: ["Toggle"],
                      },
                    ],
                  },
                ],
              })}
              events={[
                {
                  name: "onClick",
                  invoke: (item) => {
                    const current = item as Item;
                    observed.push(`${current.label}:${current.done}`);
                    state[0].set([{ ...current, label: `${current.label}!`, done: !current.done }]);
                  },
                },
              ]}
              id={0}
              items={items}
              render={(rowEvent, rowConditional) => {
                listRenders += 1;
                return (
                  <ul>
                    {items().map((item, index) => (
                      <li data-index={index} data-key={item.id} key={item.id}>
                        <span>{item.label}</span>
                        <div data-status>
                          {rowConditional(item, index, 0, (current) =>
                            (current as Item).done ? <strong>Done</strong> : <small>Open</small>,
                          )}
                        </div>
                        <section data-details>
                          <button onClick={rowEvent(item, index, 0)} type="button">
                            Toggle
                          </button>
                        </section>
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

    await act(async () => {
      container.querySelector<HTMLButtonElement>("button")!.click();
      await flushCompilerUpdates();
    });
    expect(container.querySelector("li span")?.textContent).toBe("Alpha!");
    expect(container.querySelector("[data-status]")?.textContent).toBe("Done");
    expect(listRenders).toBe(1);

    await act(async () => {
      container.querySelector<HTMLButtonElement>("button")!.click();
      await flushCompilerUpdates();
    });
    expect(container.querySelector("li span")?.textContent).toBe("Alpha!!");
    expect(container.querySelector("[data-status]")?.textContent).toBe("Open");
    expect(observed).toEqual(["Alpha:false", "Alpha!:true"]);
    expect(listRenders).toBe(1);
  });

  it("keeps a parent prop commit and row-local conditional update coherent in one turn", async () => {
    interface TasksProps {
      prefix: string;
      changePrefix(): void;
    }

    const Tasks = createCompiledComponent({
      displayName: "ParentRowConditionals",
      initialize: () => [[{ id: "a", label: "Alpha", done: false }]],
      render(props: TasksProps, state, blocks) {
        const items = () => state[0].get() as Item[];
        const KeyedRows = blocks.KeyedRows;
        const conditionals = rowConditionals().slice(0, 1);
        conditionals[0] = {
          ...conditionals[0],
          truthy: {
            bindings: [
              {
                kind: "text",
                path: [],
                read: (item) => [`${props.prefix}:${(item as Item).label}`],
              },
            ],
          },
        };
        return (
          <main>
            <KeyedRows
              bindings={rowBindings()}
              conditionals={conditionals}
              create={(item, index) => ({
                ...rowDescriptor(item as Item, index),
                children: [
                  ...rowDescriptor(item as Item, index).children.slice(0, 2),
                  {
                    kind: "element",
                    tag: "section",
                    attributes: [{ name: "data-details", value: "" }],
                    styles: [],
                    children: [
                      {
                        kind: "element",
                        tag: "button",
                        attributes: [{ name: "type", value: "button" }],
                        styles: [],
                        children: ["Update"],
                      },
                    ],
                  },
                ],
              })}
              events={[
                {
                  name: "onClick",
                  invoke: (item) => {
                    props.changePrefix();
                    state[0].set([{ ...(item as Item), label: "Newest", done: true }]);
                  },
                },
              ]}
              id={0}
              items={items}
              render={(rowEvent, rowConditional) => (
                <ul>
                  {items().map((item, index) => (
                    <li data-index={index} data-key={item.id} key={item.id}>
                      <span>{item.label}</span>
                      <div data-status>
                        {rowConditional(item, index, 0, (current) =>
                          (current as Item).done ? (
                            <strong>
                              {props.prefix}:{(current as Item).label}
                            </strong>
                          ) : (
                            <small>Open</small>
                          ),
                        )}
                      </div>
                      <section data-details>
                        <button onClick={rowEvent(item, index, 0)} type="button">
                          Update
                        </button>
                      </section>
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

    function Parent() {
      const [prefix, setPrefix] = useState("old");
      return <Tasks changePrefix={() => setPrefix("new")} prefix={prefix} />;
    }

    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<Parent />));

    await act(async () => {
      container.querySelector<HTMLButtonElement>("button")!.click();
      await flushCompilerUpdates();
    });
    expect(container.querySelector("li span")?.textContent).toBe("Newest");
    expect(container.querySelector("[data-status]")?.textContent).toBe("new:Newest");
  });

  it("switches duplicate runtime keys to ordinary React conditional rendering", async () => {
    let setItems: (next: CompilerStateUpdater) => void = () => undefined;
    let listRenders = 0;
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const Tasks = createCompiledComponent({
      displayName: "DuplicateRowConditionals",
      initialize: () => [[{ id: "a", label: "Alpha", done: false }]],
      render(_props: Record<string, never>, state, blocks) {
        setItems = (next) => state[0].set(next);
        const items = () => state[0].get() as Item[];
        const KeyedRows = blocks.KeyedRows;
        return (
          <main>
            <KeyedRows
              bindings={rowBindings()}
              conditionals={rowConditionals().slice(0, 1)}
              create={(item, index) => rowDescriptor(item as Item, index)}
              id={0}
              items={items}
              render={(_rowEvent, rowConditional) => {
                listRenders += 1;
                return (
                  <ul>
                    {items().map((item, index) => (
                      <li data-index={index} data-key={item.id} key={`${item.id}:${index}`}>
                        <span>{item.label}</span>
                        <div data-status>
                          {rowConditional(item, index, 0, (current) =>
                            (current as Item).done ? <strong>Done</strong> : <small>Open</small>,
                          )}
                        </div>
                        <section data-details />
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

    await act(async () => {
      setItems([
        { id: "a", label: "First", done: false },
        { id: "a", label: "Second", done: true },
      ]);
      await flushCompilerUpdates();
    });
    expect(
      [...container.querySelectorAll("[data-status]")].map((node) => node.textContent),
    ).toEqual(["Open", "Done"]);

    await act(async () => {
      setItems([
        { id: "a", label: "First newest", done: true },
        { id: "a", label: "Second newest", done: false },
      ]);
      await flushCompilerUpdates();
    });
    expect(
      [...container.querySelectorAll("[data-status]")].map((node) => node.textContent),
    ).toEqual(["Done", "Open"]);
    expect(listRenders).toBeGreaterThan(1);
  });

  it("preserves keyed state and replaces conditional behavior through compatible Fast Refresh", async () => {
    const hmrId = `keyed-row-conditionals-refresh-${Math.random()}`;

    const defineTasks = (version: "v1" | "v2") =>
      createCompiledComponent({
        displayName: "RefreshableRowConditionals",
        hmrId,
        stateSignature: "items",
        initialize: () => [[{ id: "a", label: "Alpha", done: true, expanded: true }]],
        render(_props: Record<string, never>, state, blocks) {
          const items = () => state[0].get() as Item[];
          const KeyedRows = blocks.KeyedRows;
          const conditionals = rowConditionals().slice(0, version === "v2" ? 2 : 1);
          conditionals[0] = {
            ...conditionals[0],
            truthy: {
              bindings: [
                {
                  kind: "text",
                  path: [],
                  read: (item) => [`${version}:${(item as Item).label}`],
                },
              ],
            },
          };
          return (
            <main>
              <button
                onClick={() => state[0].set([{ ...items()[0], label: "Updated" }])}
                type="button"
              >
                Update
              </button>
              <KeyedRows
                bindings={rowBindings()}
                conditionals={conditionals}
                create={(item, index) => rowDescriptor(item as Item, index)}
                id={0}
                items={items}
                render={(_rowEvent, rowConditional) => (
                  <ul>
                    {items().map((item, index) => (
                      <li data-index={index} data-key={item.id} key={item.id}>
                        <span>{item.label}</span>
                        <div data-status>
                          {rowConditional(item, index, 0, (current) =>
                            (current as Item).done ? (
                              <strong>
                                {version}:{(current as Item).label}
                              </strong>
                            ) : null,
                          )}
                        </div>
                        <section data-details>
                          {version === "v2"
                            ? rowConditional(item, index, 1, (current) =>
                                (current as Item).expanded ? <p>Expanded</p> : null,
                              )
                            : null}
                        </section>
                      </li>
                    ))}
                  </ul>
                )}
                rowKey={(item) => (item as Item).id}
              />
            </main>
          );
        },
        bindings: [{ kind: "block" as const, id: 0, dependencies: [0] }],
      });

    const Initial = defineTasks("v1");
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<Initial />));
    const row = container.querySelector("li");

    let Refreshed = Initial;
    await act(async () => {
      Refreshed = defineTasks("v2");
      root.render(<Refreshed />);
      await flushCompilerUpdates();
    });
    expect(Refreshed).toBe(Initial);
    expect(container.querySelector("li")).toBe(row);
    expect(container.querySelector("[data-status]")?.textContent).toBe("v2:Alpha");
    expect(container.querySelector("[data-details]")?.textContent).toBe("Expanded");

    await act(async () => {
      container.querySelector<HTMLButtonElement>("button")!.click();
      await flushCompilerUpdates();
    });
    expect(container.querySelector("[data-status]")?.textContent).toBe("v2:Updated");
  });

  it("hydrates in StrictMode, recovers mismatches, and drops queued conditional work on unmount", async () => {
    let setItems: (next: CompilerStateUpdater) => void = () => undefined;
    const Tasks = createCompiledComponent({
      displayName: "HydratedRowConditionals",
      initialize: () => [[{ id: "a", label: "Alpha", done: false }]],
      render(_props: Record<string, never>, state, blocks) {
        setItems = (next) => state[0].set(next);
        const items = () => state[0].get() as Item[];
        const KeyedRows = blocks.KeyedRows;
        return (
          <main>
            <KeyedRows
              bindings={rowBindings()}
              conditionals={rowConditionals().slice(0, 1)}
              create={(item, index) => rowDescriptor(item as Item, index)}
              id={0}
              items={items}
              render={(_rowEvent, rowConditional) => (
                <ul>
                  {items().map((item, index) => (
                    <li data-index={index} data-key={item.id} key={item.id}>
                      <span>{item.label}</span>
                      <div data-status>
                        {rowConditional(item, index, 0, (current) =>
                          (current as Item).done ? <strong>Done</strong> : <small>Open</small>,
                        )}
                      </div>
                      <section data-details />
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

    const serverHtml = renderToString(
      <StrictMode>
        <Tasks />
      </StrictMode>,
    );
    const container = document.createElement("div");
    container.innerHTML = serverHtml.replace("Open", "Server mismatch");
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

    expect(container.querySelector("[data-status]")?.textContent).toBe("Open");
    expect(recoverable).toHaveBeenCalled();

    await act(async () => {
      setItems([{ id: "a", label: "Client", done: true }]);
      await flushCompilerUpdates();
    });
    expect(container.querySelector("li span")?.textContent).toBe("Client");
    expect(container.querySelector("[data-status]")?.textContent).toBe("Done");

    await act(async () => {
      setItems([{ id: "a", label: "Queued", done: false }]);
      root.unmount();
      await flushCompilerUpdates();
    });
    roots.splice(roots.indexOf(root), 1);
    expect(container.innerHTML).toBe("");
  });

  it("routes conditional snapshot failures through the nearest React error boundary", async () => {
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

    const conditionals = rowConditionals().slice(0, 1);
    conditionals[0] = {
      ...conditionals[0],
      truthy: {
        bindings: [
          {
            kind: "text",
            path: [],
            read: (item) => {
              if ((item as Item).fail) throw new Error("row conditional failed");
              return [(item as Item).label];
            },
          },
        ],
      },
    };
    const Tasks = createCompiledComponent({
      displayName: "FailingRowConditional",
      initialize: () => [[{ id: "a", label: "Alpha", done: false }]],
      render(_props: Record<string, never>, state, blocks) {
        const items = () => state[0].get() as Item[];
        const KeyedRows = blocks.KeyedRows;
        return (
          <main>
            <button
              onClick={() => state[0].set([{ id: "a", label: "Broken", done: true, fail: true }])}
              type="button"
            >
              Break
            </button>
            <KeyedRows
              bindings={rowBindings()}
              conditionals={conditionals}
              create={(item, index) => rowDescriptor(item as Item, index)}
              id={0}
              items={items}
              render={(_rowEvent, rowConditional) => (
                <ul>
                  {items().map((item, index) => (
                    <li data-index={index} data-key={item.id} key={item.id}>
                      <span>{item.label}</span>
                      <div data-status>
                        {rowConditional(item, index, 0, (current) =>
                          (current as Item).done ? (
                            <strong>{(current as Item).label}</strong>
                          ) : null,
                        )}
                      </div>
                      <section data-details />
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
    await act(async () =>
      root.render(
        <Boundary>
          <Tasks />
        </Boundary>,
      ),
    );

    await act(async () => {
      container.querySelector<HTMLButtonElement>("button")!.click();
      await flushCompilerUpdates();
    });
    expect(container.querySelector("[data-error]")?.textContent).toBe("row conditional failed");
  });

  it("matches React through 2,000 deterministic data and structural transitions", async () => {
    let compiledSet: (next: CompilerStateUpdater) => void = () => undefined;
    let reactSet: React.Dispatch<React.SetStateAction<Item[]>> = () => undefined;
    let compiledExecutions = 0;
    const initial: Item[] = [
      { id: "a", label: "A", done: false },
      { id: "b", label: "B", done: true },
      { id: "c", label: "C", done: false },
    ];

    const view = (items: Item[]) => (
      <main>
        <ul>
          {items.map((item, index) => (
            <li data-index={index} data-key={item.id} key={item.id}>
              <span>{item.label}</span>
              <div data-status>
                {item.done ? <strong>{item.label} done</strong> : <small>Open</small>}
              </div>
              <section data-details />
            </li>
          ))}
        </ul>
      </main>
    );

    const Compiled = createCompiledComponent({
      displayName: "DifferentialRowConditionals",
      initialize: () => [initial],
      render(_props: Record<string, never>, state, blocks) {
        compiledExecutions += 1;
        compiledSet = (next) => state[0].set(next);
        const items = () => state[0].get() as Item[];
        const KeyedRows = blocks.KeyedRows;
        return (
          <main>
            <KeyedRows
              bindings={rowBindings()}
              conditionals={rowConditionals().slice(0, 1)}
              create={(item, index) => rowDescriptor(item as Item, index)}
              id={0}
              items={items}
              render={(_rowEvent, rowConditional) => (
                <ul>
                  {items().map((item, index) => (
                    <li data-index={index} data-key={item.id} key={item.id}>
                      <span>{item.label}</span>
                      <div data-status>
                        {rowConditional(item, index, 0, (current) =>
                          (current as Item).done ? (
                            <strong>{(current as Item).label} done</strong>
                          ) : (
                            <small>Open</small>
                          ),
                        )}
                      </div>
                      <section data-details />
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

    function Baseline() {
      const [items, setItems] = useState(initial);
      reactSet = setItems;
      return view(items);
    }

    const compiledContainer = document.createElement("div");
    const reactContainer = document.createElement("div");
    document.body.append(compiledContainer, reactContainer);
    const compiledRoot = createRoot(compiledContainer);
    const reactRoot = createRoot(reactContainer);
    roots.push(compiledRoot, reactRoot);
    await act(async () => {
      compiledRoot.render(<Compiled />);
      reactRoot.render(<Baseline />);
    });

    for (let step = 0; step < 2_000; step += 1) {
      const update = (items: Item[]): Item[] => {
        const next = items.map((item) => ({ ...item }));
        const operation = step % 5;
        if (operation === 0 && next.length > 0) {
          const index = step % next.length;
          next[index] = {
            ...next[index],
            label: `${next[index].id}-${step}`,
            done: !next[index].done,
          };
        } else if (operation === 1 && next.length > 1) {
          next.unshift(next.pop()!);
        } else if (operation === 2 && next.length < 7) {
          const id = `n${step}`;
          next.splice(step % (next.length + 1), 0, { id, label: id, done: step % 2 === 0 });
        } else if (operation === 3 && next.length > 2) {
          next.splice(step % next.length, 1);
        } else {
          next.reverse();
        }
        return next;
      };

      await act(async () => {
        compiledSet((current) => update(current as Item[]));
        reactSet((current) => update(current));
        await flushCompilerUpdates();
      });
      expect(compiledContainer.innerHTML).toBe(reactContainer.innerHTML);
    }

    expect(compiledExecutions).toBe(1);
  }, 20_000);
});
