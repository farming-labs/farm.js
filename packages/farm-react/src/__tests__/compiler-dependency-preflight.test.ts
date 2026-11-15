// @vitest-environment node

import { describe, expect, it } from "vitest";
import { compileReactModule } from "../compiler";
import { normalizeReactCompilerOptions } from "../index";

describe.each(["static", "hybrid"] as const)("dependency preflight (%s)", (reactivity) => {
  const compile = (body: string) =>
    compileReactModule(
      `import { useState } from "react";
       export function Counter() { ${body} }`,
      "/app/Counter.tsx",
      normalizeReactCompilerOptions({ reactivity }),
    );

  it("keeps constant expressions alongside reactive text and event handlers", async () => {
    const result = await compile(`
      const [count, setCount] = useState(0);
      return <button title={"ready"} data-static={2 + 3}
        onClick={() => setCount(value => value + 1)}>{count}</button>;
    `);
    expect(result.compiled).toEqual(["Counter"]);
    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain("dependencies: [0]");
    expect(result.code).toMatch(/farmState\[0\]\.get\(\)/);
    expect(result.code).toMatch(/farmState\[0\]\.set\(/);
    expect(result.code).toContain('title={"ready"}');
  });

  it("keeps Unicode identifiers and sorted multi-state dependencies", async () => {
    const result = await compile(`
      const [count, setCount] = useState(0);
      const [数, set数] = useState(1);
      return <button onClick={() => set数(数 + count)}>{数 + count}</button>;
    `);
    expect(result.compiled).toEqual(["Counter"]);
    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain("dependencies: [0, 1]");
    expect(result.code).toMatch(/farmState\[1\]\.get\(\)/);
  });

  it("still resolves shadowed callback parameters through full scope analysis", async () => {
    const result = await compile(`
      const [count, setCount] = useState(0);
      return <button onClick={() => setCount(count => count + 1)}>{count}</button>;
    `);
    expect(result.compiled).toEqual(["Counter"]);
    expect(result.diagnostics).toEqual([]);
    expect(result.code).toMatch(/\.set\(count => count \+ 1\)/);
    expect(result.code).toContain("dependencies: [0]");
  });

  it("does not treat matching object property names as free state references", async () => {
    const result = await compile(`
      const [count, setCount] = useState(0);
      return <button onClick={() => setCount(({count: 3}).count)}>{count}</button>;
    `);
    expect(result.compiled).toEqual(["Counter"]);
    expect(result.diagnostics).toEqual([]);
    expect(result.code).toMatch(/count: 3/);
    expect(result.code).not.toMatch(/count: _farmState/);
  });

  it("preserves unsupported-call fallback even without any reactive name in the call", async () => {
    const result = await compile(`
      const [count, setCount] = useState(0);
      return <button onClick={() => setCount(count + 1)}>{Date.now()}</button>;
    `);
    expect(result.compiled).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].reason).toBe(
      "dynamic child structures require React reconciliation",
    );
  });
});
