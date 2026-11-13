import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { compileReactModule } from "../compiler";
import { normalizeReactCompilerOptions } from "../index";
import {
  loadCompiledAndOriginal,
  normalizedDom,
  removeCompiledModules,
} from "./compiled-module-harness";

// Memoization is a performance hint: with a complete dependency list, useMemo's value equals its
// expression and useCallback's function equals its callback, so a compiled component reads them
// in place. A shorter list keeps a stale value on purpose, so such components stay on React.

const roots = new Set<Root>();
beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(async () => {
  await act(async () => {
    for (const root of roots) root.unmount();
  });
  roots.clear();
  document.body.replaceChildren();
});
afterAll(removeCompiledModules);

const click =
  (selector: string) =>
  (host: HTMLElement): void =>
    host.querySelector<HTMLElement>(selector)!.click();

async function expectParity(
  source: string,
  name: string,
  steps: readonly ((host: HTMLElement) => void)[],
) {
  const { compiled, original, names } = await loadCompiledAndOriginal(source);
  expect(names, "the scenario must compile").toContain(name);
  const hosts = [original[name]!, compiled[name]!].map((Component) => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.add(root);
    return { host, root, Component };
  });
  await act(async () => {
    for (const { root, Component } of hosts) root.render(<Component />);
  });
  const [reference, subject] = hosts.map(({ host }) => host) as [HTMLElement, HTMLElement];
  expect(normalizedDom(subject)).toBe(normalizedDom(reference));
  for (const [index, step] of steps.entries()) {
    for (const { host } of hosts) await act(async () => step(host));
    expect(normalizedDom(subject), `after step ${index + 1}`).toBe(normalizedDom(reference));
  }
}

describe("useMemo and useCallback in compiled components", () => {
  it("read memoized values and callbacks with complete dependencies", async () => {
    await expectParity(
      `import { useCallback, useMemo, useState } from "react";
      export function Todos() {
        const [todos, setTodos] = useState([{ id: 1, done: true }, { id: 2, done: false }]);
        const [label, setLabel] = useState("done");
        const done = useMemo(() => todos.filter((todo) => todo.done).length, [todos]);
        const summary = useMemo(() => {
          return label + ": " + done + "/" + todos.length;
        }, [label, done, todos]);
        const add = useCallback(() => {
          setTodos((current) => [...current, { id: current.length + 1, done: current.length % 2 === 0 }]);
        }, []);
        const rename = useCallback(() => setLabel(label === "done" ? "finished" : "done"), [label]);
        return (
          <section>
            <button id="add" onClick={add}>add</button>
            <button id="rename" onClick={rename}>rename</button>
            <p>{summary}</p>
          </section>
        );
      }`,
      "Todos",
      [click("#add"), click("#rename"), click("#add"), click("#rename"), click("#add")],
    );
  });

  it.each([
    {
      name: "a useMemo that leaves out a value it reads",
      declaration: "const first = useMemo(() => count * 2, []);",
    },
    {
      name: "a useCallback that leaves out a value it reads",
      declaration: "const first = useCallback(() => setCount(count + 1), []);",
    },
    {
      name: "member dependencies",
      declaration: "const first = useMemo(() => count + props.offset, [count, props.offset]);",
    },
    {
      name: "a useMemo callback that takes parameters",
      declaration: "const first = useMemo((value = count) => value, [count]);",
    },
  ])("keep $name on React", async ({ declaration }) => {
    const result = await compileReactModule(
      `import { useCallback, useMemo, useState } from "react";
      export function Counter(props) {
        const [count, setCount] = useState(0);
        ${declaration}
        return <button onClick={() => setCount(count + 1)}>{count}</button>;
      }`,
      "/app/Counter.tsx",
      normalizeReactCompilerOptions(true),
    );
    expect(result.compiled).toEqual([]);
  });
});
