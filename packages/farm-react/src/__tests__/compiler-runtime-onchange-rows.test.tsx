import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  loadCompiledAndOriginal,
  normalizedDom,
  removeCompiledModules,
} from "./compiled-module-harness";

// Compiler-owned rows with onChange beside row conditionals, or in a list between static
// siblings, run their events through the container only on a root without React DOM. Under React
// DOM the block renders them through React from the start. Each scenario renders the source with
// React and the compiled output with React DOM, then compares the DOM after every interaction.

const roots = new Set<Root>();
beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(async () => {
  await act(async () => {
    for (const root of roots) root.unmount();
  });
  roots.clear();
  document.body.replaceChildren();
});
afterAll(removeCompiledModules);

type Step = (host: HTMLElement) => void;
const click =
  (selector: string): Step =>
  (host) =>
    host.querySelector<HTMLElement>(selector)!.click();
const type =
  (selector: string, value: string): Step =>
  (host) => {
    const input = host.querySelector<HTMLInputElement>(selector)!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };

async function expectParity(source: string, name: string, block: string, steps: readonly Step[]) {
  const { compiled, original, names, code } = await loadCompiledAndOriginal(source);
  expect(names, "the scenario must compile").toContain(name);
  expect(code).toContain(block);
  expect(code).toContain("delegateEventsWithoutReact={true}");
  const hosts = [original[name]!, compiled[name]!].map((Component) => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.add(root);
    return { host, root, Component };
  });
  await act(async () => {
    for (const { root, Component } of hosts) root.render(<Component />);
  });
  const [reference, subject] = hosts.map(({ host }) => host) as [HTMLElement, HTMLElement];
  expect(normalizedDom(subject)).toBe(normalizedDom(reference));
  for (const [index, step] of steps.entries()) {
    for (const { host } of hosts) await act(async () => step(host));
    expect(normalizedDom(subject), `after step ${index + 1}`).toBe(normalizedDom(reference));
  }
}

const steps = [
  click('li[data-id="1"] .done'),
  click("#add"),
  type('li[data-id="2"] .label', "Two"),
  click('li[data-id="2"] .done'),
  click('li[data-id="1"] .done'),
  click("#add"),
  type('li[data-id="3"] .label', "Three"),
  click('li[data-id="3"] .done'),
];

describe("onChange rows under React DOM", () => {
  it("beside row conditionals render through React with working handlers", async () => {
    await expectParity(
      `import { useState } from "react";
      export function Todos() {
        const [rows, setRows] = useState([{ id: 1, label: "One", done: false }]);
        const update = (id, patch) =>
          setRows(rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
        return (
          <section>
            <button id="add" onClick={() => setRows([...rows, { id: rows.length + 1, label: "", done: false }])}>Add</button>
            <ul>
              {rows.map((row) => (
                <li key={row.id} data-id={row.id}>
                  <input className="done" type="checkbox" checked={row.done} onChange={(event) => update(row.id, { done: event.target.checked })} />
                  <input className="label" value={row.label} onChange={(event) => update(row.id, { label: event.target.value })} />
                  {row.done ? <s>{row.label}</s> : <span>{row.label}</span>}
                </li>
              ))}
            </ul>
          </section>
        );
      }`,
      "Todos",
      "hostBlocks={true}",
      steps,
    );
  });

  it("in a list between static siblings render through React with working handlers", async () => {
    await expectParity(
      `import { useState } from "react";
      export function Checklist() {
        const [rows, setRows] = useState([{ id: 1, label: "One", done: false }]);
        const update = (id, patch) =>
          setRows(rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
        return (
          <section>
            <ul>
              <li className="head">{rows.filter((row) => row.done).length} of {rows.length} done</li>
              {rows.map((row) => (
                <li key={row.id} data-id={row.id}>
                  <input className="done" type="checkbox" checked={row.done} onChange={(event) => update(row.id, { done: event.target.checked })} />
                  <input className="label" value={row.label} onChange={(event) => update(row.id, { label: event.target.value })} />
                </li>
              ))}
              <li className="foot"><button id="add" onClick={() => setRows([...rows, { id: rows.length + 1, label: "", done: false }])}>Add</button></li>
            </ul>
          </section>
        );
      }`,
      "Checklist",
      "farmBlocks.KeyedRanges",
      steps,
    );
  });
});
