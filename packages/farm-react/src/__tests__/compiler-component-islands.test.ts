// @vitest-environment node

import { describe, expect, it } from "vitest";
import { transformWithEsbuild } from "vite";
import { compileReactModule } from "../compiler";
import { normalizeReactCompilerOptions } from "../index";

const infer = normalizeReactCompilerOptions(true);

async function compile(source: string) {
  return compileReactModule(source, "/app/ComponentIslands.tsx", infer);
}

describe("React AOT component island compiler", () => {
  it("isolates a state-dependent imported component and emits stable DOM targets", async () => {
    const result = await compile(`
      import { useState } from "react";
      import { Chart } from "./chart";
      import { Header } from "./header";

      export function Dashboard() {
        const [count, setCount] = useState(0);
        return (
          <main data-count={count}>
            <Header title="Dashboard" />
            <button onClick={() => setCount((value) => value + 1)}>Count: {count}</button>
            <Chart value={count} />
          </main>
        );
      }
    `);

    expect(result.compiled).toEqual(["Dashboard"]);
    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain("farmBlocks.Component");
    expect(result.code).toContain("farmBlocks.target(");
    expect(result.code).toContain('kind: "block"');
    expect(result.code).toContain("target:");
    expect(result.code.match(/farmBlocks\.Component/g)).toHaveLength(1);
    await expect(
      transformWithEsbuild(result.code, "/app/ComponentIslands.tsx", {
        loader: "tsx",
        jsx: "automatic",
      }),
    ).resolves.toMatchObject({
      code: expect.stringContaining("farmBlocks.Component"),
    });
  });

  it("keeps state-independent components as ordinary React children", async () => {
    const result = await compile(`
      import { useState } from "react";
      import { Header } from "./header";
      export function Dashboard() {
        const [count, setCount] = useState(0);
        return (
          <main>
            <Header title="Dashboard" />
            <button onClick={() => setCount(count + 1)}>{count}</button>
          </main>
        );
      }
    `);

    expect(result.compiled).toEqual(["Dashboard"]);
    expect(result.code).toContain('<Header title="Dashboard"');
    expect(result.code).not.toContain("farmBlocks.Component");
  });

  it("tracks multiple state dependencies and component event handlers", async () => {
    const result = await compile(`
      import { useState } from "react";
      import { Editor } from "./editor";
      export function Form() {
        const [value, setValue] = useState("");
        const [valid, setValid] = useState(false);
        return (
          <form>
            <Editor
              value={value}
              valid={valid}
              onChange={(next) => {
                setValue(next);
                setValid(Boolean(next));
              }}
            />
          </form>
        );
      }
    `);

    expect(result.compiled).toEqual(["Form"]);
    expect(result.code).toContain("dependencies: [0, 1]");
    expect(result.code).toContain("farmState[0].set");
    expect(result.code).toContain("farmState[1].set");
  });

  it("assigns unique ids across conditional, keyed, and component boundaries", async () => {
    const result = await compile(`
      import { useState } from "react";
      import { Chart } from "./chart";
      export function Dashboard() {
        const [visible, setVisible] = useState(true);
        const [items, setItems] = useState([{ id: "a", label: "A" }]);
        return (
          <main>
            <button onClick={() => setVisible(!visible)}>Toggle</button>
            <button onClick={() => setItems([...items].reverse())}>Reverse</button>
            <div>{visible && <p>Visible</p>}</div>
            <ul>{items.map((item) => <li key={item.id}>{item.label}</li>)}</ul>
            <Chart visible={visible} />
          </main>
        );
      }
    `);

    expect(result.compiled).toEqual(["Dashboard"]);
    expect(result.code).toContain("farmBlocks.Conditional");
    expect(result.code).toContain("farmBlocks.KeyedList");
    expect(result.code).toContain("farmBlocks.Component");
    expect(result.code).toContain("id={0}");
    expect(result.code).toContain("id={1}");
    expect(result.code).toContain("id={2}");
  });

  it.each([
    {
      name: "a component supplied through props",
      declaration: "",
      parameter: "{ Component }",
      child: "<Component value={count} />",
      reason: /stable module-level component/i,
    },
    {
      name: "a member-expression component",
      declaration: 'import * as UI from "./ui";',
      parameter: "",
      child: "<UI.Chart value={count} />",
      reason: /direct component identifier/i,
    },
    {
      name: "a mutable module component binding",
      declaration: "let Chart = () => <span />;",
      parameter: "",
      child: "<Chart value={count} />",
      reason: /stable module-level component/i,
    },
    {
      name: "spread props",
      declaration: 'import { Chart } from "./chart";',
      parameter: "props",
      child: "<Chart {...props} value={count} />",
      reason: /attribute spreads/i,
    },
    {
      name: "a component ref",
      declaration: 'import { Chart } from "./chart";',
      parameter: "props",
      child: "<Chart ref={props.chartRef} value={count} />",
      reason: /does not support ref/i,
    },
    {
      name: "component children",
      declaration: 'import { Chart } from "./chart";',
      parameter: "",
      child: "<Chart value={count}>Content</Chart>",
      reason: /does not support children/i,
    },
    {
      name: "an object literal prop",
      declaration: 'import { Chart } from "./chart";',
      parameter: "",
      child: "<Chart value={count} options={{ animated: true }} />",
      reason: /object literals/i,
    },
  ])("falls back safely for $name", async ({ declaration, parameter, child, reason }) => {
    const result = await compile(`
      import { useState } from "react";
      ${declaration}
      export function Unsupported(${parameter}) {
        const [count, setCount] = useState(0);
        return <main onClick={() => setCount(count + 1)}>${child}</main>;
      }
    `);

    expect(result.compiled).toEqual([]);
    expect(result.diagnostics.find((entry) => entry.component === "Unsupported")?.reason).toMatch(
      reason,
    );
  });
});
