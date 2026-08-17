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
    expect(result.code).toContain("farmBlocks.KeyedList");
    expect(result.code).toContain('kind: "block"');
    expect(result.code).toContain("dependencies: [0]");
    await expect(
      transformWithEsbuild(result.code, "/app/KeyedLists.tsx", {
        loader: "tsx",
        jsx: "automatic",
      }),
    ).resolves.toMatchObject({
      code: expect.stringContaining("farmBlocks.KeyedList"),
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
      name: "a collection call chain",
      list: "items.filter((item) => item.visible).map((item) => <li key={item.id}>{item.label}</li>)",
      reason: /collection cannot use function calls/i,
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

  it("falls back when the list shares a container with another child", async () => {
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

    expect(result.compiled).toEqual([]);
    expect(result.diagnostics[0]?.reason).toMatch(/only child of its host container/i);
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

  it("does not treat a locally named List as the public primitive", async () => {
    const result = await compile(`
      import { useState } from "react";
      function List() { return <li>Local</li>; }
      export function LocalList() {
        const [active, setActive] = useState(false);
        return <ul onClick={() => setActive(!active)}><List /></ul>;
      }
    `);

    expect(result.compiled).toEqual([]);
    expect(result.diagnostics.find((entry) => entry.component === "LocalList")?.reason).toMatch(
      /host elements only/i,
    );
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
    expect(result.code).toContain("farmBlocks.Conditional");
    expect(result.code).toContain("farmBlocks.KeyedList");
    expect(result.code).toContain("id={0}");
    expect(result.code).toContain("id={1}");
  });
});
