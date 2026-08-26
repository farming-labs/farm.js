// @vitest-environment node

import { describe, expect, it } from "vitest";
import { transformWithEsbuild } from "vite";
import { compileReactModule } from "../compiler";
import { normalizeReactCompilerOptions } from "../index";

const infer = normalizeReactCompilerOptions(true);

async function compile(source: string) {
  return compileReactModule(source, "/app/MixedRanges.tsx", infer);
}

describe("React AOT mixed conditional and keyed ranges", () => {
  it("prepares interleaved conditionals, maps, and static host siblings as one block", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function Dashboard() {
        const [loading, setLoading] = useState(false);
        const [items, setItems] = useState([{ id: "a", label: "Alpha" }]);
        const [error, setError] = useState(false);
        const [title, setTitle] = useState("Inventory");
        return (
          <main>
            <button onClick={() => setLoading((value) => !value)}>Loading</button>
            <section data-dashboard>
              <header className={loading ? "busy" : "ready"}>{title}</header>
              {loading && <p data-loading>Loading…</p>}
              <i data-count={items.length}>Rows: {items.length}</i>
              {items.map((item, index) => <article key={item.id} data-index={index}>{item.label}</article>)}
              {error ? <strong>Error</strong> : <span>Ready</span>}
              <footer style={{ opacity: error ? 0.5 : 1 }}>{title}: {items.length}</footer>
            </section>
          </main>
        );
      }
    `);

    expect(result.compiled).toEqual(["Dashboard"]);
    expect(result.diagnostics).toEqual([]);
    expect(result.code.match(/farmBlocks\.MixedRanges/g)).toHaveLength(1);
    expect(result.code).toContain('kind: "mixed-ranges"');
    expect(result.code.match(/kind: "conditional"/g)).toHaveLength(2);
    expect(result.code.match(/kind: "keyed"/g)).toHaveLength(1);
    expect(result.code).toContain("dependencies: [0, 1, 2, 3]");
    expect(result.code).toContain("segment: 0");
    expect(result.code).toContain("segment: 1");
    expect(result.code).toContain("segment: 3");
    expect(result.code).toContain('name: "className"');
    expect(result.code).toContain('name: "data-count"');
    expect(result.code).toContain('name: "opacity"');
    expect(result.code).not.toContain("farmBlocks.ConditionalRanges");
    expect(result.code).not.toContain("farmBlocks.KeyedRanges");
    await expect(
      transformWithEsbuild(result.code, "/app/MixedRanges.tsx", {
        loader: "tsx",
        jsx: "automatic",
      }),
    ).resolves.toMatchObject({ code: expect.stringContaining("MixedRanges") });
  });

  it("supports the public List primitive and recursive mixed descendants", async () => {
    const result = await compile(`
      import { useState } from "react";
      import { List } from "@farm.js/react/list";
      export function Workspace() {
        const [open, setOpen] = useState(true);
        const [boards, setBoards] = useState([{ id: "b", title: "Board", ready: true, cards: [{ id: "c", title: "Card" }] }]);
        return (
          <main>
            <button onClick={() => setOpen((value) => !value)}>Open</button>
            <div>
              {open && <h1>Workspace</h1>}
              <List each={boards} by={(board) => board.id}>
                {(board) => (
                  <section>
                    {board.ready && <strong>Ready</strong>}
                    <i>Cards</i>
                    {board.cards.map((card) => <article key={card.id}>{card.title}</article>)}
                  </section>
                )}
              </List>
            </div>
          </main>
        );
      }
    `);

    expect(result.compiled).toEqual(["Workspace"]);
    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain("farmBlocks.MixedRanges");
    expect(result.code.match(/kind: "mixed-ranges"/g)?.length).toBeGreaterThanOrEqual(2);
    expect(result.code).toContain("parent: 0");
    expect(result.code).not.toContain("farmBlocks.KeyedList");
  });

  it.each([
    {
      name: "an interactive conditional branch",
      conditional: "<button onClick={() => setOpen(false)}>Close</button>",
      row: "<article key={item.id}>{item.label}</article>",
    },
    {
      name: "an interactive keyed row",
      conditional: "<strong>Open</strong>",
      row: "<button key={item.id} onClick={() => setItems([])}>{item.label}</button>",
    },
    {
      name: "a custom component branch",
      declaration: "function Status() { return <strong>Open</strong>; }",
      conditional: "<Status />",
      row: "<article key={item.id}>{item.label}</article>",
    },
  ])("keeps $name on React's existing fallback", async ({ declaration = "", conditional, row }) => {
    const result = await compile(`
      import { useState } from "react";
      ${declaration}
      export function Fallback() {
        const [open, setOpen] = useState(true);
        const [items, setItems] = useState([{ id: "a", label: "Alpha" }]);
        return (
          <main>
            <section>
              {open && ${conditional}}
              {items.map((item) => ${row})}
            </section>
          </main>
        );
      }
    `);

    expect(result.code).not.toContain("farmBlocks.MixedRanges");
  });
});
