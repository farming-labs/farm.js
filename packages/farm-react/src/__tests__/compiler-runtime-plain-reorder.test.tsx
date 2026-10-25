import React, { act, StrictMode } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { loadCompiledAndOriginal, removeCompiledModules } from "./compiled-module-harness";

const source = `
  import { useState } from "react";
  export function Rows({ initialRows }) {
    const [rows, setRows] = useState(initialRows);
    return <main>
      <button id="reverse" onClick={() => setRows(current => current.toReversed())}>Reverse</button>
      <button id="sort" onClick={() => setRows(current => current.toSorted((a, b) => a.rank - b.rank))}>Sort</button>
      <button id="map" onClick={() => setRows(current => current.map(row => row.id === "a" ? {...row, label: row.label + "!"} : row))}>Map</button>
      <button id="append" onClick={() => setRows(current => [...current, {id: "d", label: "D", rank: 0}])}>Append</button>
      <button id="reset" onClick={() => setRows(initialRows)}>Reset</button>
      <button id="clear" onClick={() => setRows([])}>Clear</button>
      <ul>{rows.map(row => <li key={row.id} data-key={row.id}>
        <input value={row.label} readOnly />
        <button onClick={() => setRows(current => current.map(item => item.id === row.id ? {...item, label: item.label + "?"} : item))}>{row.label}</button>
      </li>)}</ul>
    </main>;
  }
`;
const roots: Root[] = [];
afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.replaceChildren();
});
afterAll(removeCompiledModules);

function snapshot(container: HTMLElement) {
  // Controlled inputs are updated through their live value property. Compare
  // that value explicitly, not React's serialized default-value attribute.
  const markup = container.cloneNode(true) as HTMLElement;
  for (const input of markup.querySelectorAll("input")) input.removeAttribute("value");
  return {
    markup: markup.innerHTML,
    values: [...container.querySelectorAll("input")].map((input) => input.value),
  };
}

describe.each(["hybrid", "static"] as const)(
  "plain reorder integration in %s mode",
  (reactivity) => {
    it.each(["mount", "hydrate", "custom-method"])(
      "matches React through reorder, mixed queued updates, and fallback after %s",
      async (mode) => {
        globalThis.IS_REACT_ACT_ENVIRONMENT = true;
        const { compiled, original, names, reasons, code } = await loadCompiledAndOriginal(
          source,
          reactivity,
        );
        expect(names).toEqual(["Rows"]);
        expect(reasons).toEqual([]);
        expect(code).toContain("keyedRowsPlainReorderHintedRuntimeFeature");
        expect(code).toContain("createCompilerKeyedMapUpdate");
        expect(code).toContain("createCompilerKeyedArrayAppend");
        const views = [];
        for (const Component of [original.Rows, compiled.Rows]) {
          const initialRows = [
            { id: "a", label: "Alpha", rank: 3 },
            { id: "b", label: "Beta", rank: 2 },
            { id: "c", label: "Gamma", rank: 1 },
          ];
          if (mode === "custom-method") {
            Object.defineProperty(initialRows, "toReversed", {
              value() {
                return [this[1], this[2], this[0]];
              },
            });
          }
          const container = document.createElement("div");
          document.body.append(container);
          const element = (
            <StrictMode>
              <Component initialRows={initialRows} />
            </StrictMode>
          );
          const errors: unknown[] = [];
          if (mode === "hydrate") container.innerHTML = renderToString(element);
          const serverRows = [...container.querySelectorAll("li")];
          await act(async () => {
            const root =
              mode === "hydrate"
                ? hydrateRoot(container, element, {
                    onRecoverableError: (error) => errors.push(error),
                  })
                : createRoot(container);
            roots.push(root);
            if (mode !== "hydrate") root.render(element);
          });
          expect(errors).toEqual([]);
          if (mode === "hydrate") expect([...container.querySelectorAll("li")]).toEqual(serverRows);
          views.push(container);
        }
        expect(snapshot(views[1])).toEqual(snapshot(views[0]));
        const steps = [
          ["#reverse"],
          ["#sort"],
          ["#reverse", "#reverse"],
          ["#map", "#reverse"],
          ["#reverse", "#map"],
          ["#append", "#reverse"],
          ['li[data-key="a"] button'],
          ["#reset"],
          ["#clear"],
          ["#reset"],
          ["#reverse"],
        ];
        for (const selectors of steps) {
          for (const container of views) {
            const previous = new Map(
              [...container.querySelectorAll("li")].map((row) => [row.dataset.key, row]),
            );
            const input = container.querySelector<HTMLInputElement>('li[data-key="a"] input');
            input?.focus();
            input?.setSelectionRange(1, 3);
            await act(async () => {
              for (const selector of selectors)
                container.querySelector<HTMLElement>(selector)!.click();
              await Promise.resolve();
              await Promise.resolve();
            });
            for (const row of container.querySelectorAll("li")) {
              if (previous.has(row.dataset.key)) expect(row).toBe(previous.get(row.dataset.key));
            }
            if (input?.isConnected) {
              expect(document.activeElement).toBe(input);
              if (selectors.every((selector) => selector === "#reverse" || selector === "#sort")) {
                expect([input.selectionStart, input.selectionEnd]).toEqual([1, 3]);
              }
            }
          }
          expect(snapshot(views[1])).toEqual(snapshot(views[0]));
        }
      },
    );
  },
);
