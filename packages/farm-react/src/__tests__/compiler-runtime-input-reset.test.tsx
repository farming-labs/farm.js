import React, { act, StrictMode } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadCompiledAndOriginal, removeCompiledModules } from "./compiled-module-harness";

const roots: Root[] = [];

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

afterAll(removeCompiledModules);

async function mount(Component: React.ComponentType, hydrate: boolean) {
  const container = document.createElement("div");
  document.body.append(container);
  const element = (
    <StrictMode>
      <Component />
    </StrictMode>
  );
  if (hydrate) container.innerHTML = renderToString(element);
  await act(async () => {
    const root = hydrate ? hydrateRoot(container, element) : createRoot(container);
    roots.push(root);
    if (!hydrate) root.render(element);
  });
  return container;
}

function snapshot(container: Element) {
  return Array.from(container.querySelectorAll("input"), (input) => ({
    value: input.value,
    defaultValue: input.defaultValue,
    checked: input.checked,
    defaultChecked: input.defaultChecked,
  }));
}

async function click(container: Element, selector: string) {
  await act(async () => container.querySelector<HTMLElement>(selector)!.click());
}

for (const reactivity of ["hybrid", "static"] as const) {
  describe(`${reactivity} controlled input reset parity`, () => {
    for (const hydrate of [false, true]) {
      it.each([
        ["text", "before", "after"],
        ["email", "before@example.com", "after@example.com"],
        ["number", "1", "2"],
        ["date", "2026-01-01", "2026-02-02"],
      ])(
        `keeps the latest %s value after reset (hydrate=${hydrate})`,
        async (type, before, after) => {
          const source = `
          import { useState } from "react";
          export function Form() {
            const [value, setValue] = useState(${JSON.stringify(before)});
            return <form>
              <input id="controlled" type="${type}" value={value} readOnly />
              <input id="uncontrolled" defaultValue="initial" />
              <input type="checkbox" defaultChecked />
              <input type="radio" name="choice" defaultChecked />
              <button id="set" type="button" onClick={() => setValue(${JSON.stringify(after)})}>set</button>
              <button id="clear" type="button" onClick={() => setValue("")}>clear</button>
              <button id="reset" type="reset">reset</button>
            </form>;
          }
        `;
          const { compiled, original, names, reasons } = await loadCompiledAndOriginal(
            source,
            reactivity,
          );
          expect(names).toContain("Form");
          expect(reasons).toEqual([]);
          const react = await mount(original.Form, hydrate);
          const farm = await mount(compiled.Form, hydrate);
          const input = farm.querySelector("#controlled");
          for (const container of [react, farm]) {
            container.querySelector<HTMLInputElement>("#uncontrolled")!.value = "user edit";
          }
          expect(snapshot(farm)).toEqual(snapshot(react));
          for (const selector of ["#set", "#reset", "#clear", "#reset", "#set", "#reset"]) {
            await click(react, selector);
            await click(farm, selector);
            expect(snapshot(farm)).toEqual(snapshot(react));
            expect(farm.querySelector("#controlled")).toBe(input);
          }
        },
      );
    }

    it("defers a focused number's default value until React's blur handling", async () => {
      const source = `
        import { useState } from "react";
        export function Form() {
          const [value, setValue] = useState("1");
          return <form>
            <input type="number" value={value} readOnly />
            <button id="set" type="button" onClick={() => setValue("2")}>set</button>
          </form>;
        }
      `;
      const { compiled, original, names } = await loadCompiledAndOriginal(source, reactivity);
      expect(names).toContain("Form");
      const histories = [];
      for (const Component of [original.Form, compiled.Form]) {
        const container = await mount(Component, false);
        const input = container.querySelector("input")!;
        input.focus();
        await click(container, "#set");
        expect(document.activeElement).toBe(input);
        expect(input.defaultValue).toBe("1");
        const focused = snapshot(container);
        await act(async () => input.blur());
        const blurred = snapshot(container);
        container.querySelector("form")!.reset();
        histories.push({ focused, blurred, reset: snapshot(container) });
      }
      expect(histories[1]).toEqual(histories[0]);
    });

    it("preserves focused text selection and avoids redundant default-value writes", async () => {
      const source = `
        import { useState } from "react";
        export function Form() {
          const [value, setValue] = useState("before");
          return <form><input value={value} readOnly />
            <button id="set" type="button" onClick={() => setValue("after")}>set</button>
          </form>;
        }
      `;
      const { compiled, original, names } = await loadCompiledAndOriginal(source, reactivity);
      expect(names).toContain("Form");
      for (const Component of [original.Form, compiled.Form]) {
        const container = await mount(Component, false);
        const input = container.querySelector("input")!;
        await click(container, "#set");
        input.focus();
        input.setSelectionRange(1, 3);
        const writes = vi.spyOn(input, "defaultValue", "set");
        await click(container, "#set");
        expect(document.activeElement).toBe(input);
        expect([input.selectionStart, input.selectionEnd]).toEqual([1, 3]);
        expect(input.defaultValue).toBe("after");
        expect(writes).not.toHaveBeenCalled();
      }
    });

    it("leaves controlled checkbox and radio reset baselines unchanged", async () => {
      const source = `
        import { useState } from "react";
        export function Form() {
          const [checked, setChecked] = useState(true);
          return <form>
            <input type="checkbox" checked={checked} readOnly />
            <input type="radio" name="choice" checked={checked} readOnly />
            <button id="set" type="button" onClick={() => setChecked(false)}>set</button>
            <button id="reset" type="reset">reset</button>
          </form>;
        }
      `;
      const { compiled, original, names } = await loadCompiledAndOriginal(source, reactivity);
      expect(names).toContain("Form");
      const react = await mount(original.Form, false);
      const farm = await mount(compiled.Form, false);
      for (const selector of ["#set", "#reset"]) {
        await click(react, selector);
        await click(farm, selector);
        expect(snapshot(farm)).toEqual(snapshot(react));
        expect(farm.querySelector("input")!.defaultChecked).toBe(true);
      }
    });

    it("keeps reset values with keyed input updates, new rows, and reorders", async () => {
      const source = `
        import { useState } from "react";
        export function Form() {
          const [rows, setRows] = useState([{ id: 1, label: "before" }]);
          return <form>
            <button id="set" type="button" onClick={() => setRows(current => current.map(row => ({ ...row, label: "after" })))}>set</button>
            <button id="add" type="button" onClick={() => setRows(current => [...current, { id: 2, label: "new" }])}>add</button>
            <button id="reverse" type="button" onClick={() => setRows(current => current.toReversed())}>reverse</button>
            <button id="reset" type="reset">reset</button>
            <ul>{rows.map(row => <li key={row.id}><input data-key={row.id} value={row.label} readOnly /></li>)}</ul>
          </form>;
        }
      `;
      const { compiled, original, names, reasons } = await loadCompiledAndOriginal(
        source,
        reactivity,
      );
      expect(names).toContain("Form");
      expect(reasons).toEqual([]);
      const react = await mount(original.Form, false);
      const farm = await mount(compiled.Form, false);
      const first = farm.querySelector('[data-key="1"]');
      for (const selector of ["#set", "#reset", "#add", "#reset", "#reverse", "#set", "#reset"]) {
        await click(react, selector);
        await click(farm, selector);
        expect(snapshot(farm)).toEqual(snapshot(react));
        expect(farm.querySelector('[data-key="1"]')).toBe(first);
      }
    });
  });
}
