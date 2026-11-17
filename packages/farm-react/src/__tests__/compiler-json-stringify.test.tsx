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

// JSON.stringify is a safe call like String(): a compiled binding renders `<pre>{JSON.stringify(
// state, null, 2)}</pre>` and patches it when the state changes.

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

const source = `import { useState } from "react";
export function Status() {
  const [status, setStatus] = useState({ state: "idle", runs: 0 });
  return (
    <section>
      <button id="run" onClick={() => setStatus({ state: "running", runs: status ? status.runs + 1 : 1 })}>run</button>
      <button id="clear" onClick={() => setStatus(undefined)}>clear</button>
      <pre>{JSON.stringify(status, null, 2)}</pre>
      <p title={JSON.stringify(status)}>{status ? status.state : "none"}</p>
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

describe("JSON.stringify in compiled bindings", () => {
  it.each([
    ["React DOM", withReactDom],
    ["a compiled root", withCompiledRoot],
  ] as const)("renders and patches stringified state like React under %s", async (_, mount) => {
    const { compiled, original, names } = await loadCompiledAndOriginal(source);
    expect(names).toEqual(["Status"]);
    const reference = document.createElement("div");
    const subject = document.createElement("div");
    document.body.append(reference, subject);
    await act(async () => {
      withReactDom(reference, original.Status!);
      mount(subject, compiled.Status!);
    });
    const pre = subject.querySelector("pre")!;
    expect(normalizedDom(subject)).toBe(normalizedDom(reference));
    // JSON.stringify(undefined) is undefined, which React renders as nothing.
    for (const selector of ["#run", "#run", "#clear", "#run"]) {
      for (const host of [reference, subject]) {
        await act(async () => host.querySelector<HTMLElement>(selector)!.click());
      }
      expect(normalizedDom(subject), selector).toBe(normalizedDom(reference));
    }
    expect(subject.querySelector("pre")).toBe(pre);
    expect(JSON.parse(pre.textContent!)).toEqual({ state: "running", runs: 1 });
  });

  it.each([
    { name: "a replacer function", call: "JSON.stringify(status, (key, value) => value)" },
    { name: "a replacer array", call: 'JSON.stringify(status, ["state"])' },
    { name: "JSON.parse", call: 'JSON.parse("{}")' },
    {
      name: "a shadowed JSON",
      call: "JSON.stringify(status)",
      extra: "const JSON = { stringify: String };",
    },
  ])("keeps $name on React", async ({ call, extra = "" }) => {
    const result = await compileReactModule(
      `import { useState } from "react";
      ${extra}
      export function Status() {
        const [status, setStatus] = useState({ state: "idle" });
        return <section><button onClick={() => setStatus({ state: "done" })}>run</button><pre>{${call}}</pre></section>;
      }`,
      "/app/Status.tsx",
      normalizeReactCompilerOptions(true),
    );
    expect(result.compiled).toEqual([]);
  });
});
