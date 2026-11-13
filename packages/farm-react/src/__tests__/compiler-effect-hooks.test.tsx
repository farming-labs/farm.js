import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCompiledRoot } from "../compiled-root";
import { compileReactModule } from "../compiler";
import { normalizeReactCompilerOptions } from "../index";
import {
  loadCompiledAndOriginal,
  normalizedDom,
  removeCompiledModules,
} from "./compiled-module-harness";

// Compiled effects run in the component's render scope after each committed update: changed
// effects clean up and run again in React's order, and every cleanup runs on unmount.

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(removeCompiledModules);

const source = `import { useEffect, useLayoutEffect, useRef, useState } from "react";
export const log = [];
export function Timer({ step = 1 }) {
  const [count, setCount] = useState(0);
  const [label, setLabel] = useState("a");
  const output = useRef(null);
  const doubled = count * 2;
  useEffect(() => {
    log.push("count " + count + " " + doubled);
    return () => {
      log.push("cleanup " + count);
    };
  }, [count]);
  useEffect(() => {
    log.push("every " + label);
  });
  useEffect(() => {
    log.push("step " + step);
  }, [step]);
  useLayoutEffect(() => {
    log.push("mount " + label);
    // A stale closure, as in React: this keeps the label of the first render.
    const remember = () => log.push("first label " + label);
    return () => {
      remember();
      log.push("unmount");
    };
  }, []);
  useEffect(() => {
    if (count === 3) setCount(10);
    output.current.textContent = "seen " + count;
  }, [count]);
  return (
    <section>
      <button id="inc" onClick={() => setCount(count + step)}>{count}</button>
      <button id="label" onClick={() => setLabel(label + "b")}>{label}</button>
      <output ref={output}></output>
    </section>
  );
}`;

const steps = ["#inc", "#label", "#step", "#inc", "#inc", "#label", "#step"];

// A React parent changes the compiled component's props, which runs effects that read them.
function Parent({ Component }: { Component: React.ComponentType<{ step: number }> }) {
  const [step, setStep] = React.useState(1);
  return (
    <>
      <button id="step" onClick={() => setStep(step + 1)}>
        step
      </button>
      <Component step={step} />
    </>
  );
}

describe("useEffect and useLayoutEffect in compiled components", () => {
  it.each(["React DOM", "React DOM in StrictMode", "a compiled root"] as const)(
    "run, clean up and unmount as React does under %s",
    async (mode) => {
      const { compiled, original, names } = await loadCompiledAndOriginal(source);
      expect(names).toContain("Timer");
      const reference = document.createElement("div");
      const subject = document.createElement("div");
      document.body.append(reference, subject);
      const referenceRoot: Root = createRoot(reference);
      const fallbacks: string[] = [];
      const subjectRoot =
        mode !== "a compiled root"
          ? createRoot(subject)
          : createCompiledRoot(subject, { onFallback: (reason) => fallbacks.push(reason) });
      const Original = original.Timer! as React.ComponentType<{ step: number }>;
      const Compiled = compiled.Timer! as React.ComponentType<{ step: number }>;
      // A compiled root mounts compiled trees only, so its run keeps the default step.
      const withParent = mode !== "a compiled root";
      const strict = mode === "React DOM in StrictMode";
      const tree = (Component: React.ComponentType<{ step: number }>) => {
        const element = withParent ? <Parent Component={Component} /> : <Component step={1} />;
        return strict ? <React.StrictMode>{element}</React.StrictMode> : element;
      };
      await act(async () => {
        referenceRoot.render(tree(Original));
        subjectRoot.render(tree(Compiled));
      });
      expect(normalizedDom(subject)).toBe(normalizedDom(reference));
      for (const selector of steps) {
        if (selector === "#step" && !withParent) continue;
        for (const host of [reference, subject]) {
          await act(async () => host.querySelector<HTMLElement>(selector)!.click());
        }
        expect(normalizedDom(subject), selector).toBe(normalizedDom(reference));
        expect(compiled.log, selector).toEqual(original.log);
      }
      await act(async () => {
        referenceRoot.unmount();
        subjectRoot.unmount();
      });
      expect(compiled.log).toEqual(original.log);
      expect(original.log).toContain("first label a");
      if (withParent) expect(original.log).toContain("step 2");
      expect(fallbacks).toEqual([]);
      document.body.replaceChildren();
    },
  );

  it.each([
    { name: "an async effect", effect: "useEffect(async () => { await null; }, []);" },
    { name: "an effect with parameters", effect: "useEffect((value) => value, []);" },
    { name: "member dependencies", effect: "useEffect(() => undefined, [props.value]);" },
    { name: "a hook inside an effect", effect: "useEffect(() => { useState(0); }, []);" },
  ])("keep $name on React", async ({ effect }) => {
    const result = await compileReactModule(
      `import { useEffect, useState } from "react";
      export function Counter(props) {
        const [count, setCount] = useState(0);
        ${effect}
        return <button onClick={() => setCount(count + 1)}>{count}</button>;
      }`,
      "/app/Counter.tsx",
      normalizeReactCompilerOptions(true),
    );
    expect(result.compiled).toEqual([]);
  });
});
