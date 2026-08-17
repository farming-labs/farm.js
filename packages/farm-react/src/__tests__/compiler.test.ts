// @vitest-environment node

import { describe, expect, it } from "vitest";
import { transformWithEsbuild } from "vite";
import { compileReactModule } from "../compiler";
import { normalizeReactCompilerOptions } from "../index";

const infer = normalizeReactCompilerOptions(true);

describe("React AOT compiler", () => {
  it("compiles a host-only state component without an annotation", async () => {
    const result = await compileReactModule(
      `
        import { useState } from "react";
        export function Counter(props: { initial: number }) {
          const [count, setCount] = useState(props.initial);
          return (
            <button
              className={count > 0 ? "active" : "idle"}
              onClick={() => setCount((value) => value + 1)}
            >Count: {count}</button>
          );
        }
      `,
      "/app/Counter.tsx",
      infer,
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.compiled).toEqual(["Counter"]);
    expect(result.code).toContain("@farm.js/react/compiler-runtime");
    expect(result.code).toContain("createCompiledComponent");
    expect(result.code).toContain('kind: "text"');
    expect(result.code).toContain('kind: "attribute"');
    expect(result.code).toContain("import.meta.hot");
    expect(result.code).toContain("/app/Counter.tsx#Counter");
    expect(result.code).toContain('stateSignature: "1"');
    expect(result.code).toMatch(/farmState\[0\]\.set/);
    expect(result.code).toMatch(/farmState\[0\]\.get/);
    await expect(
      transformWithEsbuild(result.code, "/app/Counter.tsx", {
        loader: "tsx",
        jsx: "automatic",
      }),
    ).resolves.toMatchObject({
      code: expect.stringContaining("createCompiledComponent"),
    });
  });

  it("compiles state-driven derived local values in source order", async () => {
    const result = await compileReactModule(
      `
        import { useState } from "react";
        export function DerivedCounter(props: { prefix: string }) {
          const [count, setCount] = useState(0);
          const doubled = count * 2;
          const label = \`\${props.prefix}: \${doubled}\`;
          const tone = count > 0 ? "active" : "idle";
          return (
            <button
              className={tone}
              data-count={doubled}
              onClick={() => setCount(doubled + 1)}
            >{label}</button>
          );
        }
      `,
      "/app/DerivedCounter.tsx",
      infer,
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.compiled).toEqual(["DerivedCounter"]);
    expect(result.code).not.toMatch(/const (doubled|label|tone)/);
    expect(result.code).toContain("dependencies: [0]");
    expect(result.code).toMatch(/farmState\[0\]\.get/);
    await expect(
      transformWithEsbuild(result.code, "/app/DerivedCounter.tsx", {
        loader: "tsx",
        jsx: "automatic",
      }),
    ).resolves.toMatchObject({
      code: expect.stringContaining("createCompiledComponent"),
    });
  });

  it("compiles destructured props and named synchronous event handlers", async () => {
    const result = await compileReactModule(
      `
        import { useState } from "react";
        interface CounterProps {
          initial?: number;
          label: string;
          onCommit(value: number): void;
        }
        export function CommonCounter({
          initial = 1,
          label: title,
          onCommit,
        }: CounterProps) {
          const [count, setCount] = useState(initial);
          const [active, setActive] = useState(false);
          const doubled = count * 2;
          const increment = () => {
            onCommit(doubled);
            setCount((value) => value + 1);
            setActive(!active);
          };
          return (
            <button
              className={active ? "active" : "idle"}
              data-count={doubled}
              onClick={increment}
            >{title}: {doubled}</button>
          );
        }
      `,
      "/app/CommonCounter.tsx",
      infer,
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.compiled).toEqual(["CommonCounter"]);
    expect(result.code).toContain("initial = 1");
    expect(result.code).toContain("label: title");
    expect(result.code).not.toContain("const increment");
    expect(result.code).toMatch(/props\.initial/);
    expect(result.code).toMatch(/props\.title/);
    expect(result.code).toMatch(/props\.onCommit/);
    expect(result.code).toMatch(/farmState\[0\]\.set/);
    expect(result.code).toMatch(/farmState\[1\]\.set/);
    await expect(
      transformWithEsbuild(result.code, "/app/CommonCounter.tsx", {
        loader: "tsx",
        jsx: "automatic",
      }),
    ).resolves.toMatchObject({
      code: expect.stringContaining("createCompiledComponent"),
    });
  });

  it("compiles a named function expression used directly as an event", async () => {
    const result = await compileReactModule(
      `
        import { useState } from "react";
        export const Toggle = ({ initial: start = false }) => {
          const [active, setActive] = useState(start);
          const toggle = function toggle() {
            setActive((value) => !value);
          };
          return <button aria-pressed={active} onClick={toggle}>{active ? "on" : "off"}</button>;
        };
      `,
      "/app/Toggle.tsx",
      infer,
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.compiled).toEqual(["Toggle"]);
    expect(result.code).not.toContain("const toggle");
    expect(result.code).toMatch(/props\.start/);
  });

  it("only compiles selected components in annotation mode", async () => {
    const result = await compileReactModule(
      `
        import { useState } from "react";
        export function Automatic() {
          const [count, setCount] = useState(0);
          return <button onClick={() => setCount(count + 1)}>{count}</button>;
        }
        export function Selected() {
          "use compiler";
          const [count, setCount] = useState(0);
          return <button onClick={() => setCount(count + 1)}>{count}</button>;
        }
      `,
      "/app/Counters.tsx",
      normalizeReactCompilerOptions({ mode: "annotation" }),
    );

    expect(result.compiled).toEqual(["Selected"]);
    expect(result.code).toContain("function Automatic()");
  });

  it("uses a custom annotation directive", async () => {
    const result = await compileReactModule(
      `
        "use optimize";
        import { useState } from "react";
        export function Counter() {
          const [count, setCount] = useState(0);
          return <button onClick={() => setCount(count + 1)}>{count}</button>;
        }
      `,
      "/app/Counter.tsx",
      normalizeReactCompilerOptions({
        mode: "annotation",
        directive: "use optimize",
      }),
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.compiled).toEqual(["Counter"]);
  });

  it("falls back to React for dynamic child structure", async () => {
    const result = await compileReactModule(
      `
        import { useState } from "react";
        export function MaybeDetails() {
          const [visible, setVisible] = useState(false);
          return <section onClick={() => setVisible(!visible)}>{visible && <p>Details</p>}</section>;
        }
      `,
      "/app/MaybeDetails.tsx",
      infer,
    );

    expect(result.compiled).toEqual([]);
    expect(result.diagnostics[0]?.reason).toMatch(/dynamic child structures/i);
    expect(result.code).not.toContain("compiler-runtime");
  });
});
