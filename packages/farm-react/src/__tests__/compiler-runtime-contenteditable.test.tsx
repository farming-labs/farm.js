import React, { act, StrictMode } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { loadCompiledAndOriginal, removeCompiledModules } from "./compiled-module-harness";

const roots: Root[] = [];
beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.replaceChildren();
});
afterAll(removeCompiledModules);

const layouts = [
  '<span id="target" contentEditable={VALUE}>fixed</span>',
  '{visible && <span id="target" contentEditable={VALUE}>fixed</span>}',
  '{items.map(item => <span key={item.id} id="target" contentEditable={VALUE}>fixed</span>)}',
  '{visible && <section>{items.map(item => <span key={item.id} id="target" contentEditable={VALUE}>fixed</span>)}</section>}',
];
const values = [
  ["active", ["false", "true", "false", "true"]],
  ["active ? true : null", [null, "true", null, "true"]],
  ['active ? "true" : "false"', ["false", "true", "false", "true"]],
  ["false", ["false", "false", "false", "false"]],
] as const;

describe.each(["static", "hybrid"] as const)("%s contentEditable", (reactivity) => {
  describe.each([false, true])("hydrate=%s", (hydrate) => {
    describe.each(values)("value=%s", (value, expected) => {
      it.each(layouts)("preserves enumerated values in %s", async (layout) => {
        const result = await loadCompiledAndOriginal(
          `import {useState} from "react";
          export function Probe(){
            const [active,setActive]=useState(false);
            const [visible,setVisible]=useState(true);
            const [items,setItems]=useState([{id:1}]);
            return <main><button id="toggle" onClick={()=>setActive(value=>!value)}>Toggle</button>
            <button id="visibility" onClick={()=>setVisible(value=>!value)}>Visibility</button>
            <div contentEditable suppressContentEditableWarning>${layout.replace("VALUE", value)}</div></main>;
          }`,
          reactivity,
        );
        const histories: (string | null)[][] = [];
        const errors: unknown[] = [];
        for (const Component of [result.original.Probe, result.compiled.Probe]) {
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
          const target = container.querySelector("#target")!;
          const history: (string | null)[] = [];
          for (let step = 0; step < 4; step++) {
            history.push(target.getAttribute("contenteditable"));
            if (step < 3)
              await act(async () => container.querySelector<HTMLButtonElement>("#toggle")!.click());
            expect(container.querySelector("#target")).toBe(target);
          }
          await act(async () => container.querySelector<HTMLButtonElement>("#visibility")!.click());
          await act(async () => container.querySelector<HTMLButtonElement>("#visibility")!.click());
          history.push(container.querySelector("#target")!.getAttribute("contenteditable"));
          histories.push(history);
        }
        expect(histories[0]).toEqual([...expected, expected[3]]);
        expect(histories[1]).toEqual(histories[0]);
        expect(errors).toEqual([]);
      });
    });
  });
  it("keeps literal strings on ordinary compiled hosts", async () => {
    const result = await loadCompiledAndOriginal(
      `import {useState} from "react";
      export function Probe(){const [active,setActive]=useState(false);return <main><button onClick={()=>setActive(value=>!value)}>Toggle</button><div contentEditable suppressContentEditableWarning><span contentEditable="false" data-active={active}>fixed</span></div></main>;}`,
      reactivity,
    );
    expect(result.names).toEqual(["Probe"]);
  });
});
