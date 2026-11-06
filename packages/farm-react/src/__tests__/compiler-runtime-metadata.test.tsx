import React, { act, StrictMode } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { loadCompiledAndOriginal, removeCompiledModules } from "./compiled-module-harness";

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

const layouts = [
  "{visible && ELEMENT}",
  "{items.map(item => <section key={item.id}>ELEMENT</section>)}",
  "{visible && <section>{items.map(item => <div key={item.id}>ELEMENT</div>)}</section>}",
];

describe.each(["static", "hybrid"] as const)("%s metadata ownership", (reactivity) => {
  describe.each([false, true])("hydrate=%s", (hydrate) => {
    describe.each([false, true])("itemProp=%s", (scoped) => {
      describe.each(["title", "meta"])("%s", (tag) => {
        it.each(layouts)("preserves insertion, updates and removal in %s", async (layout) => {
          const props = `data-farm-metadata="probe" ${scoped ? 'itemProp="name"' : ""}`;
          const element =
            tag === "title"
              ? `<title ${props}>{label}</title>`
              : `<meta ${props} name="description" content={label}/>`;
          const result = await loadCompiledAndOriginal(
            `import {useState} from "react";
            export function Probe(){
              const [visible,setVisible]=useState(false);
              const [items,setItems]=useState([]);
              const [label,setLabel]=useState("First");
              return <main><button id="toggle" onClick={()=>{setVisible(value=>!value);setItems(current=>current.length?[]:[{id:1}]);}}>Toggle</button>
              <button id="label" onClick={()=>setLabel("Second")}>Label</button>
              <div itemScope itemType="https://schema.org/Thing">${layout.replace("ELEMENT", element)}</div></main>;
            }`,
            reactivity,
          );
          const histories: unknown[][] = [];
          const errors: unknown[] = [];
          for (const Component of [result.original.Probe, result.compiled.Probe]) {
            const container = document.createElement("div");
            document.body.append(container);
            const component = (
              <StrictMode>
                <Component />
              </StrictMode>
            );
            let root!: Root;
            await act(async () => {
              if (hydrate) {
                container.innerHTML = renderToString(component);
                root = hydrateRoot(container, component, {
                  onRecoverableError: (error) => errors.push(error),
                });
              } else {
                root = createRoot(container);
                root.render(component);
              }
              roots.add(root);
            });
            const snapshot = () => {
              const values = (parent: ParentNode) =>
                Array.from(parent.querySelectorAll('[data-farm-metadata="probe"]'), (node) =>
                  tag === "title" ? node.textContent : node.getAttribute("content"),
                );
              return { head: values(document.head), body: values(container) };
            };
            const history: unknown[] = [snapshot()];
            for (const selector of ["#toggle", "#label", "#toggle", "#toggle"]) {
              await act(async () => container.querySelector<HTMLButtonElement>(selector)!.click());
              history.push(snapshot());
            }
            await act(async () => root.unmount());
            roots.delete(root);
            history.push(snapshot());
            histories.push(history);
            container.remove();
          }
          const placed = (value: string) =>
            scoped ? { head: [], body: [value] } : { head: [value], body: [] };
          const empty = { head: [], body: [] };
          expect(histories[0]).toEqual([
            empty,
            placed("First"),
            placed("Second"),
            empty,
            placed("Second"),
            empty,
          ]);
          expect(histories[1]).toEqual(histories[0]);
          expect(errors).toEqual([]);
        });
      });
    });
  });
  it("keeps plain host conditionals compiled", async () => {
    const result = await loadCompiledAndOriginal(
      `import {useState} from "react";export function Probe(){const [visible,setVisible]=useState(false);return <main><button onClick={()=>setVisible(value=>!value)}>Toggle</button><div>{visible&&<span>Plain</span>}</div></main>;}`,
      reactivity,
    );
    expect(result.names).toEqual(["Probe"]);
    expect(result.code).toContain("farmBlocks.HostConditional");
  });
});
