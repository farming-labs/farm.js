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
    expect(result.code).toContain("createCompiledComponentWithFeatures");
    expect(result.code).toMatch(/_createCompiledComponent\([\s\S]+, \[\]\)/);
    expect(result.code).not.toContain("conditionalRuntimeFeature");
    expect(result.code).not.toContain("keyedRowsRuntimeFeature");
    expect(result.code).not.toContain("componentRuntimeFeature");
    expect(result.code).toContain('reactivity: "hybrid"');
    expect(result.code).not.toContain('tracking: "dynamic"');
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

  it("emits the configured static scheduler into compiled definitions", async () => {
    const result = await compileReactModule(
      `
        import { useState } from "react";
        export function StaticCounter() {
          const [count, setCount] = useState(0);
          return <button onClick={() => setCount(count + 1)}>{count}</button>;
        }
      `,
      "/app/StaticCounter.tsx",
      normalizeReactCompilerOptions({ reactivity: "static" }),
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain('reactivity: "static"');
  });

  it("marks only multi-state short-circuit readers for dynamic tracking", async () => {
    const result = await compileReactModule(
      `
        import { useState } from "react";
        export function BranchValue() {
          const [enabled, setEnabled] = useState(true);
          const [active, setActive] = useState("active");
          const [inactive, setInactive] = useState("inactive");
          return <button onClick={() => setEnabled(!enabled)}>{enabled ? active : inactive}</button>;
        }
      `,
      "/app/BranchValue.tsx",
      infer,
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain('tracking: "dynamic"');
    expect(result.code).toContain("dependencies: [0, 1, 2]");
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

  it("adds flat render props to the compiled dependency graph", async () => {
    const result = await compileReactModule(
      `
        import { useState } from "react";
        export function PropCounter({
          initial = 1,
          label: title,
          multiplier,
          active,
        }: {
          initial?: number;
          label: string;
          multiplier: number;
          active: boolean;
        }) {
          const [count, setCount] = useState(initial);
          const total = count * multiplier;
          return (
            <button
              className={active ? "active" : "idle"}
              onClick={() => setCount((value) => value + 1)}
            >{title}: {total}</button>
          );
        }
      `,
      "/app/PropCounter.tsx",
      infer,
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain("readProps:");
    expect(result.code).toContain('stateSignature: "1:title,multiplier,active"');
    expect(result.code).toMatch(
      /readProps: _props => \[_props\.title, _props\.multiplier, _props\.active\]/,
    );
    expect(result.code).toContain("dependencies: [0, 1, 2]");
    expect(result.code).toContain("dependencies: [3]");
    expect(result.code).toMatch(/farmState\[1\]\.get/);
    expect(result.code).toMatch(/farmState\[2\]\.get/);
    expect(result.code).toMatch(/farmState\[3\]\.get/);
    expect(result.code).not.toMatch(/readProps: props => \[[^\]]*props\.initial/);
  });

  it("keeps children and identifier props on React's normal prop path", async () => {
    const [childrenResult, identifierResult] = await Promise.all([
      compileReactModule(
        `
          import { useState } from "react";
          export function ChildBoundary({ children }: { children: React.ReactNode }) {
            const [active, setActive] = useState(false);
            return <button onClick={() => setActive(!active)}>{active ? children : "empty"}</button>;
          }
        `,
        "/app/ChildBoundary.tsx",
        infer,
      ),
      compileReactModule(
        `
          import { useState } from "react";
          export function IdentifierProps(props: { label: string }) {
            const [count, setCount] = useState(0);
            return <button onClick={() => setCount(count + 1)}>{props.label}: {count}</button>;
          }
        `,
        "/app/IdentifierProps.tsx",
        infer,
      ),
    ]);

    expect(childrenResult.diagnostics).toEqual([]);
    expect(identifierResult.diagnostics).toEqual([]);
    expect(childrenResult.code).not.toContain("readProps:");
    expect(identifierResult.code).not.toContain("readProps:");
  });

  it("keeps the existing compiled component when a prop-cell shape is not yet supported", async () => {
    const result = await compileReactModule(
      `
        import { useState } from "react";
        export function ControlledLabel({ label = "Name" }: { label?: string }) {
          const [value, setValue] = useState("");
          return (
            <label>
              {label}
              <input value={value} onInput={(event) => setValue(event.currentTarget.value)} />
            </label>
          );
        }
      `,
      "/app/ControlledLabel.tsx",
      infer,
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.compiled).toEqual(["ControlledLabel"]);
    expect(result.code).not.toContain("readProps:");
    expect(result.code).toContain("_props.label");
    expect(result.code).toMatch(/dependencies: \[0\]/);
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

  it("compiles a host-only conditional child block", async () => {
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

    expect(result.diagnostics).toEqual([]);
    expect(result.compiled).toEqual(["MaybeDetails"]);
    expect(result.code).toContain("farmBlocks.Conditional");
    expect(result.code).toContain('kind: "block"');
    expect(result.code).toContain("dependencies: [0]");
    await expect(
      transformWithEsbuild(result.code, "/app/MaybeDetails.tsx", {
        loader: "tsx",
        jsx: "automatic",
      }),
    ).resolves.toMatchObject({
      code: expect.stringContaining("farmBlocks.Conditional"),
    });
  });
});
