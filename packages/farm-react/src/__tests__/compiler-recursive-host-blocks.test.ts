// @vitest-environment node

import { describe, expect, it } from "vitest";
import { transformWithEsbuild } from "vite";
import { compileReactModule } from "../compiler";
import { normalizeReactCompilerOptions } from "../index";

const infer = normalizeReactCompilerOptions(true);

async function compile(source: string) {
  return compileReactModule(source, "/app/RecursiveHostBlocks.tsx", infer);
}

describe("React AOT recursive host-block compiler", () => {
  it("composes recursive descriptors from a component-root conditional range", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function RootComposition() {
        const [open, setOpen] = useState(true);
        const [ready, setReady] = useState(false);
        return (
          <main>
            <header>Static</header>
            {open ? (
              <section><div>{ready && <strong>Ready</strong>}</div></section>
            ) : <aside>Closed</aside>}
            <footer>Stable</footer>
          </main>
        );
      }
    `);

    expect(result.diagnostics).toEqual([]);
    expect(result.code.match(/farmBlocks\.ConditionalRanges/g)).toHaveLength(1);
    expect(result.code).toContain('kind: "conditional-ranges"');
    expect(result.code).toContain("parent: 0");
    expect(result.code).toContain("dependencies: [0]");
    expect(result.code).toContain("dependencies: [1]");
  });

  it("embeds independent conditional and keyed descriptors in one compiler-owned branch", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function Inbox() {
        const [open, setOpen] = useState(true);
        const [loading, setLoading] = useState(false);
        const [messages, setMessages] = useState([{ id: "a", title: "Alpha" }]);
        return (
          <main>
            <button onClick={() => setOpen((value) => !value)}>Open</button>
            <div className="slot">
              {open ? (
                <section>
                  <header>Inbox</header>
                  <div>{loading && <p>Loading…</p>}</div>
                  <ul>
                    {messages.map((message) => <li key={message.id}>{message.title}</li>)}
                  </ul>
                </section>
              ) : <aside>Closed</aside>}
            </div>
          </main>
        );
      }
    `);

    expect(result.diagnostics).toEqual([]);
    expect(result.compiled).toEqual(["Inbox"]);
    expect(result.code.match(/farmBlocks\.HostConditional/g)).toHaveLength(1);
    expect(result.code).toContain('kind: "conditional-ranges"');
    expect(result.code).toContain('kind: "keyed-ranges"');
    expect(result.code).toContain("parent: 0");
    expect(result.code).toContain("dependencies: [0]");
    expect(result.code).toContain("dependencies: [1]");
    expect(result.code).toContain("dependencies: [2]");
    await expect(
      transformWithEsbuild(result.code, "/app/RecursiveHostBlocks.tsx", {
        loader: "tsx",
        jsx: "automatic",
      }),
    ).resolves.toMatchObject({
      code: expect.stringContaining('kind: "keyed-ranges"'),
    });
  });

  it("assigns recursive conditional descendants to their replacing parent block", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function RecursiveStatus() {
        const [open, setOpen] = useState(true);
        const [ready, setReady] = useState(true);
        const [detailed, setDetailed] = useState(false);
        return (
          <main>
            <div>
              {open ? (
                <section>
                  <div>
                    {ready ? (
                      <article>
                        <div>{detailed && <strong>Details</strong>}</div>
                      </article>
                    ) : <i>Waiting</i>}
                  </div>
                </section>
              ) : <aside>Closed</aside>}
            </div>
          </main>
        );
      }
    `);

    expect(result.diagnostics).toEqual([]);
    expect(result.code.match(/kind: "conditional-ranges"/g)?.length).toBeGreaterThanOrEqual(2);
    expect(result.code).toContain("id: 0");
    expect(result.code).toContain("id: 1");
    expect(result.code).toContain("id: 2");
    expect(result.code).toContain("parent: 0");
    expect(result.code).toContain("parent: 1");
  });

  it("supports the public List primitive inside a recursive host branch", async () => {
    const result = await compile(`
      import { useState } from "react";
      import { List } from "@farm.js/react/list";
      export function Tasks() {
        const [open, setOpen] = useState(true);
        const [tasks, setTasks] = useState([{ id: 1, label: "Ship" }]);
        return (
          <main>
            <div>
              {open ? (
                <section>
                  <ol>
                    <List each={tasks} by={(task) => task.id}>
                      {(task) => <li>{task.label}</li>}
                    </List>
                  </ol>
                </section>
              ) : <aside>Closed</aside>}
            </div>
          </main>
        );
      }
    `);

    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain('kind: "keyed-ranges"');
    expect(result.code).toContain("staticChildrenOnly: true");
    expect(result.code).not.toContain("Array.from");
  });

  it("retains React ownership for lifecycle-sensitive nested structures", async () => {
    const result = await compile(`
      import { useState } from "react";
      function Child() { return <strong>Child</strong>; }
      export function SafeFallback() {
        const [open, setOpen] = useState(true);
        const [ready, setReady] = useState(false);
        return (
          <main>
            <div>
              {open ? (
                <section>
                  <div>{ready && <button onClick={() => setReady(false)}>Ready</button>}</div>
                  <Child />
                </section>
              ) : <aside>Closed</aside>}
            </div>
            <button onClick={() => setOpen(false)}>Close</button>
          </main>
        );
      }
    `);

    expect(result.diagnostics).toEqual([
      expect.objectContaining({ component: "Child", selected: false }),
    ]);
    expect(result.code).not.toContain("farmBlocks.HostConditional");
    expect(result.code).toContain("farmBlocks.Conditional");
    expect(result.code).not.toContain('kind: "conditional-ranges"');
  });
});
