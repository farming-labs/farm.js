// @vitest-environment node

import { describe, expect, it } from "vitest";
import { compileReactModule } from "../compiler";
import { normalizeReactCompilerOptions } from "../index";

const infer = normalizeReactCompilerOptions(true);
const KEYED_ROWS_RUNTIME = /keyedRows\w*RuntimeFeature/;

function rowsSource(row: string, around = (rows: string) => `<ul>${rows}</ul>`) {
  return `
    import { useState } from "react";
    export function Rows() {
      const [rows, setRows] = useState([{ id: "a", label: "A", on: true }]);
      return <main>
        <button onClick={() => setRows((current) => [...current, { id: "b", label: "B", on: false }])}>Add</button>
        ${around(`{rows.map((row) => ${row})}`)}
      </main>;
    }
  `;
}

async function compileRows(row: string, around?: (rows: string) => string) {
  return compileReactModule(rowsSource(row, around), "/app/Rows.tsx", infer);
}

describe("React AOT keyed rows React keeps", () => {
  it("compiles plain HTML rows", async () => {
    const result = await compileRows(`<li key={row.id}>{row.label}</li>`);
    expect(result.code).toMatch(KEYED_ROWS_RUNTIME);
  });

  // The runtime makes row elements with createElement, which only makes HTML elements.
  it.each([
    {
      name: "rows inside an svg",
      row: `<rect key={row.id} className={row.label} width={10} height={10} />`,
      around: (rows: string) => `<svg><g>${rows}</g></svg>`,
    },
    {
      name: "svg rows rendered into another component's svg",
      row: `<circle key={row.id} className={row.label} r={5} />`,
      around: (rows: string) => `<g>${rows}</g>`,
    },
    {
      name: "rows inside math",
      row: `<mi key={row.id}>{row.label}</mi>`,
      around: (rows: string) => `<math>${rows}</math>`,
    },
    {
      name: "shared anchor names inside svg after JSX cloning",
      row: `<a key={row.id}>{row.label}</a>`,
      around: (rows: string) => `<svg><g>${rows}</g></svg>`,
    },
    {
      name: "shared title names inside svg after JSX cloning",
      row: `<title key={row.id}>{row.label}</title>`,
      around: (rows: string) => `<svg>${rows}</svg>`,
    },
    {
      name: "shared names in nested svg containers",
      row: `<a key={row.id}>{row.label}</a>`,
      around: (rows: string) => `<svg><svg><a>${rows}</a></svg></svg>`,
    },
  ])("leaves $name to React", async ({ row, around }) => {
    const result = await compileRows(row, around);
    expect(result.code).not.toMatch(KEYED_ROWS_RUNTIME);
  });

  // React applies these as properties or "true"/"false" strings; the runtime's attribute
  // writes would leave appended rows empty or unchecked, or drop spellcheck="false".
  it.each([
    { name: "defaultValue", row: `<li key={row.id}><input defaultValue={row.label} /></li>` },
    {
      name: "defaultChecked",
      row: `<li key={row.id}><input type="checkbox" defaultChecked={row.on} /></li>`,
    },
    { name: "spellCheck", row: `<li key={row.id} spellCheck={row.on}>{row.label}</li>` },
    { name: "draggable", row: `<li key={row.id} draggable={row.on}>{row.label}</li>` },
  ])("leaves rows with $name to React", async ({ row }) => {
    const result = await compileRows(row);
    expect(result.code).not.toMatch(KEYED_ROWS_RUNTIME);
  });

  it("still compiles a literal spellCheck string", async () => {
    const result = await compileRows(`<li key={row.id} spellCheck="false">{row.label}</li>`);
    expect(result.code).toMatch(KEYED_ROWS_RUNTIME);
  });

  it("does not carry namespace metadata into another compilation", async () => {
    await compileRows(`<a key={row.id}>{row.label}</a>`, (rows) => `<svg>${rows}</svg>`);
    const html = await compileRows(`<a key={row.id}>{row.label}</a>`);
    expect(html.code).toMatch(KEYED_ROWS_RUNTIME);
  });

  it("ends foreign ancestry before an HTML sibling after nested svg and math", async () => {
    const result = await compileRows(
      `<a key={row.id}>{row.label}</a>`,
      (rows) =>
        `<section><svg><svg><title>SVG</title></svg></svg><math><math><mi>x</mi></math></math><div>${rows}</div></section>`,
    );
    expect(result.code).toMatch(KEYED_ROWS_RUNTIME);
  });

  it("keeps the conservative foreignObject subtree fallback", async () => {
    const result = await compileRows(
      `<a key={row.id}>{row.label}</a>`,
      (rows) => `<svg><foreignObject><div>${rows}</div></foreignObject></svg>`,
    );
    expect(result.code).not.toMatch(KEYED_ROWS_RUNTIME);
  });
});
