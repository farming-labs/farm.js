// @vitest-environment node

import { describe, expect, it } from "vitest";
import { compileReactModule } from "../compiler";
import { normalizeReactCompilerOptions } from "../index";

const infer = normalizeReactCompilerOptions(true);

const compile = (usage: string, children: string, parentLocals = "") =>
  compileReactModule(
    `
      import { useState } from "react";
      export function App() {
        const [count, setCount] = useState(0);${parentLocals}
        return (
          <main>
            <button onClick={() => setCount(count + 1)}>Add</button>
            ${usage}
          </main>
        );
      }
      ${children}
    `,
    "/app/InlineChildren.tsx",
    infer,
  );

/** The compiled App template, without the original child definitions that stay in the module. */
const template = (code: string) => code.match(/render: \([^)]*\) => (<main>.*?<\/main>)/s)?.[1];

describe("React AOT inlining of hook-free child components", () => {
  it.each([
    [
      "a function child with props",
      `<Badge label={"Count " + count} tone={count % 2 ? "odd" : "even"} />`,
      `function Badge({ label, tone }) { return <span className={"badge " + tone}>{label}</span>; }`,
      '<span className={"badge " + (_farmState[0].get() % 2 ? "odd" : "even")}',
    ],
    [
      "an arrow child with a string prop",
      `<Title text="Hi" />`,
      `const Title = ({ text }) => <h1>{text}</h1>;`,
      '<h1>{"Hi"}</h1>',
    ],
    [
      "a child without props",
      `<Header />`,
      `function Header() { return <header>todos</header>; }`,
      "<header>todos</header>",
    ],
    [
      "a child that renders another child",
      `<Outer n={count} />`,
      `function Inner({ v }) { return <b>{v}</b>; }
       function Outer({ n }) { return <div><Inner v={n * 2} /></div>; }`,
      "<div><b",
    ],
    [
      "an event handler prop",
      `<Reset onReset={() => setCount(0)} />`,
      `function Reset({ onReset }) { return <button onClick={onReset}>Reset</button>; }`,
      "<button onClick={() =>",
    ],
  ])("inlines %s into the compiled template", async (_name, usage, children, expected) => {
    const result = await compile(usage, children);

    expect(result.diagnostics.filter((diagnostic) => diagnostic.component === "App")).toEqual([]);
    expect(result.compiled).toContain("App");
    const compiled = template(result.code);
    expect(compiled).toContain(expected);
    expect(compiled).not.toMatch(/<(Badge|Title|Header|Inner|Outer|Reset)\b/);
    expect(result.code).not.toContain("farmBlocks.Component");
  });

  it.each([
    [
      "a child that calls hooks",
      `<Ticker n={count} />`,
      `function Ticker({ n }) { const [x] = useState(n); return <i>{x}</i>; }`,
      "",
      "Ticker",
    ],
    [
      "a child with defaultProps",
      `<Badge label="x" />`,
      `function Badge({ label }) { return <span>{label}</span>; }
       Badge.defaultProps = { label: "d" };`,
      "",
      "Badge",
    ],
    [
      "a child whose free name the parent shadows",
      `<Label />`,
      `const unit = "px";
       function Label() { return <span>{unit}</span>; }`,
      "\n        const unit = 1;",
      "Label",
    ],
    [
      "a prop the child renders as a tag",
      `<Wrap Icon={Star} />`,
      `function Star() { return <svg />; }
       function Wrap({ Icon }) { return <div><Icon /></div>; }`,
      "",
      "Wrap",
    ],
    [
      "a key",
      `<Badge key="a" label="x" />`,
      `function Badge({ label }) { return <span>{label}</span>; }`,
      "",
      "Badge",
    ],
    [
      "a prop the child does not read and that has effects",
      `<Badge label="x" extra={track()} />`,
      `function Badge({ label }) { return <span>{label}</span>; }`,
      "",
      "Badge",
    ],
  ])("leaves %s as a component", async (_name, usage, children, parentLocals, tag) => {
    const result = await compile(usage, children, parentLocals);

    const compiled = result.compiled.includes("App") ? template(result.code) : result.code;
    expect(compiled).toMatch(new RegExp(`<${tag}\\b`));
  });

  it("leaves children with JSX children and attribute spreads to React", async () => {
    for (const usage of [`<Box><p>hi</p></Box>`, `<Box {...{ title: "x" }} />`]) {
      const result = await compile(
        usage,
        `function Box({ title }) { return <div title={title}>box</div>; }`,
      );
      // Only Box's own definition renders the div; the usage was not inlined.
      expect(result.code.match(/<div title=/g) ?? []).toHaveLength(1);
    }
  });
});
