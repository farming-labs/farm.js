import React, { act, StrictMode } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadCompiledAndOriginal, removeCompiledModules } from "./compiled-module-harness";

const roots: Root[] = [];
const bodies = {
  keyed:
    '<ul>{rows.map(row => <li key={row.id}><span data-text="single">{row.label}</span><b data-text="joined">prefix {row.label} suffix</b></li>)}</ul>',
  nested:
    '<ul>{rows.map(row => <li key={row.id}><section><span data-text="single">{row.label}</span><b data-text="joined">prefix {row.label} suffix</b></section></li>)}</ul>',
};
const modules = new Map<string, Awaited<ReturnType<typeof loadCompiledAndOriginal>>>();

beforeAll(async () => {
  for (const [name, body] of Object.entries(bodies)) {
    // Each fixture needs its own HMR identity even though the harness reuses a source path.
    const componentName = `Text${name}`;
    const module = await loadCompiledAndOriginal(`
      import { useState } from "react";
      export function ${componentName}({ next }) {
        const [rows, setRows] = useState([{id: 1, label: "before"}]);
        return <main>
          <input aria-label="Uncontrolled input" defaultValue="keep selection" />
          <button data-action="update" onClick={() => {
            setRows(current => current.map(row => ({...row, label: next})));
          }}>Update</button>
          <button data-action="clear" onClick={() => setRows([])}>Clear</button>
          <button data-action="reset" onClick={() => setRows([{id: 1, label: next}])}>Reset</button>
          ${body}
        </main>;
      }
    `);
    expect(module.names).toEqual([componentName]);
    expect(module.reasons).toEqual([]);
    expect(module.code).toContain("keyedRowsPlainRuntimeFeature");
    modules.set(name, {
      ...module,
      compiled: { Labels: module.compiled[componentName] },
      original: { Labels: module.original[componentName] },
    });
  }
});

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.replaceChildren();
});
afterAll(removeCompiledModules);

describe.each([false, true])("text readers (hydration: %s)", (hydrate) => {
  it.each(Object.keys(bodies))("matches ordinary React in %s text bindings", async (name) => {
    const { compiled, original } = modules.get(name)!;
    const errors: unknown[] = [];
    const views = [];
    for (const Component of [original.Labels, compiled.Labels]) {
      const container = document.createElement("div");
      document.body.append(container);
      const element = (
        <StrictMode>
          <Component next="after" />
        </StrictMode>
      );
      if (hydrate) {
        const Original = original.Labels;
        container.innerHTML = renderToString(
          <StrictMode>
            <Original next="after" />
          </StrictMode>,
        );
      }
      let root!: Root;
      await act(async () => {
        root = hydrate
          ? hydrateRoot(container, element, { onRecoverableError: (error) => errors.push(error) })
          : createRoot(container);
        if (!hydrate) root.render(element);
      });
      roots.push(root);
      views.push({ Component, container, root });
    }
    const [control, candidate] = views;
    const text = (container: HTMLElement) =>
      Array.from(container.querySelectorAll("[data-text]"), (node) => node.textContent);
    const input = candidate.container.querySelector("input")!;
    const single = candidate.container.querySelector('[data-text="single"]')!;
    const joined = candidate.container.querySelector('[data-text="joined"]')!;
    const textNode = single.firstChild;
    input.focus();
    input.value = "user-edited";
    input.setSelectionRange(2, 6);
    const values = [
      "after",
      0,
      -0,
      12.5,
      "",
      false,
      true,
      null,
      undefined,
      [],
      ["one"],
      ["two", 0, false, null, ["nested", ["!"]]],
      // Intentional holes: undefined elements do not exercise sparse-array semantics.
      new Array(3), // oxlint-disable-line unicorn/no-new-array
      ["start", , "end"], // oxlint-disable-line no-sparse-arrays
      "restored",
    ];
    for (const next of values) {
      for (const { Component, container, root } of views) {
        await act(async () =>
          root.render(
            <StrictMode>
              <Component next={next} />
            </StrictMode>,
          ),
        );
        await act(async () =>
          container.querySelector<HTMLButtonElement>('[data-action="update"]')!.click(),
        );
      }
      expect(text(candidate.container)).toEqual(text(control.container));
      expect(candidate.container.querySelector('[data-text="single"]')).toBe(single);
      expect(candidate.container.querySelector('[data-text="joined"]')).toBe(joined);
      if (next === "after") expect(single.firstChild).toBe(textNode);
      expect(candidate.container.querySelector("input")).toBe(input);
      expect(document.activeElement).toBe(input);
      expect([input.value, input.selectionStart, input.selectionEnd]).toEqual([
        "user-edited",
        2,
        6,
      ]);
    }
    // Recreate rows after text updates to exercise the cached row template.
    for (const action of ["clear", "reset", "clear", "reset"]) {
      for (const { container } of views) {
        await act(async () =>
          container.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)!.click(),
        );
      }
      expect(text(candidate.container)).toEqual(text(control.container));
      expect(candidate.container.textContent).toBe(control.container.textContent);
    }
    expect(errors).toEqual([]);
  });
});
