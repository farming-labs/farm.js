import { describe, expect, it } from "vitest";
import { compileReactModule } from "../compiler";
import { normalizeReactCompilerOptions } from "../index";

const infer = normalizeReactCompilerOptions(true, "/app");

async function compile(source: string) {
  return compileReactModule(source, "/app/QueuedReorderMapHints.tsx", infer);
}

describe("React AOT queued keyed-array reorder and map hints", () => {
  it("retains a reverse through an adjacent standalone map pipeline", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function Table({ editedId, nextLabel, nextRank }) {
        const [rows, setRows] = useState([
          { id: "a", label: "Alpha", rank: 1 },
          { id: "b", label: "Beta", rank: 2 },
        ]);
        return <section>
          <button onClick={() => {
            setRows((current) => current.toReversed());
            setRows((current) => current
              .map((row) => row.id === editedId ? { ...row, label: nextLabel } : row)
              .map((row) => row.id === editedId ? { ...row, rank: nextRank } : row)
            );
          }}>Reverse and edit</button>
          <ul>{rows.map((row) => <li key={row.id}>{row.label}: {row.rank}</li>)}</ul>
        </section>;
      }
    `);

    expect(result.compiled).toEqual(["Table"]);
    expect(result.diagnostics).toEqual([]);
    expect(result.optimizations.keyedArrayReorderHints).toBe(1);
    expect(result.optimizations.keyedMapUpdateHints).toBe(2);
    expect(result.code.match(/createCompilerKeyedArrayReorder\(/g)).toHaveLength(1);
    expect(result.code.match(/createCompilerKeyedArrayQueuedMapPipeline\(/g)).toHaveLength(1);
    expect(result.code.match(/_farmApplyMap\d*\(/g)).toHaveLength(2);
    expect(result.code).not.toContain("createCompilerKeyedMapUpdate");
    expect(result.code).not.toContain("createCompilerKeyedArrayMapPipeline");
    expect(result.code).toContain("keyedRowsMapReorderHintedRuntimeFeature");
  });

  it("retains a sort through multiple adjacent standalone map setters", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function Table({ editedId, nextLabel, nextRank }) {
        const [rows, setRows] = useState([
          { id: "a", label: "Alpha", rank: 1 },
          { id: "b", label: "Beta", rank: 2 },
        ]);
        return <section>
          <button onClick={() => {
            setRows((current) => current.toSorted((left, right) => left.rank - right.rank));
            setRows((current) => current.map((row) =>
              row.id === editedId ? { ...row, label: nextLabel } : row
            ));
            setRows((current) => current.map((row) =>
              row.id === editedId ? { ...row, rank: nextRank } : row
            ));
          }}>Sort and edit twice</button>
          <ul>{rows.map((row) => <li key={row.id}>{row.label}: {row.rank}</li>)}</ul>
        </section>;
      }
    `);

    expect(result.optimizations.keyedArraySortHints).toBe(1);
    expect(result.optimizations.keyedMapUpdateHints).toBe(2);
    expect(result.code.match(/createCompilerKeyedArraySort\(/g)).toHaveLength(1);
    expect(result.code.match(/createCompilerKeyedArrayQueuedMapPipeline\(/g)).toHaveLength(2);
    expect(result.code).not.toContain("createCompilerKeyedMapUpdate");
    expect(result.code).not.toContain("createCompilerKeyedArrayMapPipeline");
    expect(result.code).toContain("keyedRowsMapReorderHintedRuntimeFeature");
  });

  it.each([
    {
      name: "an intervening statement",
      middle: "trackUpdate();",
      secondSetter: "setRows",
      extraState: "",
      extraDeclaration: "const trackUpdate = () => undefined;",
      extraRows: "",
    },
    {
      name: "a different state setter",
      middle: "",
      secondSetter: "setOtherRows",
      extraState: 'const [otherRows, setOtherRows] = useState([{ id: "c", label: "Gamma" }]);',
      extraDeclaration: "",
      extraRows: "<ol>{otherRows.map((row) => <li key={row.id}>{row.label}</li>)}</ol>",
    },
  ])(
    "keeps a standalone map after $name on its ordinary same-order hint",
    async ({ middle, secondSetter, extraState, extraDeclaration, extraRows }) => {
      const result = await compile(`
        import { useState } from "react";
        export function Table({ editedId, nextLabel }) {
          const [rows, setRows] = useState([
            { id: "a", label: "Alpha" },
            { id: "b", label: "Beta" },
          ]);
          ${extraState}
          ${extraDeclaration}
          return <section>
            <button onClick={() => {
              setRows((current) => current.toReversed());
              ${middle}
              ${secondSetter}((current) => current.map((item) =>
                item.id === editedId ? { ...item, label: nextLabel } : item
              ));
            }}>Update</button>
            <ul>{rows.map((row) => <li key={row.id}>{row.label}</li>)}</ul>
            ${extraRows}
          </section>;
        }
      `);

      expect(result.code).toContain("createCompilerKeyedMapUpdate");
      expect(result.code).not.toContain("keyedRowsMapReorderHintedRuntimeFeature");
    },
  );

  it("keeps structural reorder and host-backed rows off the queued map path", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function Table({ editedId, nextLabel }) {
        const [rows, setRows] = useState([
          { id: "a", label: "Alpha", visible: true },
          { id: "b", label: "Beta", visible: false },
        ]);
        return <section>
          <button onClick={() => {
            setRows((current) => current.filter((row) => row.visible).toReversed());
            setRows((current) => current.map((row) =>
              row.id === editedId ? { ...row, label: nextLabel } : row
            ));
          }}>Filter, reverse, and edit</button>
          <ul>{rows.map((row) => <li key={row.id}>
            <span>{row.label}</span>
            <div>{row.visible && <strong>Visible</strong>}</div>
          </li>)}</ul>
        </section>;
      }
    `);

    expect(result.code).toContain("keyedRowsHostEveryHintedRuntimeFeature");
    expect(result.code).not.toContain("createCompilerKeyedArrayQueuedMapPipeline");
    expect(result.code).not.toContain("keyedRowsMapReorderHintedRuntimeFeature");
  });
});
