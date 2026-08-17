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

  it("keeps a keyed parent on React while compiling its stable row component", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function List(props) {
        const [items, setItems] = useState(props.items);
        return <ul onClick={() => setItems([...items])}>{items.map((item) => <Row key={item.id} item={item} />)}</ul>;
      }
      export function Row(props) {
        const [selected, setSelected] = useState(false);
        return <li onClick={() => setSelected(!selected)}>{props.item.name}: {selected ? "yes" : "no"}</li>;
      }
    `);

    expect(result.compiled).toEqual(["Row"]);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        component: "List",
        reason: expect.stringMatching(/dynamic child structures/i),
      }),
    ]);
    expect(result.code).toContain("createCompiledComponent");
  });

  it("compiles object, array, and nullish state transitions", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function StructuredState() {
        const [record, setRecord] = useState({ count: 0 });
        const [items, setItems] = useState([1]);
        const [value, setValue] = useState(null);
        return (
          <section>
            <button onClick={() => setRecord((current) => ({ count: current.count + 1 }))}>Object</button>
            <button onClick={() => setItems((current) => [...current, 2])}>Array</button>
            <button onClick={() => setValue(value === null ? "ready" : null)}>Null</button>
            <output data-count={record.count} data-first={items[0]}>{value ?? "empty"}</output>
          </section>
        );
      }
    `);

    expect(result.diagnostics).toEqual([]);
    expect(result.compiled).toEqual(["StructuredState"]);
    expect(result.code).toContain("dependencies: [0]");
    expect(result.code).toContain("dependencies: [1]");
    expect(result.code).toContain("dependencies: [2]");
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

  it.each([
    {
      name: "an impure derived call",
      body: `
        const label = String(count);
        return <button onClick={() => setCount(count + 1)}>{label}</button>;
      `,
      reason: /derived local label cannot use function calls/i,
    },
    {
      name: "a forward derived reference",
      body: `
        const label = next;
        const next = count + 1;
        return <button onClick={() => setCount(count + 1)}>{label}</button>;
      `,
      reason: /can only reference earlier derived local values/i,
    },
    {
      name: "state declared after a derived value",
      body: `
        const seed = 0;
        const [next, setNext] = useState(seed);
        return <button onClick={() => setNext(next + 1)}>{count + next}</button>;
      `,
      reason: /useState declarations must appear before derived local values/i,
    },
  ])("falls back for $name", async ({ body, reason }) => {
    const result = await compile(`
      import { useState } from "react";
      export function DerivedBoundary() {
        const [count, setCount] = useState(0);
        ${body}
      }
    `);

    expect(result.compiled).toEqual([]);
    expect(result.diagnostics[0]?.reason).toMatch(reason);
  });

  it.each([
    {
      name: "nested props",
      parameter: "{ user: { name } }",
      reason: /nested component props destructuring/i,
    },
    {
      name: "rest props",
      parameter: "{ initial, ...rest }",
      reason: /rest properties in component props destructuring/i,
    },
    {
      name: "computed props",
      parameter: '{ ["initial"]: initial }',
      reason: /computed component props destructuring/i,
    },
    {
      name: "a defaulted props object",
      parameter: "{ initial } = { initial: 0 }",
      reason: /zero parameters, one props identifier, or flat object props destructuring/i,
    },
  ])("falls back for $name", async ({ parameter, reason }) => {
    const result = await compile(`
      import { useState } from "react";
      export function PropsBoundary(${parameter}) {
        const [count, setCount] = useState(initial ?? 0);
        return <button onClick={() => setCount(count + 1)}>{count}</button>;
      }
    `);

    expect(result.compiled).toEqual([]);
    expect(result.diagnostics[0]?.reason).toMatch(reason);
    expect(result.code).not.toContain("compiler-runtime");
  });

  it.each([
    {
      name: "an async handler",
      declaration: "const increment = async () => setCount(count + 1);",
      event: "increment",
      reason: /event handler increment must be synchronous/i,
    },
    {
      name: "a generator handler",
      declaration: "const increment = function* () { setCount(count + 1); };",
      event: "increment",
      reason: /event handler increment must be synchronous/i,
    },
    {
      name: "an indirectly invoked handler",
      declaration: "const increment = () => setCount(count + 1);",
      event: "() => increment()",
      reason: /must be passed directly to a JSX event/i,
    },
    {
      name: "a handler exposed as a child",
      declaration: "const increment = () => setCount(count + 1);",
      event: "increment",
      child: "{increment}",
      reason: /must be passed directly to a JSX event/i,
    },
    {
      name: "a handler that reads a later derived value",
      declaration: "const increment = () => setCount(next); const next = count + 1;",
      event: "increment",
      reason: /event handler increment can only reference earlier derived local values/i,
    },
  ])("falls back for $name", async ({ declaration, event, child = "{count}", reason }) => {
    const result = await compile(`
      import { useState } from "react";
      export function HandlerBoundary() {
        const [count, setCount] = useState(0);
        ${declaration}
        return <button onClick={${event}}>${child}</button>;
      }
    `);

    expect(result.compiled).toEqual([]);
    expect(result.diagnostics[0]?.reason).toMatch(reason);
    expect(result.code).not.toContain("compiler-runtime");
  });

  it("preserves handler parameter shadowing while rewriting destructured props", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function Shadowed({ value: label }) {
        const [value, setValue] = useState(0);
        const update = (label) => setValue(label.currentTarget.value.length);
        return <input aria-label={label} value={value} onInput={update} />;
      }
    `);

    expect(result.diagnostics).toEqual([]);
    expect(result.compiled).toEqual(["Shadowed"]);
    expect(result.code).toMatch(/props\.label/);
    expect(result.code).toContain("label.currentTarget.value.length");
    expect(result.code).not.toMatch(/props\.label\.currentTarget/);
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
