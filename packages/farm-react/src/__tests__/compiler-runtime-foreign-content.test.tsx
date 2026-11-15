import React, { act, StrictMode } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadCompiledAndOriginal, removeCompiledModules } from "./compiled-module-harness";

const roots: Root[] = [];
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";

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

describe.each(["static", "hybrid"] as const)("%s foreign content", (reactivity) => {
  describe.each([false, true])("hydrate=%s", (hydrate) => {
    it.each(["a", "title", "rect", "html"])(
      "preserves namespaces and surviving row identity for %s",
      async (kind) => {
        const tag = kind === "html" ? "a" : kind;
        const row =
          tag === "rect"
            ? `<rect key={row.id} data-row={row.id} width={10} />`
            : `<${tag} key={row.id} data-row={row.id}>{row.label}</${tag}>`;
        const rows = `{rows.map(row => ${row})}`;
        const content = kind === "html" ? `<div>${rows}</div>` : `<svg><g>${rows}</g></svg>`;
        const source = `
          import { useState } from "react";
          export function Rows() {
            const [rows, setRows] = useState([{ id: "a", label: "A" }]);
            return <main>
              <button id="add" onClick={() => setRows(current => [...current, { id: "b", label: "B" }])}>Add</button>
              <button id="remove" onClick={() => setRows(current => current.filter(row => row.id !== "b"))}>Remove</button>
              ${content}
            </main>;
          }
        `;
        const { compiled, original, names, reasons } = await loadCompiledAndOriginal(
          source,
          reactivity,
        );
        expect(names).toEqual(["Rows"]);
        expect(reasons).toEqual([]);
        const errors: unknown[] = [];
        const containers: HTMLElement[] = [];
        for (const Component of [original.Rows, compiled.Rows]) {
          const container = document.createElement("div");
          document.body.append(container);
          containers.push(container);
          const element = (
            <StrictMode>
              <Component />
            </StrictMode>
          );
          await act(async () => {
            if (hydrate) {
              container.innerHTML = renderToString(element);
              roots.push(
                hydrateRoot(container, element, {
                  onRecoverableError: (error) => errors.push(error),
                }),
              );
            } else {
              const root = createRoot(container);
              roots.push(root);
              root.render(element);
            }
          });
        }
        const survivors = containers.map((container) => container.querySelector('[data-row="a"]'));
        for (const action of ["add", "remove", "add"]) {
          for (const [index, container] of containers.entries()) {
            const button = container.querySelector<HTMLButtonElement>(`#${action}`)!;
            button.focus();
            await act(async () => button.click());
            expect(document.activeElement).toBe(button);
            expect(container.querySelector('[data-row="a"]')).toBe(survivors[index]);
            const elements = [...container.querySelectorAll("[data-row]")];
            expect(elements).toHaveLength(action === "remove" ? 1 : 2);
            expect(elements.map((element) => element.namespaceURI)).toEqual(
              elements.map(() => (kind === "html" ? HTML_NAMESPACE : SVG_NAMESPACE)),
            );
          }
          expect(containers[1].innerHTML).toBe(containers[0].innerHTML);
        }
        expect(errors).toEqual([]);
      },
    );
  });
});
