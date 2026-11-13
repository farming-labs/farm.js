import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createCompiledRoot, type CompiledRoot } from "../compiled-root";
import { loadCompiledAndOriginal, removeCompiledModules } from "./compiled-module-harness";

// React sets a new text field's value before its default value. Assigning a changed value moves
// the caret to the end, so a field focused by code (or a test driver) types after its text.
// Fields the compiled runtime creates must leave the caret where React does.

const reactRoots = new Set<Root>();
const compiledRoots = new Set<CompiledRoot>();
beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(async () => {
  await act(async () => {
    for (const root of reactRoots) root.unmount();
    for (const root of compiledRoots) root.unmount();
  });
  reactRoots.clear();
  compiledRoots.clear();
  document.body.replaceChildren();
});
afterAll(removeCompiledModules);

const carets = (host: HTMLElement) =>
  [...host.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea")].map(
    (field) => `${field.value}@${field.selectionStart}-${field.selectionEnd}`,
  );

async function mount(
  source: string,
  name: string,
  mountSubject: (host: HTMLElement, Component: React.ComponentType) => void,
) {
  const { compiled, original, names } = await loadCompiledAndOriginal(source);
  expect(names, "the scenario must compile").toContain(name);
  const reference = document.createElement("div");
  const subject = document.createElement("div");
  document.body.append(reference, subject);
  const root = createRoot(reference);
  reactRoots.add(root);
  await act(async () => {
    root.render(React.createElement(original[name]!));
    mountSubject(subject, compiled[name]!);
  });
  return { reference, subject };
}

const rows = (field: string) => `import { useState } from "react";
export function Rows() {
  const [rows, setRows] = useState([{ id: 1, label: "One" }]);
  return (
    <section>
      <button id="add" onClick={() => setRows([...rows, { id: rows.length + 1, label: "Row " + (rows.length + 1) }])}>Add</button>
      <ul>{rows.map((row) => <li key={row.id}>${field}</li>)}</ul>
    </section>
  );
}`;

describe("text fields the compiled runtime creates", () => {
  it("leave the caret where React does on a compiled root", async () => {
    const { reference, subject } = await mount(
      rows(
        `<input value={row.label} onChange={(event) => setRows(rows.map((item) => item.id === row.id ? { ...item, label: event.target.value } : item))} />`,
      ),
      "Rows",
      (host, Component) => {
        const root = createCompiledRoot(host);
        compiledRoots.add(root);
        root.render(React.createElement(Component));
      },
    );
    expect(carets(subject)).toEqual(carets(reference));
    for (const host of [reference, subject]) {
      await act(async () => host.querySelector<HTMLButtonElement>("#add")!.click());
    }
    expect(carets(subject)).toEqual(carets(reference));
    expect(carets(reference)).toEqual(["One@3-3", "Row 2@5-5"]);
  });

  it("leave the caret where React does in rows added under React DOM", async () => {
    const { reference, subject } = await mount(
      rows(`<input readOnly value={row.label} />`),
      "Rows",
      (host, Component) => {
        const root = createRoot(host);
        reactRoots.add(root);
        root.render(React.createElement(Component));
      },
    );
    for (const host of [reference, subject]) {
      await act(async () => host.querySelector<HTMLButtonElement>("#add")!.click());
    }
    expect(carets(subject)).toEqual(carets(reference));
    expect(carets(reference)).toEqual(["One@3-3", "Row 2@5-5"]);
  });
});
