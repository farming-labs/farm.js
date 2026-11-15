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

// Typing into a field: the browser has already inserted the text and placed the caret.
const typeAt =
  (selector: string, value: string, caret: number) =>
  (host: HTMLElement): void => {
    const input = host.querySelector<HTMLInputElement>(selector)!;
    input.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    // Number inputs have no selection to place.
    if (input.type !== "number") input.setSelectionRange(caret, caret);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };

describe("controlled fields a compiled root restores after a change", () => {
  it("keep the caret and the typed text where React does", async () => {
    const { reference, subject } = await mount(
      `import { useState } from "react";
      export function Form() {
        const [name, setName] = useState("Ada");
        const [amount, setAmount] = useState(1);
        return (
          <section>
            <input id="name" value={name} onChange={(event) => { if (event.target.value.length <= 5) setName(event.target.value); }} />
            <input id="amount" type="number" value={amount} onChange={(event) => setAmount(Number(event.target.value))} />
          </section>
        );
      }`,
      "Form",
      (host, Component) => {
        const root = createCompiledRoot(host);
        compiledRoots.add(root);
        root.render(React.createElement(Component));
      },
    );
    const steps = [
      // Accepted in the middle: the caret stays after the inserted letter.
      typeAt("#name", "Adxa", 3),
      // Rejected: the field returns to its value.
      typeAt("#name", "Adxyza", 5),
      // A number input keeps "1." while its value is 1 (React compares it loosely).
      typeAt("#amount", "1.", 2),
      typeAt("#amount", "1.5", 3),
    ];
    const afterSteps: string[][] = [];
    for (const [index, step] of steps.entries()) {
      for (const host of [reference, subject]) await act(async () => step(host));
      expect(carets(subject), `after step ${index + 1}`).toEqual(carets(reference));
      afterSteps.push(carets(reference));
    }
    // jsdom sanitizes "1." to "", so the number steps check parity only; browsers keep "1.".
    expect(afterSteps.map(([name]) => name)).toEqual([
      "Adxa@3-3",
      "Adxa@4-4",
      "Adxa@4-4",
      "Adxa@4-4",
    ]);
  });

  it("write nothing to a field whose state took the edit, so it keeps its undo history", async () => {
    const { subject } = await mount(
      `import { useState } from "react";
      export function Form() {
        const [name, setName] = useState("Ada");
        const [note, setNote] = useState("Hey");
        return (
          <section>
            <input id="name" value={name} onChange={(event) => setName(event.target.value)} />
            <input id="note" value={note} onChange={(event) => { event.stopPropagation(); setNote(event.target.value); }} />
          </section>
        );
      }`,
      "Form",
      (host, Component) => {
        const root = createCompiledRoot(host);
        compiledRoots.add(root);
        root.render(React.createElement(Component));
      },
    );
    // A script's value write clears the field's undo history; typeAt uses the prototype setter.
    const writes: string[] = [];
    const value = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!;
    for (const input of subject.querySelectorAll("input")) {
      Object.defineProperty(input, "value", {
        configurable: true,
        get: () => value.get!.call(input),
        set: (next: string) => {
          writes.push(`${input.id}=${next}`);
          value.set!.call(input, next);
        },
      });
    }
    for (const step of [typeAt("#name", "Adxa", 3), typeAt("#note", "Hxey", 2)]) {
      await act(async () => step(subject));
    }
    expect(writes).toEqual([]);
    expect(carets(subject)).toEqual(["Adxa@3-3", "Hxey@2-2"]);
  });
});
