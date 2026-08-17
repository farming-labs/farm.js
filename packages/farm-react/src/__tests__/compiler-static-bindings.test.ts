// @vitest-environment node

import { describe, expect, it } from "vitest";
import { transformWithEsbuild } from "vite";
import { compileReactModule } from "../compiler";
import { normalizeReactCompilerOptions } from "../index";

const infer = normalizeReactCompilerOptions(true);

async function compile(source: string) {
  return compileReactModule(source, "/app/StaticBindings.tsx", infer);
}

describe("React AOT static binding coverage", () => {
  it("keeps state-independent render instrumentation on React's initial path", async () => {
    const result = await compile(`
      import { useState } from "react";
      let executions = 0;
      export function Instrumented() {
        const [count, setCount] = useState(0);
        return (
          <button onClick={() => setCount(count + 1)}>
            <span>{count}</span>
            <span>{typeof window === "undefined" ? 1 : ++executions}</span>
          </button>
        );
      }
    `);

    expect(result.diagnostics).toEqual([]);
    expect(result.compiled).toEqual(["Instrumented"]);
    expect(result.code).toContain("++executions");
  });

  it("compiles whitelisted calculations and individual style properties", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function Progress({ maximum = 12 }) {
        const [value, setValue] = useState(2);
        const [active, setActive] = useState(true);
        const percent = Math.min(100, Math.round((value / maximum) * 100));
        const label = String(percent);
        return (
          <button
            data-percent={Number(label)}
            onClick={() => {
              setValue((current) => current + 2);
              setActive((current) => !current);
            }}
            style={{
              opacity: active ? 1 : 0.55,
              width: label + "%",
              "--progress": label,
              color: "lime",
            }}
          >
            {label}%
          </button>
        );
      }
    `);

    expect(result.diagnostics).toEqual([]);
    expect(result.compiled).toEqual(["Progress"]);
    expect(result.code).toContain('kind: "style"');
    expect(result.code).toContain('name: "opacity"');
    expect(result.code).toContain('name: "width"');
    expect(result.code).toContain('name: "--progress"');
    expect(result.code).not.toContain('name: "color"');
    expect(result.code).toContain("Math.min");
    expect(result.code).toContain("Math.round");
    expect(result.code).toContain("String");
    await expect(
      transformWithEsbuild(result.code, "/app/StaticBindings.tsx", {
        loader: "tsx",
        jsx: "automatic",
      }),
    ).resolves.toMatchObject({
      code: expect.stringContaining("createCompiledComponent"),
    });
  });

  it("compiles function declarations and calls made inside inline JSX handlers", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function Stepper() {
        const [count, setCount] = useState(0);
        function increment(step: number) {
          setCount((value) => value + step);
        }
        return <button onClick={() => increment(2)}>{Math.max(0, count)}</button>;
      }
    `);

    expect(result.diagnostics).toEqual([]);
    expect(result.compiled).toEqual(["Stepper"]);
    expect(result.code).toContain("function increment");
    expect(result.code).toMatch(/farmState\[0\]\.set/);
    await expect(
      transformWithEsbuild(result.code, "/app/StaticBindings.tsx", {
        loader: "tsx",
        jsx: "automatic",
      }),
    ).resolves.toMatchObject({
      code: expect.stringContaining("function increment"),
    });
  });

  it.each([
    {
      name: "an application helper",
      expression: "formatCount(count)",
    },
    {
      name: "a nondeterministic Math call",
      expression: "Math.random() + count",
    },
    {
      name: "a prototype method call",
      expression: "String(count).toUpperCase()",
    },
  ])("falls back for $name", async ({ expression }) => {
    const result = await compile(`
      import { useState } from "react";
      export function UnsafeCall() {
        const [count, setCount] = useState(0);
        const label = ${expression};
        return <button onClick={() => setCount(count + 1)}>{label}</button>;
      }
    `);

    expect(result.compiled).toEqual([]);
    expect(result.diagnostics[0]?.reason).toMatch(/cannot use function calls/i);
  });

  it("does not treat a shadowed global name as a safe call", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function Shadowed({ String }) {
        const [count, setCount] = useState(0);
        const label = String(count);
        return <button onClick={() => setCount(count + 1)}>{label}</button>;
      }
    `);

    expect(result.compiled).toEqual([]);
    expect(result.diagnostics[0]?.reason).toMatch(/cannot use function calls/i);
  });

  it.each([
    {
      name: "a conditional style object",
      style: "active ? { opacity: 1 } : { opacity: 0.5 }",
      reason: /one inline object literal/i,
    },
    {
      name: "a style spread",
      style: "{ ...theme, opacity: active ? 1 : 0.5 }",
      reason: /do not support spreads/i,
    },
    {
      name: "an unsafe style calculation",
      style: "{ opacity: calculateOpacity(active) }",
      reason: /property opacity cannot use function calls/i,
    },
  ])("falls back for $name", async ({ style, reason }) => {
    const result = await compile(`
      import { useState } from "react";
      export function UnsafeStyle({ theme }) {
        const [active, setActive] = useState(false);
        return <button style={${style}} onClick={() => setActive(!active)}>Toggle</button>;
      }
    `);

    expect(result.compiled).toEqual([]);
    expect(result.diagnostics[0]?.reason).toMatch(reason);
  });

  it("does not execute a named handler while rendering an event prop", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function RenderCall() {
        const [count, setCount] = useState(0);
        const increment = () => setCount(count + 1);
        return <button onClick={increment()}>{count}</button>;
      }
    `);

    expect(result.compiled).toEqual([]);
    expect(result.diagnostics[0]?.reason).toMatch(/must be passed directly to a JSX event/i);
  });
});
