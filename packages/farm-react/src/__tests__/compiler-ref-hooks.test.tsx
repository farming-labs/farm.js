import React, { act } from "react";
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

// A useRef object is stable per component and changes without rendering: compiled components
// read it in handlers and attach it through ref attributes on static elements, as React does.

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
  document.body.replaceChildren();
});
afterAll(removeCompiledModules);

const source = `import { useRef, useState } from "react";
export function Search() {
  const [query, setQuery] = useState("");
  const [count, setCount] = useState(0);
  const input = useRef(null);
  const note = useRef(null);
  const clicks = useRef(0);
  const focusNote = () => note.current.focus();
  return (
    <section>
      <input id="query" ref={input} value={query} onChange={(event) => setQuery(event.target.value)} />
      <textarea id="note" ref={note} />
      <button id="focus-query" onClick={() => input.current.focus()}>query</button>
      <button id="focus-note" onClick={focusNote}>note</button>
      <button id="count" onClick={() => { clicks.current += 1; setCount(clicks.current * 10); }}>{count}</button>
    </section>
  );
}`;

type Mount = (host: HTMLElement, Component: React.ComponentType) => void;
const withReactDom: Mount = (host, Component) => {
  const root = createRoot(host);
  reactRoots.add(root);
  root.render(<Component />);
};
const withCompiledRoot: Mount = (host, Component) => {
  const root = createCompiledRoot(host, {
    onFallback: (reason) => {
      throw new Error(`unexpected fallback: ${reason}`);
    },
  });
  compiledRoots.add(root);
  root.render(<Component />);
};

describe("useRef in compiled components", () => {
  it.each([
    ["React DOM", withReactDom],
    ["a compiled root", withCompiledRoot],
  ] as const)("attaches element refs and keeps values across clicks under %s", async (_, mount) => {
    const { compiled, original, names } = await loadCompiledAndOriginal(source);
    expect(names).toContain("Search");
    const reference = document.createElement("div");
    const subject = document.createElement("div");
    document.body.append(reference, subject);
    await act(async () => {
      withReactDom(reference, original.Search!);
      mount(subject, compiled.Search!);
    });
    const focused = (host: HTMLElement) =>
      host.contains(document.activeElement) ? document.activeElement?.id : "";
    for (const [selector, expectedFocus] of [
      ["#focus-query", "query"],
      ["#count", ""],
      ["#focus-note", "note"],
      ["#count", ""],
    ] as const) {
      for (const host of [reference, subject]) {
        await act(async () => host.querySelector<HTMLElement>(selector)!.click());
        if (expectedFocus) expect(focused(host), selector).toBe(expectedFocus);
      }
      expect(normalizedDom(subject), selector).toBe(normalizedDom(reference));
    }
    expect(subject.querySelector("#count")!.textContent).toBe("20");
  });

  it.each([
    {
      name: "a ref read during render",
      body: "<p>{clicks.current}</p>",
    },
    {
      name: "a ref on the root element",
      root: "<section ref={clicks}>",
      body: "",
    },
    {
      name: "a ref inside a conditional branch",
      body: "<div>{count > 0 && <input ref={clicks} />}</div>",
    },
  ])("keep $name on React", async ({ body, root = "<section>" }) => {
    const result = await compileReactModule(
      `import { useRef, useState } from "react";
      export function Clicks() {
        const [count, setCount] = useState(0);
        const clicks = useRef(0);
        return ${root}<button onClick={() => setCount(count + 1)}>{count}</button>${body}</section>;
      }`,
      "/app/Clicks.tsx",
      normalizeReactCompilerOptions(true),
    );
    expect(result.compiled).toEqual([]);
  });
});
