// @vitest-environment node

import { describe, expect, it } from "vitest";
import { transformWithEsbuild } from "vite";
import { compileReactModule } from "../compiler";
import { normalizeReactCompilerOptions } from "../index";

const infer = normalizeReactCompilerOptions(true);

async function compile(source: string) {
  return compileReactModule(source, "/app/ConditionalRanges.tsx", infer);
}

describe("React AOT conditional-range compiler", () => {
  it("compiles multiple root conditions between static host siblings", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function Dashboard() {
        const [loading, setLoading] = useState(false);
        const [enabled, setEnabled] = useState(true);
        return (
          <main data-active={loading || enabled}>
            <header className={enabled ? "enabled" : "disabled"}>
              Dashboard: {enabled ? "on" : "off"}
            </header>
            {loading && <p data-state={loading ? "loading" : "idle"}>Loading…</p>}
            <section>Content</section>
            {enabled ? <strong>Enabled</strong> : <span>Disabled</span>}
            <footer style={{ opacity: loading ? 0.5 : 1 }}>Footer</footer>
          </main>
        );
      }
    `);

    expect(result.diagnostics).toEqual([]);
    expect(result.compiled).toEqual(["Dashboard"]);
    expect(result.code).toContain("conditionalRangesRuntimeFeature");
    expect(result.code).not.toContain("keyedRangesRuntimeFeature");
    expect(result.code.match(/farmBlocks\.ConditionalRanges/g)).toHaveLength(1);
    expect(result.code.match(/farmBlocks\.Conditional(?!Ranges)/g)).toBeNull();
    expect(result.code.match(/before: 1/g)).toHaveLength(2);
    expect(result.code).toContain("trailing={1}");
    expect(result.code).toContain("dependencies: [0, 1]");
    expect(result.code).toContain("segment: 0");
    expect(result.code).toContain("segment: 2");
    expect(result.code).toContain('name: "className"');
    expect(result.code).toContain('name: "opacity"');
    expect(result.code).toContain('name: "data-state"');
    expect(result.code).toContain('name: "data-active"');
    await expect(
      transformWithEsbuild(result.code, "/app/ConditionalRanges.tsx", {
        loader: "tsx",
        jsx: "automatic",
      }),
    ).resolves.toMatchObject({
      code: expect.stringContaining("farmBlocks.ConditionalRanges"),
    });
  });

  it("supports one conditional as the only child of the returned host root", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function RootSlot() {
        const [visible, setVisible] = useState(false);
        return <section>{visible && <p>Visible</p>}</section>;
      }
    `);

    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain("farmBlocks.ConditionalRanges");
    expect(result.code).toContain("before: 0");
    expect(result.code).toContain("trailing={0}");
    expect(result.code).not.toContain("farmBlocks.HostConditional");
  });

  it("compiles a nested mixed container while retaining outer bindings", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function NestedStatus() {
        const [visible, setVisible] = useState(false);
        const [count, setCount] = useState(0);
        return (
          <main>
            <div data-visible={visible}>
              <h2>Count {count}</h2>
              {visible ? <strong data-count={count}>Visible {count}</strong> : null}
              <p>Stable {count}</p>
            </div>
            <output>{count}</output>
          </main>
        );
      }
    `);

    expect(result.diagnostics).toEqual([]);
    expect(result.code.match(/farmBlocks\.ConditionalRanges/g)).toHaveLength(1);
    expect(result.code).toContain('name: "data-visible"');
    expect(result.code).toContain('name: "data-count"');
    expect(result.code.match(/\.target\(/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it("keeps interactive branches on the React-owned conditional path", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function InteractiveStatus() {
        const [visible, setVisible] = useState(false);
        return (
          <main>
            <header>Status</header>
            {visible ? <button onClick={() => setVisible(false)}>Close</button> : null}
            <footer>Footer</footer>
          </main>
        );
      }
    `);

    expect(result.diagnostics).toEqual([]);
    expect(result.code).not.toContain("farmBlocks.ConditionalRanges");
    expect(result.code.match(/farmBlocks\.Conditional(?!Ranges)/g)).toHaveLength(1);
  });

  it("does not let a root range swallow a static sibling containing another block", async () => {
    const result = await compile(`
      import { useState } from "react";
      export function NestedComposition() {
        const [visible, setVisible] = useState(false);
        const [enabled, setEnabled] = useState(false);
        return (
          <section>
            <div>
              <h2>Status</h2>
              {visible && <i>Visible</i>}
            </div>
            {enabled && <p>Enabled</p>}
          </section>
        );
      }
    `);

    expect(result.diagnostics).toEqual([]);
    expect(result.code.match(/farmBlocks\.ConditionalRanges/g)).toHaveLength(1);
    expect(result.code.match(/farmBlocks\.Conditional(?!Ranges)/g)).toHaveLength(1);
    expect(result.code).toContain("dependencies: [0]");
    expect(result.code).toContain("dependencies: [1]");
  });
});
