// @vitest-environment node

import { describe, expect, it } from "vitest";
import { transformWithEsbuild } from "vite";
import { compileReactModule } from "../compiler";
import { normalizeReactCompilerOptions } from "../index";

const infer = normalizeReactCompilerOptions(true);

async function compile(source: string) {
  return compileReactModule(source, "/app/KeyedRowHostBlocks.tsx", infer);
}

describe("React AOT compiler-owned keyed-row host blocks", () => {
  it("prepares multiple and recursively nested host conditionals for automatic map syntax", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function Inbox({ emphasized }) {
        const [items, setItems] = useState([
          { id: "a", label: "Alpha", done: false, expanded: true, detail: true },
        ]);
        return (
          <main>
            <button onClick={() => setItems((rows) => [...rows].reverse())}>Reverse</button>
            <ul data-list>
              {items.map((item, index) => (
                <li key={item.id} data-index={index}>
                  <span>{item.label}</span>
                  <div>
                    <i>State</i>
                    {item.done && <strong className={emphasized ? "hot" : "calm"}>Done</strong>}
                    <b>After</b>
                  </div>
                  <section>
                    {item.expanded ? (
                      <article>
                        <p>{item.label} details</p>
                        <div>{item.detail && <small title={item.label}>More</small>}</div>
                      </article>
                    ) : (
                      <aside>Closed</aside>
                    )}
                  </section>
                </li>
              ))}
            </ul>
          </main>
        );
      }
    `);

    expect(result.compiled).toEqual(["Inbox"]);
    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain("farmBlocks.KeyedRows");
    expect(result.code).toContain("hostBlocks={true}");
    expect(result.code.match(/kind: "conditional-ranges"/g)).toHaveLength(4);
    expect(result.code).toContain("parent: 0");
    expect(result.code).toContain("parent: 2");
    expect(result.code).not.toContain("_farmRowConditional");
    expect(result.code).not.toContain('name: "key"');
    await expect(
      transformWithEsbuild(result.code, "/app/KeyedRowHostBlocks.tsx", {
        loader: "tsx",
        jsx: "automatic",
      }),
    ).resolves.toMatchObject({ code: expect.stringContaining("hostBlocks") });
  });

  it("supports the public List primitive without requiring another option", async () => {
    const result = await compile(`
      import { useState } from "react";
      import { List } from "@farm.js/react/list";
      export function Inbox() {
        const [items, setItems] = useState([{ id: "a", label: "Alpha", visible: true }]);
        return (
          <main>
            <button onClick={() => setItems((rows) => [...rows])}>Refresh</button>
            <ul>
              <List each={items} by={(item) => item.id}>
                {(item, index) => (
                  <li data-index={index}>
                    <span>{item.label}</span>
                    <div>{item.visible ? <strong>{item.label}</strong> : <small>Hidden</small>}</div>
                  </li>
                )}
              </List>
            </ul>
          </main>
        );
      }
    `);

    expect(result.compiled).toEqual(["Inbox"]);
    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain("farmBlocks.KeyedRows");
    expect(result.code).toContain("hostBlocks={true}");
    expect(result.code).toContain('kind: "conditional-ranges"');
    expect(result.code).not.toContain("_farmRowConditional");
  });

  it("keeps component state and prop reads on the parent keyed dependency", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function Inbox({ suffix }) {
        const [items, setItems] = useState([{ id: "a", label: "Alpha", visible: true }]);
        const [tone, setTone] = useState("warm");
        return (
          <main>
            <button onClick={() => setItems((rows) => [...rows])}>Refresh</button>
            <button onClick={() => setTone((value) => value === "warm" ? "cool" : "warm")}>Tone</button>
            <ul>
              {items.map((item) => (
                <li key={item.id}>
                  <span>{item.label}{suffix}</span>
                  <div>{item.visible && <strong className={tone}>{item.label}{suffix}</strong>}</div>
                </li>
              ))}
            </ul>
          </main>
        );
      }
    `);

    expect(result.compiled).toEqual(["Inbox"]);
    expect(result.code).toContain("hostBlocks={true}");
    expect(result.code).toMatch(/dependencies: \[0, 1, 2\]/);
    expect(result.code).toContain("readProps: _props => [_props.suffix]");
    expect(result.code).toContain("_farmState[2].get()");
  });

  it.each([
    {
      name: "an event in a compiler-owned branch",
      branch: "<button onClick={() => setItems([])}>Done</button>",
    },
    {
      name: "a custom component branch",
      branch: "<Status value={item.label} />",
      declaration: "function Status({ value }) { return <strong>{value}</strong>; }",
    },
    {
      name: "a ref in a branch",
      branch: "<strong ref={() => undefined}>Done</strong>",
    },
    {
      name: "an SVG branch",
      branch: '<svg><circle cx="2" cy="2" r="2" /></svg>',
    },
    {
      name: "a fragment branch",
      branch: "<><strong>Done</strong><small>Now</small></>",
    },
    {
      name: "dangerous HTML in a branch",
      branch: "<strong dangerouslySetInnerHTML={{ __html: item.label }} />",
    },
    {
      name: "a controlled input in a branch",
      branch: "<input value={item.label} onChange={() => undefined} />",
    },
  ])("leaves $name on React's safe fallback", async ({ branch, declaration = "" }) => {
    const result = await compile(`
      import { useState } from "react";
      ${declaration}
      export function Inbox() {
        const [items, setItems] = useState([{ id: "a", label: "Alpha", done: true }]);
        return (
          <main>
            <ul>
              {items.map((item) => (
                <li key={item.id}><div>{item.done ? ${branch} : <small>Open</small>}</div></li>
              ))}
            </ul>
          </main>
        );
      }
    `);

    expect(result.compiled).toEqual(["Inbox"]);
    expect(result.code).not.toContain("hostBlocks={true}");
  });

  it("prepares nested keyed lists inside an outer keyed row", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function Inbox() {
        const [items, setItems] = useState([{ id: "a", visible: true, children: [{ id: "x", label: "X" }] }]);
        return (
          <main>
            <button onClick={() => setItems((rows) => [...rows])}>Refresh</button>
            <ul>
              {items.map((item) => (
                <li key={item.id}>
                  <div>{item.visible && <strong>Visible</strong>}</div>
                  <ol>{item.children.map((child) => <li key={child.id}>{child.label}</li>)}</ol>
                </li>
              ))}
            </ul>
          </main>
        );
      }
    `);

    expect(result.compiled).toEqual(["Inbox"]);
    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain("hostBlocks={true}");
    expect(result.code).toContain('kind: "keyed-ranges"');
    expect(result.code).toContain("parent: 0");
    expect(result.code).not.toContain("farmBlocks.KeyedList");
    expect(result.code).toContain("item.children.map");
    await expect(
      transformWithEsbuild(result.code, "/app/KeyedRowHostBlocks.tsx", {
        loader: "tsx",
        jsx: "automatic",
      }),
    ).resolves.toMatchObject({ code: expect.stringContaining("hostBlocks") });
  });

  it("supports multiple nested map and List ranges beside static siblings", async () => {
    const result = await compile(`
      import { useState } from "react";
      import { List } from "@farm.js/react/list";
      export function Projects() {
        const [projects, setProjects] = useState([{ id: "p", name: "Farm", ready: true, tasks: [{ id: "t", title: "Test" }], notes: [{ id: "n", text: "Ship" }] }]);
        return (
          <main>
            <button onClick={() => setProjects((rows) => [...rows])}>Refresh</button>
            <div>
              {projects.map((project) => (
                <section key={project.id}>
                  <h2>{project.name}</h2>
                  <div>{project.ready && <strong>Ready</strong>}</div>
                  <ul>
                    <i>Tasks</i>
                    {project.tasks.map((task, index) => <li key={task.id} data-index={index}>{task.title}</li>)}
                    <b>Notes</b>
                    <List each={project.notes} by={(note) => note.id}>
                      {(note) => <li title={note.text}>{note.text}</li>}
                    </List>
                    <em>End</em>
                  </ul>
                </section>
              ))}
            </div>
          </main>
        );
      }
    `);

    expect(result.compiled).toEqual(["Projects"]);
    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain("hostBlocks={true}");
    expect(result.code.match(/kind: "keyed-ranges"/g)).toHaveLength(1);
    expect(result.code.match(/before: /g)?.length).toBeGreaterThanOrEqual(2);
    expect(result.code).toContain('kind: "conditional-ranges"');
    expect(result.code).not.toContain("farmBlocks.KeyedList");
  });

  it("recursively prepares map and List keyed scopes at every safe host level", async () => {
    const result = await compile(`
      import { useState } from "react";
      import { List } from "@farm.js/react/list";
      export function Workspace() {
        const [boards, setBoards] = useState([{ id: "b", name: "Board", columns: [{ id: "c", name: "Column", cards: [{ id: "r", title: "Card", tags: [{ id: "t", label: "Ready" }] }] }] }]);
        return (
          <main>
            <button onClick={() => setBoards((rows) => [...rows])}>Refresh</button>
            <div>
              {boards.map((board, boardIndex) => (
                <section key={board.id} data-board-index={boardIndex}>
                  <h2>{board.name}</h2>
                  <div>
                    <i>Columns</i>
                    <List each={board.columns} by={(column) => column.id}>
                      {(column, columnIndex) => (
                        <article data-column-index={columnIndex}>
                          <h3>{column.name}</h3>
                          <ul>
                            {column.cards.map((card, cardIndex) => (
                              <li key={card.id} data-card-index={cardIndex}>
                                <span>{card.title}</span>
                                <ol>
                                  <List each={card.tags} by={(tag) => tag.id}>
                                    {(tag, tagIndex) => <li data-tag-index={tagIndex}>{tag.label}</li>}
                                  </List>
                                </ol>
                              </li>
                            ))}
                          </ul>
                        </article>
                      )}
                    </List>
                    <b>End</b>
                  </div>
                </section>
              ))}
            </div>
          </main>
        );
      }
    `);

    expect(result.compiled).toEqual(["Workspace"]);
    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain("hostBlocks={true}");
    expect(result.code.match(/kind: "keyed-ranges"/g)).toHaveLength(3);
    expect(result.code.match(/staticChildrenOnly: true/g)).toHaveLength(3);
    expect(result.code).toContain("parent: 0");
    expect(result.code).toContain("parent: 1");
    expect(result.code).toContain("parent: 2");
    expect(result.code).not.toContain("farmBlocks.KeyedList");
    expect(result.code).toContain("card.tags");
    await expect(
      transformWithEsbuild(result.code, "/app/KeyedRowHostBlocks.tsx", {
        loader: "tsx",
        jsx: "automatic",
      }),
    ).resolves.toMatchObject({ code: expect.stringContaining("hostBlocks") });
  });

  it("keeps descriptor output linear without a fixed keyed nesting limit", async () => {
    const depth = 10;
    let row = `<li key={node${depth - 1}.id}>{node${depth - 1}.label}</li>`;
    for (let level = depth - 2; level >= 0; level -= 1) {
      row = `
        <section key={node${level}.id}>
          <h2>{node${level}.label}</h2>
          <div>
            {node${level}.children.map((node${level + 1}) => (${row}))}
          </div>
        </section>
      `;
    }

    const result = await compile(`
      import { useState } from "react";
      export function DeepTree() {
        const [tree, setTree] = useState([]);
        return (
          <main>
            <button onClick={() => setTree((value) => [...value])}>Refresh</button>
            <div>{tree.map((node0) => (${row}))}</div>
          </main>
        );
      }
    `);

    expect(result.compiled).toEqual(["DeepTree"]);
    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain("hostBlocks={true}");
    expect(result.code.match(/kind: "keyed-ranges"/g)).toHaveLength(depth - 1);
    expect(result.code.match(/staticChildrenOnly: true/g)).toHaveLength(depth - 1);
    expect(result.code).toContain(`parent: ${depth - 2}`);
    await expect(
      transformWithEsbuild(result.code, "/app/DeepRecursiveKeyedTree.tsx", {
        loader: "tsx",
        jsx: "automatic",
      }),
    ).resolves.toMatchObject({ code: expect.stringContaining("hostBlocks") });
  });

  it.each([
    {
      name: "an event",
      row: "<li key={card.id}><button onClick={() => setBoards([])}>{card.title}</button></li>",
    },
    {
      name: "a custom component",
      row: "<CardRow key={card.id} card={card} />",
      declaration: "function CardRow({ card }) { return <li>{card.title}</li>; }",
    },
    {
      name: "a fragment",
      row: "<><li key={card.id}>{card.title}</li></>",
    },
    {
      name: "an index key",
      row: "<li key={cardIndex}>{card.title}</li>",
    },
  ])("keeps a deepest keyed row with $name on React", async ({ row, declaration = "" }) => {
    const result = await compile(`
      import { useState } from "react";
      ${declaration}
      export function Workspace() {
        const [boards, setBoards] = useState([{ id: "b", columns: [{ id: "c", cards: [{ id: "r", title: "Card" }] }] }]);
        return (
          <main>
            <button onClick={() => setBoards((rows) => [...rows])}>Refresh</button>
            <div>
              {boards.map((board) => (
                <section key={board.id}>
                  <div>
                    {board.columns.map((column) => (
                      <article key={column.id}>
                        <ul>{column.cards.map((card, cardIndex) => ${row})}</ul>
                      </article>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </main>
        );
      }
    `);

    expect(result.compiled).toEqual(["Workspace"]);
    expect(result.code).not.toContain("hostBlocks={true}");
    expect(result.code).toContain("column.cards.map");
  });

  it.each([
    {
      name: "an interactive inner row",
      row: "<li key={task.id}><button onClick={() => setItems([])}>{task.title}</button></li>",
    },
    {
      name: "a custom component inner row",
      row: "<TaskRow key={task.id} task={task} />",
      declaration: "function TaskRow({ task }) { return <li>{task.title}</li>; }",
    },
    {
      name: "an inner fragment row",
      row: "<><li key={task.id}>{task.title}</li></>",
    },
    {
      name: "an index-keyed inner row",
      row: "<li key={index}>{task.title}</li>",
    },
  ])("keeps $name on React's safe row fallback", async ({ row, declaration = "" }) => {
    const result = await compile(`
      import { useState } from "react";
      ${declaration}
      export function Projects() {
        const [items, setItems] = useState([{ id: "p", tasks: [{ id: "t", title: "Test" }] }]);
        return (
          <main>
            <button onClick={() => setItems((rows) => [...rows])}>Refresh</button>
            <div>
              {items.map((item) => (
                <section key={item.id}>
                  <ol>{item.tasks.map((task, index) => ${row})}</ol>
                </section>
              ))}
            </div>
          </main>
        );
      }
    `);

    expect(result.compiled).toEqual(["Projects"]);
    expect(result.code).not.toContain("hostBlocks={true}");
    expect(result.code).toContain("item.tasks.map");
  });

  it("keeps block ids unique across sibling lists and component-level blocks", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function Dashboard() {
        const [left, setLeft] = useState([{ id: "a", show: true }]);
        const [right, setRight] = useState([{ id: "b", open: false }]);
        const [ready, setReady] = useState(true);
        return (
          <main>
            <button onClick={() => setLeft((rows) => [...rows])}>Left</button>
            <button onClick={() => setRight((rows) => [...rows])}>Right</button>
            <button onClick={() => setReady((value) => !value)}>Ready</button>
            <div>{ready && <p>Ready</p>}</div>
            <ul>{left.map((item) => <li key={item.id}><span>{item.show && <b>Left</b>}</span></li>)}</ul>
            <ol>{right.map((item) => <li key={item.id}><span>{item.open ? <b>Open</b> : <i>Closed</i>}</span></li>)}</ol>
          </main>
        );
      }
    `);

    const ids = [
      ...result.code.matchAll(/kind: "block",\s+dependencies: \[[^\]]*\],\s+id: (\d+)/g),
    ].map((match) => Number(match[1]));
    expect(result.compiled).toEqual(["Dashboard"]);
    expect(result.code.match(/hostBlocks=\{true\}/g)).toHaveLength(2);
    expect(ids.length).toBeGreaterThanOrEqual(5);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
