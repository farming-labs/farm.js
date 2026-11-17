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

// A conditional whose branch is a fragment of host elements compiles as one conditional per
// element: the fragment renders no node of its own, so the parts render the same DOM.

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
function Badge() {
  return <small>verified</small>;
}
export function Session() {
  const [status, setStatus] = useState("loading");
  const [count, setCount] = useState(0);
  return (
    <section className="card">
      <h2>Session</h2>
      {status === "loading" ? <p>Checking…</p> : null}
      {status === "ready" ? (
        <>
          <div className="line">
            <strong>Count</strong>
            <span>{count}</span>
          </div>
          <Badge />
          <div className="actions">
            <button id="add" onClick={() => setCount(count + 1)}>add</button>
            {count > 1 ? <>
              <em>many</em>
              <button id="reset" onClick={() => setCount(0)}>reset</button>
            </> : null}
          </div>
        </>
      ) : (
        <>
          <p>No session.</p>
          <button id="sign-in" onClick={() => setStatus("ready")}>sign in</button>
        </>
      )}
      {count && <><i>count</i><b>{count}</b></>}
      <button id="load" onClick={() => setStatus(status === "loading" ? "none" : "loading")}>load</button>
    </section>
  );
}`;

type Mount = (host: HTMLElement, Component: React.ComponentType) => void;
const withReactDom: Mount = (host, Component) => {
  const root = createRoot(host);
  reactRoots.add(root);
  root.render(<Component />);
};

describe("fragment branches in compiled conditionals", () => {
  it("renders the same DOM as React through every branch", async () => {
    const { compiled, original, names } = await loadCompiledAndOriginal(source);
    expect(names).toEqual(["Session"]);
    const reference = document.createElement("div");
    const subject = document.createElement("div");
    document.body.append(reference, subject);
    await act(async () => {
      withReactDom(reference, original.Session!);
      withReactDom(subject, compiled.Session!);
    });
    expect(normalizedDom(subject)).toBe(normalizedDom(reference));
    expect(subject.querySelector("section")!.textContent).toContain("Checking…");

    for (const selector of [
      "#load",
      "#sign-in",
      "#add",
      "#add",
      "#add",
      "#reset",
      "#load",
      "#load",
      "#sign-in",
      "#add",
    ]) {
      for (const host of [reference, subject]) {
        await act(async () => host.querySelector<HTMLElement>(selector)!.click());
      }
      expect(normalizedDom(subject), selector).toBe(normalizedDom(reference));
    }
    expect(subject.querySelector("span")!.textContent).toBe("1");
    expect(subject.querySelector("small")!.textContent).toBe("verified");
  });

  // Conditional sections update through React, so a root without React DOM hands this component to
  // React DOM, which must render the split branches like the original fragments.
  it("renders fragment branches in a compiled root, which hands them to React DOM", async () => {
    const { compiled, original, names } =
      await loadCompiledAndOriginal(`import { useState } from "react";
export function Status() {
  const [status, setStatus] = useState("loading");
  const [count, setCount] = useState(0);
  return (
    <section>
      <h2>Status</h2>
      {status === "ready" ? (
        <>
          <p className={count > 1 ? "many" : "few"}>Count</p>
          <span>{count}</span>
        </>
      ) : (
        <>
          <p>Waiting</p>
          <em>{status}</em>
        </>
      )}
      {count && <><i>count</i><b>{count}</b></>}
      <button id="ready" onClick={() => setStatus(status === "ready" ? "idle" : "ready")}>toggle</button>
      <button id="add" onClick={() => setCount(count + 1)}>add</button>
    </section>
  );
}`);
    expect(names).toEqual(["Status"]);
    const fallbacks: string[] = [];
    const reference = document.createElement("div");
    const subject = document.createElement("div");
    document.body.append(reference, subject);
    await act(async () => {
      withReactDom(reference, original.Status!);
      const root = createCompiledRoot(subject, {
        onFallback: (reason) => fallbacks.push(String(reason)),
      });
      compiledRoots.add(root);
      root.render(<compiled.Status />);
    });
    expect(fallbacks).toHaveLength(1);
    expect(normalizedDom(subject)).toBe(normalizedDom(reference));
    for (const selector of ["#add", "#ready", "#add", "#add", "#ready", "#ready"]) {
      for (const host of [reference, subject]) {
        await act(async () => host.querySelector<HTMLElement>(selector)!.click());
      }
      expect(normalizedDom(subject), selector).toBe(normalizedDom(reference));
    }
    expect(subject.querySelector("span")!.textContent).toBe("3");
  });

  it("renders a falsy && test once, as React renders it", async () => {
    const { compiled, original } = await loadCompiledAndOriginal(source);
    const reference = document.createElement("div");
    const subject = document.createElement("div");
    document.body.append(reference, subject);
    await act(async () => {
      withReactDom(reference, original.Session!);
      withReactDom(subject, compiled.Session!);
    });
    const zeros = (host: HTMLElement) =>
      [...host.querySelector("section")!.childNodes].filter(
        (node) => node.nodeType === Node.TEXT_NODE && node.textContent === "0",
      ).length;
    expect(zeros(reference)).toBe(1);
    expect(zeros(subject)).toBe(1);
  });

  it.each([
    { name: "a space between fragment elements", branch: "<><b>a</b> <i>b</i></>" },
    { name: "text in a fragment", branch: "<>text<b>a</b></>" },
    { name: "a nested fragment", branch: "<><><b>a</b></><i>b</i></>" },
  ])("keeps $name on React", async ({ branch }) => {
    const result = await compileReactModule(
      `import { useState } from "react";
      function Child() { return <span>child</span>; }
      export function Toggle() {
        const [open, setOpen] = useState(false);
        return (
          <section>
            <h2>Title</h2>
            {open ? ${branch} : null}
            <button onClick={() => setOpen(!open)}>toggle</button>
          </section>
        );
      }`,
      "/app/Toggle.tsx",
      normalizeReactCompilerOptions(true),
    );
    expect(result.compiled).toEqual([]);
  });
});
