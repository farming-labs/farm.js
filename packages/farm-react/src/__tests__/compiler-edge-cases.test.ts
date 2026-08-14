// @vitest-environment node

import { describe, expect, it } from "vitest";
import { compileReactModule } from "../compiler";
import { normalizeReactCompilerOptions } from "../index";

const infer = normalizeReactCompilerOptions(true);

async function compile(source: string) {
  return compileReactModule(source, "/app/EdgeCase.tsx", infer);
}

describe("React AOT compiler safety boundaries", () => {
  it("compiles multiple state cells and batched functional updates", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function MultipleCells() {
        const [count, setCount] = useState(0);
        const [active, setActive] = useState(false);
        return (
          <section className={active ? "active" : "idle"}>
            <output>{count}</output>
            <button onClick={() => {
              setCount((value) => value + 1);
              setCount((value) => value + 1);
              setActive((value) => !value);
            }}>Update</button>
          </section>
        );
      }
    `);

    expect(result.diagnostics).toEqual([]);
    expect(result.compiled).toEqual(["MultipleCells"]);
    expect(result.code).toContain("dependencies: [0]");
    expect(result.code).toContain("dependencies: [1]");
  });

  it("falls back for an inline keyed list instead of stringifying React elements", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function KeyedList() {
        const [items, setItems] = useState(["A"]);
        return (
          <section>
            <button onClick={() => setItems((value) => [...value, "B"])}>Add</button>
            <ul>{items.map((item) => <li key={item}>{item}</li>)}</ul>
          </section>
        );
      }
    `);

    expect(result.compiled).toEqual([]);
    expect(result.diagnostics[0]?.reason).toMatch(/dynamic child structures/i);
    expect(result.code).not.toContain("compiler-runtime");
  });

  it("falls back when a stateful helper call could return a dynamic child tree", async () => {
    const result = await compile(`
      import { useState } from "react";
      function renderItems(items: string[]) {
        return items.map((item) => <li key={item}>{item}</li>);
      }
      export function KeyedList() {
        const [items, setItems] = useState(["A"]);
        return (
          <section onClick={() => setItems(["B"])}>
            <ul>{renderItems(items)}</ul>
          </section>
        );
      }
    `);

    expect(result.compiled).toEqual([]);
    expect(result.diagnostics[0]?.reason).toMatch(/dynamic child structures/i);
  });

  it("falls back when a state-independent helper could shift prepared DOM paths", async () => {
    const result = await compile(`
      import { useState } from "react";
      function renderPrefix() {
        return <span>Prefix</span>;
      }
      export function UnknownChild() {
        const [count, setCount] = useState(0);
        return (
          <section onClick={() => setCount(count + 1)}>
            <div>{renderPrefix()}</div>
            <output>{count}</output>
          </section>
        );
      }
    `);

    expect(result.compiled).toEqual([]);
    expect(result.diagnostics[0]?.reason).toMatch(/dynamic child structures/i);
  });

  it("falls back for hooks placed inside keyed list iteration", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function InvalidHookList() {
        const [items, setItems] = useState(["A"]);
        return (
          <ul onClick={() => setItems(["A", "B"])}>
            {items.map((item) => {
              const [selected, setSelected] = useState(false);
              return <li key={item} onClick={() => setSelected(!selected)}>{item}</li>;
            })}
          </ul>
        );
      }
    `);

    expect(result.compiled).toEqual([]);
    expect(result.diagnostics[0]?.reason).toMatch(/dynamic child structures/i);
  });

  it.each([
    {
      name: "stateful style",
      source: `
        import { useState } from "react";
        export function Styled() {
          const [wide, setWide] = useState(false);
          return <div style={{ width: wide ? 100 : 50 }} onClick={() => setWide(!wide)}>Box</div>;
        }
      `,
      reason: /stateful style/i,
    },
    {
      name: "ref ownership",
      source: `
        import { useRef, useState } from "react";
        export function Focusable() {
          const [value, setValue] = useState("");
          return <input ref={useRef(null)} value={value} onChange={(event) => setValue(event.target.value)} />;
        }
      `,
      reason: /ref requires React ownership/i,
    },
    {
      name: "custom child component",
      source: `
        import { useState } from "react";
        import { Label } from "./label";
        export function Parent() {
          const [count, setCount] = useState(0);
          return <div onClick={() => setCount(count + 1)}><Label value={count} /></div>;
        }
      `,
      reason: /host elements only/i,
    },
    {
      name: "effect lifecycle",
      source: `
        import { useEffect, useState } from "react";
        export function WithEffect() {
          const [count, setCount] = useState(0);
          useEffect(() => {}, [count]);
          return <button onClick={() => setCount(count + 1)}>{count}</button>;
        }
      `,
      reason: /top-level useState declarations/i,
    },
  ])("falls back for $name", async ({ source, reason }) => {
    const result = await compile(source);

    expect(result.compiled).toEqual([]);
    expect(result.diagnostics[0]?.reason).toMatch(reason);
  });

  it("honors the explicit opt-out without emitting a failure diagnostic", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function ReactOwned() {
        "use no compiler";
        const [count, setCount] = useState(0);
        return <button onClick={() => setCount(count + 1)}>{count}</button>;
      }
    `);

    expect(result.compiled).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
