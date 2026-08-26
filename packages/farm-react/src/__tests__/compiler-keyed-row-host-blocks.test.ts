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
    expect(result.code).toMatch(/dependencies: \[0, 1\]/);
    expect(result.code).toContain("_props.suffix");
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

  it("defers nested keyed lists inside a row while preserving normal React output", async () => {
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
    expect(result.code).not.toContain("hostBlocks={true}");
    expect(result.code).toContain("farmBlocks.KeyedList");
    expect(result.code).toContain("item.children.map");
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
