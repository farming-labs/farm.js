// @vitest-environment node

import { describe, expect, it } from "vitest";
import { transformWithEsbuild } from "vite";
import { compileReactModule } from "../compiler";
import { normalizeReactCompilerOptions } from "../index";

const infer = normalizeReactCompilerOptions(true);

async function compile(source: string) {
  return compileReactModule(source, "/app/KeyedUpdateHints.tsx", infer);
}

describe("React AOT keyed update hints", () => {
  it("records a final same-order delta after a proven native map executes", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function Inventory() {
        const [items, setItems] = useState([
          { id: "a", label: "Alpha", selected: false },
          { id: "b", label: "Beta", selected: false },
        ]);
        return (
          <section>
            <button
              onClick={() => setItems((current) =>
                current.map((row, index) =>
                  index === 1 ? { ...row, label: row.label + "!", selected: true } : row,
                )
              )}
            >
              Update
            </button>
            <ul>{items.map((item) => <li key={item.id}>{item.label}</li>)}</ul>
          </section>
        );
      }
    `);

    expect(result.compiled).toEqual(["Inventory"]);
    expect(result.diagnostics).toEqual([]);
    expect(result.optimizations).toEqual({
      keyedArrayAppendHints: 0,
      keyedArrayFilterHints: 0,
      keyedArrayPrependHints: 0,
      keyedArrayPositionHints: 0,
      keyedArrayReorderHints: 0,
      keyedArraySortHints: 0,
      keyedArrayMappedRollingWindowChainHints: 0,
      keyedArrayRollingWindowHints: 0,
      keyedArraySliceHints: 0,
      keyedCollectionUpdateHints: 0,
      keyedIdentityTargets: 0,
      keyedMapLookupTargets: 0,
      keyedMembershipTargets: 0,
      keyedMapUpdateHints: 1,
    });
    expect(result.code).toContain("createCompilerKeyedMapUpdate");
    expect(result.code).toContain("keyedRowsHintedRuntimeFeature");
    expect(result.code).toContain("collectionDependency={0}");
    expect(result.code).toContain("dependencies={[0]}");
    expect(result.code).toMatch(/const _farmMap\d* = _farmMapValue\d*\.map/);
    expect(result.code.match(/createCompilerKeyedMapUpdate\(/g)).toHaveLength(1);
    await expect(
      transformWithEsbuild(result.code, "/app/KeyedUpdateHints.tsx", {
        loader: "tsx",
        jsx: "automatic",
      }),
    ).resolves.toMatchObject({
      code: expect.stringContaining("createCompilerKeyedMapUpdate"),
    });
  });

  it("composes consecutive safe same-key maps into one final keyed update", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function Inventory({ editedId, nextLabel }) {
        const [items, setItems] = useState([
          { id: "a", label: "Alpha", selected: false },
          { id: "b", label: "Beta", selected: false },
        ]);
        return (
          <section>
            <button onClick={() => setItems((current) => current
              .map((row) => row.id === editedId ? { ...row, label: nextLabel } : row)
              .map((row) => row.id === editedId ? { ...row, selected: true } : row)
            )}>Update</button>
            <ul>{items.map((item) => <li key={item.id}>{item.label}</li>)}</ul>
          </section>
        );
      }
    `);

    expect(result.compiled).toEqual(["Inventory"]);
    expect(result.diagnostics).toEqual([]);
    expect(result.optimizations.keyedMapUpdateHints).toBe(2);
    expect(result.code.match(/createCompilerKeyedMapUpdate\(/g)).toHaveLength(1);
    expect(result.code.match(/_farmApplyMap\d*\(/g)).toHaveLength(2);
    expect(result.code).toContain("keyedRowsHintedRuntimeFeature");
    expect(result.code).not.toContain("createCompilerKeyedArrayMapPipeline");
    await expect(
      transformWithEsbuild(result.code, "/app/KeyedUpdateHints.tsx", {
        loader: "tsx",
        jsx: "automatic",
      }),
    ).resolves.toMatchObject({
      code: expect.stringContaining("createCompilerKeyedMapUpdate"),
    });
  });

  it("supports direct-state public List rows without adding a public option", async () => {
    const result = await compile(`
      import { useState } from "react";
      import { List } from "@farm.js/react/list";
      export function Inventory() {
        const [items, setItems] = useState([{ id: "a", label: "Alpha" }]);
        return (
          <section>
            <button onClick={() => setItems((current) => current.map((row) => row.id === "a" ? { ...row, label: "Updated" } : row))}>Update</button>
            <ul>
              <List each={items} by={(item) => item.id}>
                {(item) => <li>{item.label}</li>}
              </List>
            </ul>
          </section>
        );
      }
    `);

    expect(result.compiled).toEqual(["Inventory"]);
    expect(result.optimizations.keyedMapUpdateHints).toBe(1);
    expect(result.code).toContain("collectionDependency={0}");
  });

  it.each([
    {
      name: "a derived collection",
      declaration: "const visible = items.filter((item) => item.visible);",
      collection: "visible",
      update:
        'setItems((current) => current.map((row) => row.id === "a" ? { ...row, label: "Updated" } : row))',
    },
    {
      name: "a block-bodied mapper",
      declaration: "",
      collection: "items",
      update:
        'setItems((current) => current.map((row) => { return row.id === "a" ? { ...row, label: "Updated" } : row; }))',
    },
    {
      name: "an unsupported second mapper",
      declaration: "",
      collection: "items",
      update:
        'setItems((current) => current.map((row) => row.id === "a" ? { ...row, label: "First" } : row).map((row) => ({ ...row, label: "Updated" })))',
    },
    {
      name: "a potentially mutating mapper",
      declaration: "",
      collection: "items",
      update:
        'setItems((current) => current.map((row) => row.id === "a" ? Object.assign(row, { label: "Updated" }) : row))',
    },
    {
      name: "a captured non-functional update",
      declaration: "",
      collection: "items",
      update: 'setItems(items.map((row) => ({ ...row, label: "Updated" })))',
    },
  ])(
    "keeps $name on the existing complete reconciliation path",
    async ({ declaration, collection, update }) => {
      const result = await compile(`
      import { useState } from "react";
      export function Inventory() {
        const [items, setItems] = useState([{ id: "a", label: "Alpha", visible: true }]);
        ${declaration}
        return (
          <section>
            <button onClick={() => ${update}}>Update</button>
            <ul>{${collection}.map((item) => <li key={item.id}>{item.label}</li>)}</ul>
          </section>
        );
      }
    `);

      expect(result.compiled).toEqual(["Inventory"]);
      expect(result.optimizations.keyedMapUpdateHints).toBe(0);
      expect(result.code).not.toContain("createCompilerKeyedMapUpdate");
      expect(result.code).not.toContain("keyedRowsHintedRuntimeFeature");
    },
  );
});
