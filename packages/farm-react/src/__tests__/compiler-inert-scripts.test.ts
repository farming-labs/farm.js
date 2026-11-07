import { describe, expect, it } from "vitest";
import { compileReactModule } from "../compiler";
import { normalizeReactCompilerOptions } from "../index";

const scripts = [
  '<script>{"window.__sentinel++"}</script>',
  '<script type="module">{"window.__sentinel++"}</script>',
  '<script type="application/json">{"{}"}</script>',
  '<script src="/sentinel.js" nonce="probe" />',
];
const layouts = [
  (host: string) => `<section>{active && ${host}}</section>`,
  (host: string) => `<section>{active ? <div>${host}</div> : null}</section>`,
  (host: string) => `<section><span>before</span>{active && ${host}}<span>after</span></section>`,
  (host: string) =>
    `<section>{items.map(item => <div key={item.id}>${host}<span>{item.label}</span></div>)}</section>`,
  (host: string) =>
    `<section>{active && <div><section>{items.map(item => <div key={item.id}>${host}</div>)}</section></div>}</section>`,
  (host: string) =>
    `<section>{items.map(item => <div key={item.id}><section>{item.visible && ${host}}</section></div>)}</section>`,
];

describe.each(["static", "hybrid"] as const)("%s script ownership", (reactivity) => {
  for (const [index, layout] of layouts.entries()) {
    it.each(scripts)(`keeps layout ${index} %s out of host descriptors`, async (host) => {
      const result = await compileReactModule(
        `import {useState} from "react";
        export function Probe() {
          const [active, setActive] = useState(false);
          const [items, setItems] = useState([]);
          return <main><button onClick={() => {setActive(value => !value); setItems([{id: 1, label: "one", visible: true}]);}}>Toggle</button>${layout(host)}</main>;
        }`,
        "/app/Script.tsx",
        normalizeReactCompilerOptions({ reactivity }),
      );
      expect(result.code).not.toMatch(/tag:\s*["']script["']/);
      expect(result.code).toContain("<script");
    });
  }

  it("retains ordinary compiler-owned host insertions", async () => {
    const result = await compileReactModule(
      `import {useState} from "react";
      export function Probe() {
        const [active, setActive] = useState(false);
        return <main><button onClick={() => setActive(value => !value)}>Toggle</button><section>{active && <span>safe</span>}</section></main>;
      }`,
      "/app/Plain.tsx",
      normalizeReactCompilerOptions({ reactivity }),
    );
    expect(result.compiled).toEqual(["Probe"]);
    expect(result.code).toMatch(/tag:\s*["']span["']/);
  });
});
