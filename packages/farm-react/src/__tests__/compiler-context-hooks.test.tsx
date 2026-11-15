import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createCompiledRoot, type CompiledRoot } from "../compiled-root";
import { compileReactModule } from "../compiler";
import { normalizeReactCompilerOptions } from "../index";
import {
  loadCompiledAndOriginal,
  normalizedDom,
  removeCompiledModules,
} from "./compiled-module-harness";

// A compiled component reads context through its wrapper, which runs the useContext declaration
// as written, so React resolves the provider and the bound names reach the component as props.

declare global {
  var __farmRenderPlans: Record<string, number> | undefined;
}

const reactRoots = new Set<Root>();
const compiledRoots = new Set<CompiledRoot>();
beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(async () => {
  await act(async () => {
    for (const root of reactRoots) root.unmount();
    for (const root of compiledRoots) root.unmount();
  });
  reactRoots.clear();
  compiledRoots.clear();
  globalThis.__farmRenderPlans = undefined;
  document.body.replaceChildren();
});
afterAll(removeCompiledModules);

const source = `import { createContext, useContext, useState } from "react";
export const Theme = createContext({ tone: "light" });
export const Label = createContext("count");
export function Counter({ step = 1 }) {
  const { tone, size = 2 } = useContext(Theme);
  const label = useContext(Label);
  const [count, setCount] = useState(0);
  return (
    <section className={tone} data-size={size}>
      <button id="add" onClick={() => setCount(count + step)}>add</button>
      <output>{label}: {count}</output>
    </section>
  );
}
export function Card() {
  const theme = useContext(Theme);
  const [open, setOpen] = useState(false);
  return (
    <article className={theme.tone} data-open={String(open)}>
      <button id="toggle" onClick={() => setOpen(!open)}>toggle</button>
    </article>
  );
}`;

/** Counts each compiled component's render-plan runs by name; a patched update runs none. */
const countRenderPlans = (code: string) =>
  code.replace(
    /const (\w+) = import\.meta\.hot \? \w+ : (\w+);/,
    (_, create: string, production: string) =>
      `const ${create} = (definition, features) => ${production}({ ...definition, render: (...args) => { const plans = (globalThis.__farmRenderPlans ??= {}); plans[definition.displayName] = (plans[definition.displayName] ?? 0) + 1; return definition.render(...args); } }, features);`,
  );
const renderPlans = (name: string) => globalThis.__farmRenderPlans?.[name] ?? 0;

type Module = Record<string, React.ComponentType<Record<string, unknown>>>;
type Context<T> = React.Context<T>;

function mountApp(host: HTMLElement, module: Module) {
  const Theme = module.Theme as unknown as Context<{ tone: string; size?: number }>;
  const Label = module.Label as unknown as Context<string>;
  const Counter = module.Counter!;
  const Card = module.Card!;
  const controls: {
    setTone?: (tone: string) => void;
    setLabel?: (label: string) => void;
  } = {};
  function App() {
    const [tone, setTone] = useState("light");
    const [label, setLabel] = useState("count");
    controls.setTone = setTone;
    controls.setLabel = setLabel;
    return (
      <Theme.Provider value={{ tone }}>
        <Label.Provider value={label}>
          <Counter step={2} />
          <Card />
        </Label.Provider>
      </Theme.Provider>
    );
  }
  const root = createRoot(host);
  reactRoots.add(root);
  root.render(<App />);
  return controls;
}

