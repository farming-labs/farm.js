import React, { act, StrictMode } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { loadCompiledAndOriginal, removeCompiledModules } from "./compiled-module-harness";

const roots: Root[] = [];
beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  customElements.define(
    "farm-property-probe",
    class extends HTMLElement {
      private current: unknown = 0;
      set counter(value: unknown) {
        this.current = value;
      }
      get counter() {
        return this.current;
      }
    },
  );
});
afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.replaceChildren();
});
afterAll(removeCompiledModules);

const layouts = [
  '<farm-property-probe id="target" counter={active ? 2 : 1} />',
  '<section>{visible && <farm-property-probe id="target" counter={active ? 2 : 1} />}</section>',
  '<section>{items.map(item => <div key={item.id}><farm-property-probe id="target" counter={active ? 2 : 1} /></div>)}</section>',
  '<section>{visible && <div><section>{items.map(item => <div key={item.id}><farm-property-probe id="target" counter={active ? 2 : 1} /></div>)}</section></div>}</section>',
];

describe.each(["static", "hybrid"] as const)("%s custom hosts", (reactivity) => {
  it("keeps custom keyed rows with React instead of descriptor cloning", async () => {
    const result = await loadCompiledAndOriginal(
      `import {useState} from "react";
      export function Probe(){const [items,setItems]=useState([{id:1,label:"one"}]);return <main><button onClick={()=>setItems(current=>current.slice(1))}>Drop</button><ul>{items.map(item=><li key={item.id}><farm-badge label={item.label}/></li>)}</ul></main>;}`,
      reactivity,
    );
    expect(result.names).toEqual(["Probe"]);
    expect(result.code).toContain("farmBlocks.KeyedList");
    expect(result.code).not.toContain("farmBlocks.KeyedRows");
    expect(result.code).not.toContain("cloneRows");
    expect(result.code).toContain("<farm-badge");
  });
  it.each(layouts)("keeps customized built-in descriptors React-owned in %s", async (layout) => {
    const result = await loadCompiledAndOriginal(
      `import {useState} from "react";
      export function Probe(){
        const [active,setActive]=useState(false);
        const [visible,setVisible]=useState(true);
        const [items,setItems]=useState([{id:1}]);
        return <main><button onClick={()=>setActive(value=>!value)}>Toggle</button>${layout.replaceAll("farm-property-probe", 'div is="farm-special"')}</main>;
      }`,
      reactivity,
    );
    expect(result.code).not.toMatch(/name:\s*["']is["']/);
    expect(result.code).toContain('is="farm-special"');
  });
  describe.each([false, true])("hydrate=%s", (hydrate) => {
    it.each(layouts)("preserves property updates in %s", async (layout) => {
      const source = `import {useState} from "react";
      export function Probe() {
        const [active,setActive]=useState(false);
        const [visible,setVisible]=useState(true);
        const [items,setItems]=useState([{id:1}]);
        return <main><button id="toggle" onClick={()=>setActive(value=>!value)}>Toggle</button>
        <button id="visibility" onClick={()=>setVisible(value=>!value)}>Visibility</button>${layout}</main>;
      }`;
      const result = await loadCompiledAndOriginal(source, reactivity);
      const histories: unknown[][] = [];
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
        const target = container.querySelector("#target") as HTMLElement & { counter: unknown };
        const history: unknown[] = [];
        for (let step = 0; step < 4; step++) {
          history.push(target.counter);
          if (step < 3)
            await act(async () => container.querySelector<HTMLButtonElement>("#toggle")!.click());
          expect(container.querySelector("#target")).toBe(target);
        }
        await act(async () => container.querySelector<HTMLButtonElement>("#visibility")!.click());
        await act(async () => container.querySelector<HTMLButtonElement>("#visibility")!.click());
        history.push(
          (container.querySelector("#target") as HTMLElement & { counter: unknown }).counter,
        );
        histories.push(history);
      }
      expect(histories[0]).toEqual([hydrate ? 0 : 1, 2, 1, 2, 2]);
      expect(histories[1]).toEqual(histories[0]);
      expect(errors).toEqual([]);
    });
  });

  it("keeps native attributes compiled", async () => {
    const result = await loadCompiledAndOriginal(
      `import {useState} from "react";
      export function Probe(){const [active,setActive]=useState(false);return <main><button onClick={()=>setActive(value=>!value)}>Toggle</button><div data-count={active?2:1}/></main>;}`,
      reactivity,
    );
    expect(result.names).toEqual(["Probe"]);
  });
});
