// @vitest-environment node

import { describe, expect, it } from "vitest";
import { compileReactModule } from "../compiler";
import { normalizeReactCompilerOptions } from "../index";

describe.each(["static", "hybrid"] as const)("%s shadowed binding safety", (reactivity) => {
  it.each([
    [
      "state initializer",
      "const [NaN, setNaN] = useState(1); const [count, setCount] = useState(NaN);",
      /initializers cannot reference/,
    ],
    [
      "derived initializer",
      "const Math = 1; const [count, setCount] = useState(Math);",
      /initializers cannot reference/,
    ],
    [
      "setter initializer",
      "const [value, Map] = useState(1); const [count, setCount] = useState(() => Map);",
      /initializers cannot reference/,
    ],
    [
      "forward state read",
      "const count = NaN; const [NaN, setCount] = useState(1);",
      /reads a useState declared after/,
    ],
    [
      "forward derived read",
      "const Math = Infinity; const Infinity = 1; const [count, setCount] = useState(0);",
      /earlier derived local values/,
    ],
    [
      "escaping setter",
      "const [count, Map] = useState(0); const setCount = () => count;",
      /must be called inside a JSX event/,
    ],
  ])("falls back for a %s just as for ordinary local names", async (name, declarations, reason) => {
    const source = `import { useState } from "react";
      export function Counter() {
        ${declarations}
        return <button onClick={${name === "escaping setter" ? "Map" : "() => setCount(1)"}}>{count}</button>;
      }`;
    const result = await compileReactModule(
      source,
      "/app/Shadowed.tsx",
      normalizeReactCompilerOptions({ reactivity }),
    );
    expect(result.compiled).toEqual([]);
    expect(result.diagnostics[0]?.reason).toMatch(reason);
    // Babel may reformat a fallback module, but must leave its behavior intact.
    expect(result.code.replace(/\s+/g, "")).toBe(source.replace(/\s+/g, ""));
  });

  it("keeps keyed identity and map update hints for global-named bindings", async () => {
    const result = await compileReactModule(
      `
      import { useState } from "react";
      export function Rows() {
        const [Date, parseInt] = useState([{ id: "a", value: 0 }]);
        const [NaN, setSelected] = useState("a");
        return <section>
          <button onClick={() => parseInt(rows => rows.map(row => row.id === "a" ? { ...row, value: row.value + 1 } : row))}>Update</button>
          <ul>{Date.map(Math => <li key={Math.id} data-active={NaN === Math.id}>{Math.value}</li>)}</ul>
        </section>;
      }
    `,
      "/app/Shadowed.tsx",
      normalizeReactCompilerOptions({ reactivity }),
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.compiled).toEqual(["Rows"]);
    expect(result.optimizations.keyedIdentityTargets).toBe(1);
    expect(result.optimizations.keyedMapUpdateHints).toBe(1);
  });
});
