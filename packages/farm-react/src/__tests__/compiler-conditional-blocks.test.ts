// @vitest-environment node

import { describe, expect, it } from "vitest";
import { transformWithEsbuild } from "vite";
import { compileReactModule } from "../compiler";
import { normalizeReactCompilerOptions } from "../index";

const infer = normalizeReactCompilerOptions(true);

async function compile(source: string) {
  return compileReactModule(source, "/app/Conditional.tsx", infer);
}

describe("React AOT conditional block compiler", () => {
  it("lowers logical and ternary host branches into independent block bindings", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function ConditionalPanel() {
        const [loading, setLoading] = useState(false);
        const [enabled, setEnabled] = useState(true);
        return (
          <main>
            <button onClick={() => setLoading((value) => !value)}>Loading</button>
            {loading && <p data-state="loading">Loading…</p>}
            <button onClick={() => setEnabled((value) => !value)}>Enabled</button>
            {enabled ? <strong>Enabled</strong> : <span>Disabled</span>}
          </main>
        );
      }
    `);

    expect(result.diagnostics).toEqual([]);
    expect(result.compiled).toEqual(["ConditionalPanel"]);
    expect(result.code.match(/farmBlocks\.Conditional/g)).toHaveLength(2);
    expect(result.code).toContain('kind: "block"');
    expect(result.code).toContain("id: 0");
    expect(result.code).toContain("id: 1");
    expect(result.code).toContain("dependencies: [0]");
    expect(result.code).toContain("dependencies: [1]");
    await expect(
      transformWithEsbuild(result.code, "/app/Conditional.tsx", {
        loader: "tsx",
        jsx: "automatic",
      }),
    ).resolves.toMatchObject({
      code: expect.stringContaining("farmBlocks.Conditional"),
    });
  });

  it("keeps branch attributes, text, styles, and handlers under React ownership", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function InteractiveBranch() {
        const [open, setOpen] = useState(false);
        const [count, setCount] = useState(0);
        return (
          <section>
            <button onClick={() => setOpen(true)}>Open</button>
            {open ? (
              <article
                className={count > 0 ? "active" : "idle"}
                style={{ opacity: count > 0 ? 1 : 0.5 }}
                onClick={() => setCount((value) => value + 1)}
              >
                Count: {count}
              </article>
            ) : null}
          </section>
        );
      }
    `);

    expect(result.diagnostics).toEqual([]);
    expect(result.compiled).toEqual(["InteractiveBranch"]);
    expect(result.code).toContain('kind: "block"');
    expect(result.code).toContain("dependencies: [0, 1]");
    expect(result.code).toMatch(/farmState\[1\]\.set/);
    expect(result.code).toMatch(/farmState\[1\]\.get/);
  });

  it("supports null and false empty branches", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function EmptyBranches() {
        const [visible, setVisible] = useState(false);
        return (
          <div onClick={() => setVisible(!visible)}>
            {visible ? <p>Visible</p> : null}
            {visible ? false : <aside>Hidden</aside>}
          </div>
        );
      }
    `);

    expect(result.diagnostics).toEqual([]);
    expect(result.compiled).toEqual(["EmptyBranches"]);
    expect(result.code.match(/farmBlocks\.Conditional/g)).toHaveLength(2);
  });

  it.each([
    {
      name: "a custom component branch",
      body: "{visible && <Details />} ",
      extra: "function Details() { return <p>Details</p>; }",
      reason: /host elements only/i,
    },
    {
      name: "a fragment branch",
      body: "{visible && <><p>One</p><p>Two</p></>}",
      extra: "",
      reason: /dynamic child structures/i,
    },
    {
      name: "a hook call inside a branch",
      body: "{visible && <p>{useValue()}</p>}",
      extra: "function useValue() { return 'value'; }",
      reason: /static host tree/i,
    },
    {
      name: "a ref inside a branch",
      body: "{visible && <p ref={() => undefined}>Details</p>}",
      extra: "",
      reason: /ref requires React ownership/i,
    },
    {
      name: "an attribute spread inside a branch",
      body: "{visible && <p {...props}>Details</p>}",
      extra: "const props = {};",
      reason: /attribute spreads/i,
    },
    {
      name: "dangerous HTML inside a branch",
      body: "{visible && <p dangerouslySetInnerHTML={{ __html: 'Details' }} />}",
      extra: "",
      reason: /dangerouslySetInnerHTML requires React ownership/i,
    },
    {
      name: "an effectful condition",
      body: "{isVisible(visible) && <p>Details</p>}",
      extra: "const isVisible = (value: boolean) => value;",
      reason: /test cannot use function calls/i,
    },
  ])("falls back to React for $name", async ({ body, extra, reason }) => {
    const result = await compile(`
      import { useState } from "react";
      ${extra}
      export function Unsupported() {
        const [visible, setVisible] = useState(false);
        const [enabled, setEnabled] = useState(false);
        return <section onClick={() => setVisible(!visible)}>${body}</section>;
      }
    `);

    expect(result.compiled).toEqual([]);
    expect(
      result.diagnostics.find((diagnostic) => diagnostic.component === "Unsupported")?.reason,
    ).toMatch(reason);
    expect(result.code).not.toContain("compiler-runtime");
  });

  it("composes nested host conditionals and keyed lists inside a branch", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function NestedBlocks() {
        const [visible, setVisible] = useState(true);
        const [enabled, setEnabled] = useState(false);
        const [items, setItems] = useState([{ id: "a", label: "Alpha" }]);
        return (
          <section>
            <button onClick={() => setVisible(!visible)}>Visible</button>
            {visible && (
              <article>
                <h2>Inventory</h2>
                {enabled ? <strong>Enabled</strong> : <span>Disabled</span>}
                <ul>{items.map((item) => <li key={item.id}>{item.label}</li>)}</ul>
              </article>
            )}
          </section>
        );
      }
    `);

    expect(result.compiled).toEqual(["NestedBlocks"]);
    expect(result.diagnostics).toEqual([]);
    expect(result.code.match(/farmBlocks\.Conditional/g)).toHaveLength(2);
    expect(result.code.match(/farmBlocks\.KeyedRows/g)).toHaveLength(1);
    expect(result.code).toContain("id={0}");
    expect(result.code).toContain("id={1}");
    expect(result.code).toContain("id={2}");
    expect(result.code.match(/parent: 0/g)).toHaveLength(2);
  });
});
