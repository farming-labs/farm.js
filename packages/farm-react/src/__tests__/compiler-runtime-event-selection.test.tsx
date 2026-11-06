import React, { act, StrictMode } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
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
});
afterAll(removeCompiledModules);

const cases = [
  { name: "replacement", expression: "active ? second : first", expected: ["first", "second"] },
  {
    name: "inline selection",
    expression: "active ? event => second(event) : event => first(event)",
    expected: ["first", "second"],
  },
  { name: "addition", expression: "active ? first : undefined", expected: [null, "first"] },
  { name: "removal", expression: "active ? undefined : first", expected: ["first", null] },
  {
    name: "logical selection",
    expression: "(active && second) || first",
    expected: ["first", "second"],
  },
  { name: "factory", expression: "choose(active)", expected: ["first", "second"] },
  {
    name: "capture replacement",
    expression: "active ? second : first",
    event: "onClickCapture",
    expected: ["first", "second"],
  },
  {
    name: "inline live read",
    expression: "event => (active ? second : first)(event)",
    expected: ["first", "second"],
    compiled: true,
  },
  {
    name: "inline function",
    expression: "function(event) { (active ? second : first)(event); }",
    expected: ["first", "second"],
    compiled: true,
  },
  {
    name: "local handler",
    local: "const handler = event => (active ? second : first)(event);",
    expression: "handler",
    expected: ["first", "second"],
    compiled: true,
  },
  { name: "stable handler", expression: "first", expected: ["first", "first"], compiled: true },
  {
    name: "shadowed local",
    expression: "(active => active ? second : first)(true)",
    expected: ["second", "second"],
    compiled: true,
  },
];

describe.each(["static", "hybrid"] as const)("%s event selection", (reactivity) => {
  describe.each([false, true])("hydrate=%s", (hydrate) => {
    it.each(cases)("preserves $name", async (test) => {
      const source = `
        import { useState } from "react";
        const first = event => event.currentTarget.setAttribute("data-called", "first");
        const second = event => event.currentTarget.setAttribute("data-called", "second");
        const choose = active => active ? second : first;
        export function Probe() {
          const [active, setActive] = useState(false);
          ${test.local || ""}
          return <main>
            <button id="toggle" onClick={() => setActive(value => !value)}>Toggle</button>
            <output>{String(active)}</output>
            <button id="target" ${test.event || "onClick"}={${test.expression}}>Action</button>
          </main>;
        }
      `;
      const { compiled, original, names, reasons } = await loadCompiledAndOriginal(
        source,
        reactivity,
      );
      const histories: (string | null)[][] = [];
      const errors: unknown[] = [];
      for (const Component of [original.Probe, compiled.Probe]) {
        const container = document.createElement("div");
        document.body.append(container);
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
        const target = container.querySelector<HTMLButtonElement>("#target")!;
        const history: (string | null)[] = [];
        for (let step = 0; step < 4; step++) {
          expect(container.querySelector("output")!.textContent).toBe(String(step % 2 !== 0));
          target.removeAttribute("data-called");
          target.focus();
          await act(async () => target.click());
          history.push(target.getAttribute("data-called"));
          if (step < 3) {
            await act(async () => container.querySelector<HTMLButtonElement>("#toggle")!.click());
          }
          expect(container.querySelector("#target")).toBe(target);
          expect(document.activeElement).toBe(target);
        }
        histories.push(history);
      }
      expect(histories[0]).toEqual([...test.expected, ...test.expected]);
      expect(histories[1]).toEqual(histories[0]);
      expect(errors).toEqual([]);
      expect(names).toEqual(test.compiled ? ["Probe"] : []);
      expect(reasons).toEqual(
        test.compiled
          ? []
          : [expect.stringContaining("event handler selection requires React ownership")],
      );
    });
  });
});
