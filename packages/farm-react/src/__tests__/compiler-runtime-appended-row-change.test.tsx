import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { loadCompiledAndOriginal, removeCompiledModules } from "./compiled-module-harness";

// React derives onChange from the target's own fiber. A keyed row the compiled runtime creates
// after mount has none, so a delegated onChange on it never ran: an appended todo could not be
// toggled or edited. Each control here runs on a row from the first render and on an added row.

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

const source = (control: string) => `
  import { useState } from "react";
  export function Rows() {
    const [rows, setRows] = useState([{ id: 1, value: "a", done: false }]);
    const [log, setLog] = useState("");
    return (
      <section>
        <button id="add" onClick={() => setRows([...rows, { id: rows.length + 1, value: "a", done: false }])}>Add</button>
        <ul>{rows.map((row) => <li key={row.id} data-id={row.id}>${control}</li>)}</ul>
        <p id="log">{log}</p>
      </section>
    );
  }
`;

const setValue = (element: HTMLInputElement | HTMLSelectElement, value: string) => {
  const prototype =
    element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, value);
};

const controls: ReadonlyArray<[string, string, (row: Element) => void]> = [
  [
    "a text input",
    `<input value={row.value} onChange={(event) => setLog(log + "|" + row.id + ":" + event.target.value)} />`,
    (row) => {
      const input = row.querySelector("input")!;
      setValue(input, "z");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    },
  ],
  [
    "a checkbox",
    `<input type="checkbox" checked={row.done} onChange={() => setLog(log + "|" + row.id + ":checked")} />`,
    (row) => row.querySelector("input")!.click(),
  ],
  [
    "a select",
    `<select value={row.value} onChange={(event) => setLog(log + "|" + row.id + ":" + event.target.value)}><option value="a">A</option><option value="b">B</option></select>`,
    (row) => {
      const select = row.querySelector("select")!;
      setValue(select, "b");
      select.dispatchEvent(new Event("change", { bubbles: true }));
    },
  ],
];

describe("onChange on keyed rows added after mount", () => {
  it.each(controls)("runs for %s, as in React", async (_name, control, change) => {
    const { compiled, original, names } = await loadCompiledAndOriginal(source(control));
    expect(names).toContain("Rows");
    const hosts = [original.Rows, compiled.Rows].map((Component) => {
      const host = document.createElement("div");
      document.body.append(host);
      const root = createRoot(host);
      roots.add(root);
      return { host, root, Component };
    });
    await act(async () => {
      for (const { root, Component } of hosts) root.render(<Component />);
    });
    for (const step of [
      (host: Element) => host.querySelector<HTMLButtonElement>("#add")!.click(),
      (host: Element) => change(host.querySelector('li[data-id="1"]')!),
      (host: Element) => change(host.querySelector('li[data-id="2"]')!),
    ]) {
      for (const { host } of hosts) await act(async () => step(host));
    }
    const [reference, subject] = hosts.map(({ host }) => host.querySelector("#log")!.textContent);
    expect(reference).toMatch(/\|1:.+\|2:.+/);
    expect(subject).toBe(reference);
  });
});
