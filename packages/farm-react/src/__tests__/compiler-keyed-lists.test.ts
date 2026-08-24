// @vitest-environment node

import { describe, expect, it } from "vitest";
import { transformWithEsbuild } from "vite";
import { compileReactModule } from "../compiler";
import { normalizeReactCompilerOptions } from "../index";

const infer = normalizeReactCompilerOptions(true);

async function compile(source: string) {
  return compileReactModule(source, "/app/KeyedLists.tsx", infer);
}

describe("React AOT keyed list compiler", () => {
  it("automatically isolates a direct keyed map", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function Inventory() {
        const [items, setItems] = useState([{ id: "a", label: "Alpha" }]);
        return (
          <section>
            <button onClick={() => setItems((current) => [...current, { id: "b", label: "Beta" }])}>
              Add
            </button>
            <ul>
              {items.map((item) => <li key={item.id}>{item.label}</li>)}
            </ul>
          </section>
        );
      }
    `);

    expect(result.compiled).toEqual(["Inventory"]);
    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain("farmBlocks.KeyedRows");
    expect(result.code).toContain("rowKey={item => item.id}");
    expect(result.code).toContain('kind: "element"');
    expect(result.code).toContain('kind: "block"');
    expect(result.code).toContain("dependencies: [0]");
    await expect(
      transformWithEsbuild(result.code, "/app/KeyedLists.tsx", {
        loader: "tsx",
        jsx: "automatic",
      }),
    ).resolves.toMatchObject({
      code: expect.stringContaining("farmBlocks.KeyedRows"),
    });
  });

  it("isolates an aliased public List with a custom row component", async () => {
    const result = await compile(`
      import { useState } from "react";
      import { List as Keyed } from "@farm.js/react/list";
      import { InventoryRow } from "./inventory-row";

      export function Inventory() {
        const [items, setItems] = useState([{ id: "a", label: "Alpha" }]);
        return (
          <section>
            <button onClick={() => setItems((current) => [...current].reverse())}>Reverse</button>
            <ul>
              <Keyed each={items} by={(item) => item.id}>
                {(item) => <InventoryRow item={item} />}
              </Keyed>
            </ul>
          </section>
        );
      }
    `);

    expect(result.compiled).toEqual(["Inventory"]);
    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain("farmBlocks.KeyedList");
    expect(result.code).toContain("<Keyed each=");
    expect(result.code).toContain("dependencies: [0]");
  });

  it.each([
    {
      name: "a missing key",
      list: "items.map((item) => <li>{item.label}</li>)",
      reason: /explicit item key/i,
    },
    {
      name: "an index key",
      list: "items.map((item, index) => <li key={index}>{item.label}</li>)",
      reason: /cannot depend on the array index/i,
    },
    {
      name: "a constant key",
      list: 'items.map((item) => <li key="row">{item.label}</li>)',
      reason: /must depend on the mapped item/i,
    },
    {
      name: "an unproven collection callback call",
      list: 'items.filter((item) => item.label.includes("a")).map((item) => <li key={item.id}>{item.label}</li>)',
      reason: /filter callbacks cannot use function calls/i,
    },
  ])("falls back for $name", async ({ list, reason }) => {
    const result = await compile(`
      import { useState } from "react";
      export function UnsupportedList() {
        const [items, setItems] = useState([{ id: "a", label: "Alpha", visible: true }]);
        return <ul onClick={() => setItems([...items])}>{${list}}</ul>;
      }
    `);

    expect(result.compiled).toEqual([]);
    expect(result.diagnostics[0]?.reason).toMatch(reason);
  });

  it("compiles a component-root keyed range alongside static siblings", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function MixedList() {
        const [items, setItems] = useState([{ id: "a", label: "Alpha" }]);
        return (
          <ul onClick={() => setItems([...items])}>
            <li>Static row</li>
            {items.map((item) => <li key={item.id}>{item.label}</li>)}
          </ul>
        );
      }
    `);

    expect(result.compiled).toEqual(["MixedList"]);
    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain("<li>Static row</li>");
    expect(result.code).toContain("farmBlocks.KeyedRanges");
    expect(result.code).not.toContain("farmBlocks.KeyedList");
    expect(result.code).toContain("id={0}");
  });

  it("compiles host-only public List rows while preserving the ordinary List fallback", async () => {
    const result = await compile(`
      import { useState } from "react";
      import { List } from "@farm.js/react/list";
      export function ExplicitRows() {
        const [items, setItems] = useState([{ id: "a", label: "Alpha", active: false }]);
        return (
          <section>
            <button onClick={() => setItems([...items].reverse())}>Reverse</button>
            <ul>
              <List each={items} by={(item) => item.id}>
                {(item) => (
                  <li className={item.active ? "active" : "idle"}>
                    <span>{item.label}</span>
                  </li>
                )}
              </List>
            </ul>
          </section>
        );
      }
    `);

    expect(result.compiled).toEqual(["ExplicitRows"]);
    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain("farmBlocks.KeyedRows");
    expect(result.code).toContain("rowKey={item => item.id}");
    expect(result.code).toContain('name: "className"');
    expect(result.code).toContain("path: [0]");
  });

  it.each([
    {
      name: "custom row components",
      row: "<InventoryRow key={item.id} item={item} />",
    },
    {
      name: "row fragments",
      row: "<li key={item.id}><>{item.label}</></li>",
    },
  ])("keeps $name in the React-owned list boundary", async ({ row }) => {
    const result = await compile(`
      import { useState } from "react";
      import { InventoryRow } from "./inventory-row";
      export function ReactOwnedRows() {
        const [items, setItems] = useState([{ id: "a", label: "Alpha" }]);
        return (
          <section>
            <ul>{items.map((item) => ${row})}</ul>
          </section>
        );
      }
    `);

    expect(result.compiled).toEqual(["ReactOwnedRows"]);
    expect(result.code).toContain("farmBlocks.KeyedList");
    expect(result.code).not.toContain("farmBlocks.KeyedRows");
  });

  it("falls back for an index-based explicit List key", async () => {
    const result = await compile(`
      import { useState } from "react";
      import { List } from "@farm.js/react/list";
      export function IndexedList() {
        const [items, setItems] = useState(["Alpha"]);
        return (
          <ul onClick={() => setItems([...items])}>
            <List each={items} by={(_item, index) => index}>
              {(item) => <li>{item}</li>}
            </List>
          </ul>
        );
      }
    `);

    expect(result.compiled).toEqual([]);
    expect(result.diagnostics[0]?.reason).toMatch(/cannot depend on the array index/i);
  });

  it("treats a locally named List as an ordinary static component island", async () => {
    const result = await compile(`
      import { useState } from "react";
      function List() { return <li>Local</li>; }
      export function LocalList() {
        const [active, setActive] = useState(false);
        return <ul onClick={() => setActive(!active)}><List /></ul>;
      }
    `);

    expect(result.compiled).toContain("LocalList");
    expect(result.code).toContain("<List />");
    expect(result.code).not.toContain("farmBlocks.KeyedList");
  });

  it("assigns unique boundary ids when conditions and lists coexist", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function MixedBoundaries() {
        const [visible, setVisible] = useState(true);
        const [items, setItems] = useState([{ id: "a", label: "Alpha" }]);
        return (
          <section>
            <button onClick={() => setVisible(!visible)}>Toggle</button>
            <button onClick={() => setItems([...items].reverse())}>Reverse</button>
            <div>{visible && <p>Visible</p>}</div>
            <ul>{items.map((item) => <li key={item.id}>{item.label}</li>)}</ul>
          </section>
        );
      }
    `);

    expect(result.compiled).toEqual(["MixedBoundaries"]);
    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain("farmBlocks.HostConditional");
    expect(result.code).toContain("farmBlocks.KeyedRows");
    expect(result.code).toContain("id={0}");
    expect(result.code).toContain("id={1}");
  });
});
