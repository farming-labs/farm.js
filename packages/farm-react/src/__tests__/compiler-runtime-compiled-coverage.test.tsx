import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadCompiledAndOriginal, removeCompiledModules } from "./compiled-module-harness";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
  var farmTestGate: () => Promise<void>;
}

const roots: Root[] = [];

// Async handlers in the sources below wait on this gate instead of a timer, so
// each continuation runs in its own act() step, after the previous one committed.
let gateOwner: HTMLElement | undefined;
const gated: Array<{ owner: HTMLElement | undefined; resolve: () => void }> = [];
globalThis.farmTestGate = () =>
  new Promise<void>((resolve) => gated.push({ owner: gateOwner, resolve }));
const releaseOne = async (container: HTMLElement) => {
  const index = gated.findIndex((gate) => gate.owner === container);
  expect(index).toBeGreaterThanOrEqual(0);
  gated.splice(index, 1)[0].resolve();
  // The continuation and anything it chains are microtasks, so they finish before this macrotask.
  await new Promise((resolve) => setTimeout(resolve, 0));
};

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.replaceChildren();
});

afterAll(removeCompiledModules);

async function mount(Component: React.ComponentType<Record<string, unknown>>, props = {}) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(<Component {...props} />));
  return container;
}

/** Runs the same interactions on React and compiled renders and compares each step. */
async function expectSameAsReact(
  source: string,
  name: string,
  steps: Array<(container: HTMLElement) => void | Promise<void>>,
  props: Record<string, unknown> = {},
) {
  const { compiled, original, names, reasons } = await loadCompiledAndOriginal(source);
  expect(reasons).toEqual([]);
  expect(names).toContain(name);
  const reactContainer = await mount(original[name], props);
  const compiledContainer = await mount(compiled[name], props);
  expect(compiledContainer.innerHTML).toBe(reactContainer.innerHTML);
  for (const step of steps) {
    for (const container of [reactContainer, compiledContainer]) {
      await act(async () => {
        await step(container);
      });
    }
    expect(compiledContainer.innerHTML).toBe(reactContainer.innerHTML);
  }
  return compiledContainer;
}

const click =
  (...selectors: string[]) =>
  (container: HTMLElement) => {
    gateOwner = container;
    for (const selector of selectors) container.querySelector<HTMLElement>(selector)!.click();
  };

describe("compiled components match React", () => {
  it("with useState declared after derived values and handlers", async () => {
    await expectSameAsReact(
      `
        import { useState } from "react";
        export function LateState() {
          const [count, setCount] = useState(1);
          const doubled = count * 2;
          const reset = () => {
            setCount(0);
            setOpen(false);
          };
          const [open, setOpen] = useState(false);
          return (
            <section className={open ? "open" : "closed"}>
              <output>{doubled}</output>
              <button id="inc" onClick={() => setCount(count + 1)}>Inc</button>
              <button id="toggle" onClick={() => setOpen(!open)}>Toggle</button>
              <button id="reset" onClick={reset}>Reset</button>
            </section>
          );
        }
      `,
      "LateState",
      [click("#inc"), click("#toggle"), click("#inc"), click("#reset"), click("#toggle")],
    );
  });

  it("with nested, defaulted and rest props destructuring", async () => {
    const { compiled, original, names, reasons } = await loadCompiledAndOriginal(`
      import { useState } from "react";
      export function Card({ user: { name, tags: [first = "none"] }, size = "md", ...rest }) {
        const [open, setOpen] = useState(false);
        return (
          <section className={size} data-open={open ? "yes" : "no"}>
            <h2>{name}</h2>
            <small>{first}</small>
            <p>{rest.note}</p>
            <button onClick={() => setOpen(!open)}>Toggle</button>
          </section>
        );
      }
    `);
    expect(reasons).toEqual([]);
    expect(names).toEqual(["Card"]);
    const renders = [
      { user: { name: "Ada", tags: [] }, note: "first" },
      { user: { name: "Grace", tags: ["admiral"] }, size: "lg", note: "second" },
    ];
    const views = [];
    for (const Component of [original.Card, compiled.Card]) {
      const container = document.createElement("div");
      document.body.append(container);
      const root = createRoot(container);
      roots.push(root);
      await act(async () => root.render(<Component {...renders[0]} />));
      views.push({ Component, container, root });
    }
    const [react, farm] = views;
    expect(farm.container.innerHTML).toBe(react.container.innerHTML);
    for (const view of views) {
      await act(async () => view.container.querySelector("button")!.click());
    }
    expect(farm.container.innerHTML).toBe(react.container.innerHTML);
    for (const view of views) {
      await act(async () => view.root.render(<view.Component {...renders[1]} />));
    }
    expect(farm.container.innerHTML).toBe(react.container.innerHTML);
    expect(farm.container.querySelector("h2")!.textContent).toBe("Grace");
    expect(farm.container.querySelector("small")!.textContent).toBe("admiral");
  });

  it("with async handlers that read state after an await", async () => {
    await expectSameAsReact(
      `
        import { useState } from "react";
        export function Loader() {
          const [count, setCount] = useState(0);
          const [status, setStatus] = useState("idle");
          return (
            <section data-status={status}>
              <output>{count}</output>
              <button
                id="inline"
                onClick={async () => {
                  setStatus("loading");
                  await globalThis.farmTestGate();
                  // React reads the count this handler was rendered with.
                  setCount(count + 1);
                  setStatus("done");
                }}
              >
                Load
              </button>
            </section>
          );
        }
      `,
      "Loader",
      [click("#inline", "#inline"), releaseOne, releaseOne],
    );
  });

  it("with named async handlers and deferred callbacks", async () => {
    await expectSameAsReact(
      `
        import { useState } from "react";
        export function Saver({ step = 1 }) {
          const [count, setCount] = useState(0);
          const [log, setLog] = useState("");
          const save = async () => {
            await globalThis.farmTestGate();
            setCount(count + step);
          };
          async function record() {
            await globalThis.farmTestGate();
            setLog(log + "|" + count);
          }
          return (
            <section>
              <output>{count}</output>
              <p>{log}</p>
              <button id="save" onClick={save}>Save</button>
              <button id="record" onClick={record}>Record</button>
              <button id="later" onClick={() => globalThis.farmTestGate().then(() => setCount(count + 10))}>
                Later
              </button>
            </section>
          );
        }
      `,
      "Saver",
      [
        click("#save", "#save"),
        releaseOne,
        releaseOne,
        click("#record", "#later", "#later"),
        releaseOne,
        releaseOne,
        releaseOne,
      ],
      { step: 2 },
    );
  });
});