describe("useContext in compiled components", () => {
  it("compiles components that read context and follows provider changes like React", async () => {
    const { compiled, original, names, code } = await loadCompiledAndOriginal(
      source,
      "hybrid",
      countRenderPlans,
    );
    expect(names).toEqual(["Counter", "Card"]);
    // React resolves the provider in the wrapper; the compiled component reads the names as props.
    expect(code).toMatch(/const \{\s*tone,\s*size = 2\s*\} = useContext\(Theme\);/);
    expect(code).toMatch(/readProps: \w+ => \[\w+\.step, \w+\.tone, \w+\.size, \w+\.label\]/);

    const reference = document.createElement("div");
    const subject = document.createElement("div");
    document.body.append(reference, subject);
    let referenceControls!: ReturnType<typeof mountApp>;
    let subjectControls!: ReturnType<typeof mountApp>;
    await act(async () => {
      referenceControls = mountApp(reference, original);
      subjectControls = mountApp(subject, compiled);
    });
    expect(normalizedDom(subject)).toBe(normalizedDom(reference));
    const output = subject.querySelector("output")!;

    const steps: Array<
      [string, (controls: ReturnType<typeof mountApp>, host: HTMLElement) => void]
    > = [
      ["click", (_, host) => host.querySelector<HTMLElement>("#add")!.click()],
      ["tone", (controls) => controls.setTone!("dark")],
      ["label", (controls) => controls.setLabel!("total")],
      ["toggle", (_, host) => host.querySelector<HTMLElement>("#toggle")!.click()],
      ["click again", (_, host) => host.querySelector<HTMLElement>("#add")!.click()],
      ["tone back", (controls) => controls.setTone!("light")],
    ];
    for (const [name, step] of steps) {
      await act(async () => {
        step(referenceControls, reference);
        step(subjectControls, subject);
      });
      expect(normalizedDom(subject), name).toBe(normalizedDom(reference));
    }
    expect(subject.querySelector("section")!.className).toBe("light");
    expect(subject.querySelector("output")!.textContent).toBe("total: 4");
    expect(subject.querySelector("article")!.getAttribute("data-open")).toBe("true");
    // The compiled output kept its nodes: updates patched them in place.
    expect(subject.querySelector("output")).toBe(output);
  });

  it("patches a primitive context change without rerunning the render plan", async () => {
    const { compiled } = await loadCompiledAndOriginal(source, "hybrid", countRenderPlans);
    const host = document.createElement("div");
    document.body.append(host);
    let controls!: ReturnType<typeof mountApp>;
    await act(async () => {
      controls = mountApp(host, compiled);
    });
    expect(renderPlans("Counter")).toBe(1);
    const cardPlans = renderPlans("Card");

    // Counter reads only primitives from context, so its bindings patch the DOM. Card holds the
    // whole theme object, an identity-bearing prop, which renders through React when it changes.
    await act(async () => controls.setLabel!("total"));
    expect(host.querySelector("output")!.textContent).toBe("total: 0");
    await act(async () => controls.setTone!("dark"));
    expect(host.querySelector("section")!.className).toBe("dark");
    expect(host.querySelector("article")!.className).toBe("dark");
    await act(async () => host.querySelector<HTMLElement>("#add")!.click());
    expect(host.querySelector("output")!.textContent).toBe("total: 2");
    expect(renderPlans("Counter")).toBe(1);
    expect(renderPlans("Card")).toBeGreaterThan(cardPlans);
  });

  it("reads a context's default value without a provider, as React does", async () => {
    const { compiled, original } = await loadCompiledAndOriginal(source);
    const reference = document.createElement("div");
    const subject = document.createElement("div");
    document.body.append(reference, subject);
    await act(async () => {
      for (const [host, module] of [
        [reference, original],
        [subject, compiled],
      ] as const) {
        const root = createRoot(host);
        reactRoots.add(root);
        root.render(<module.Counter />);
      }
    });
    expect(subject.querySelector("output")!.textContent).toBe("count: 0");
    expect(subject.querySelector("section")!.getAttribute("data-size")).toBe("2");
    expect(normalizedDom(subject)).toBe(normalizedDom(reference));
  });

  it("hands a root without React DOM to React DOM, which reads the provider", async () => {
    const { compiled, original } = await loadCompiledAndOriginal(source);
    const Theme = compiled.Theme as unknown as Context<{ tone: string }>;
    const OriginalTheme = original.Theme as unknown as Context<{ tone: string }>;
    const reference = document.createElement("div");
    const subject = document.createElement("div");
    document.body.append(reference, subject);
    const fallbacks: string[] = [];
    await act(async () => {
      const root = createRoot(reference);
      reactRoots.add(root);
      root.render(
        <OriginalTheme.Provider value={{ tone: "dark" }}>
          <original.Counter />
        </OriginalTheme.Provider>,
      );
      const compiledRoot = createCompiledRoot(subject, {
        onFallback: (reason) => fallbacks.push(String(reason)),
      });
      compiledRoots.add(compiledRoot);
      compiledRoot.render(
        <Theme.Provider value={{ tone: "dark" }}>
          <compiled.Counter />
        </Theme.Provider>,
      );
    });
    await act(async () => subject.querySelector<HTMLElement>("#add")!.click());
    await act(async () => reference.querySelector<HTMLElement>("#add")!.click());
    expect(fallbacks.length).toBeGreaterThan(0);
    expect(subject.querySelector("section")!.className).toBe("dark");
    expect(normalizedDom(subject)).toBe(normalizedDom(reference));
  });

  it.each([
    {
      name: "a context from the component body",
      body: "const contexts = [Theme]; const theme = useContext(contexts[0]);",
    },
    {
      name: "a context named by a local",
      body: "const Local = Theme; const theme = useContext(Local);",
    },
    { name: "a computed context read", body: "const theme = useContext(Theme).tone;" },
    { name: "two arguments", body: "const theme = useContext(Theme, 1);" },
    { name: "a non-literal default", body: "const { tone = String(1) } = useContext(Theme);" },
    { name: "a computed key", body: 'const { ["tone"]: tone } = useContext(Theme);' },
    { name: "a props identifier", params: "props", body: "const theme = useContext(Theme);" },
  ])("keeps $name on React", async ({ body, params = "" }) => {
    const result = await compileReactModule(
      `import { createContext, useContext, useState } from "react";
      const Theme = createContext({ tone: "light" });
      export function Clicks(${params}) {
        ${body}
        const [count, setCount] = useState(0);
        return <button onClick={() => setCount(count + 1)}>{count}</button>;
      }`,
      "/app/Clicks.tsx",
      normalizeReactCompilerOptions(true),
    );
    expect(result.compiled).toEqual([]);
  });
});
