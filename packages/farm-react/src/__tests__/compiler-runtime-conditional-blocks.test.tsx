import React, { StrictMode, useState } from "react";
import { act } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCompiledComponent } from "../compiler-runtime";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const roots: Array<{ unmount(): void }> = [];

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function click(container: Element, selector: string): void {
  const target = container.querySelector<HTMLElement>(selector);
  if (!target) throw new Error(`Missing test target: ${selector}`);
  target.click();
}

describe("compiled React conditional block runtime", () => {
  it("mounts, refreshes, and removes an && block without executing the user component", async () => {
    let executions = 0;
    const Panel = createCompiledComponent({
      displayName: "ConditionalPanel",
      initialize: () => [false, 0],
      render(_props: Record<string, never>, state, blocks) {
        executions += 1;
        const Conditional = blocks.Conditional;
        return (
          <main>
            <button data-action="toggle" onClick={() => state[0].set((value) => !value)}>
              Toggle
            </button>
            <Conditional
              id={0}
              render={() =>
                Boolean(state[0].get()) && (
                  <p data-branch="details">Branch count: {Number(state[1].get())}</p>
                )
              }
            />
            <output data-value="count">{Number(state[1].get())}</output>
            <button
              data-action="increment"
              onClick={() => state[1].set((value) => Number(value) + 1)}
            >
              Increment
            </button>
          </main>
        );
      },
      bindings: [
        { kind: "block", id: 0, dependencies: [0, 1] },
        {
          kind: "text",
          path: [1],
          dependencies: [1],
          read: (_props, state) => state[1].get(),
        },
      ],
    });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<Panel />));

    expect(executions).toBe(1);
    expect(container.querySelector("[data-branch='details']")).toBeNull();

    await act(async () => {
      click(container, "[data-action='toggle']");
      await Promise.resolve();
    });
    expect(container.querySelector("[data-branch='details']")?.textContent).toBe("Branch count: 0");
    expect(executions).toBe(1);

    await act(async () => {
      click(container, "[data-action='increment']");
      await Promise.resolve();
    });
    expect(container.querySelector("[data-branch='details']")?.textContent).toBe("Branch count: 1");
    expect(container.querySelector("[data-value='count']")?.textContent).toBe("1");
    expect(executions).toBe(1);

    await act(async () => {
      click(container, "[data-action='toggle']");
      await Promise.resolve();
    });
    expect(container.querySelector("[data-branch='details']")).toBeNull();
    expect(container.querySelector("[data-value='count']")?.textContent).toBe("1");
    expect(executions).toBe(1);
  });

  it("replaces only a ternary branch and preserves React event bubbling", async () => {
    let executions = 0;
    const Toggle = createCompiledComponent({
      displayName: "TernaryToggle",
      initialize: () => [true, 0],
      render(_props: Record<string, never>, state, blocks) {
        executions += 1;
        const Conditional = blocks.Conditional;
        return (
          <section onClick={() => state[1].set((value) => Number(value) + 1)}>
            <Conditional
              id={0}
              render={() =>
                Boolean(state[0].get()) ? (
                  <strong data-branch="enabled" onClick={() => state[0].set(false)}>
                    Enabled
                  </strong>
                ) : (
                  <span data-branch="disabled" onClick={() => state[0].set(true)}>
                    Disabled
                  </span>
                )
              }
            />
            <output>{Number(state[1].get())}</output>
          </section>
        );
      },
      bindings: [
        { kind: "block", id: 0, dependencies: [0] },
        {
          kind: "text",
          path: [0],
          dependencies: [1],
          read: (_props, state) => state[1].get(),
        },
      ],
    });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<Toggle />));

    const enabled = container.querySelector("[data-branch='enabled']");
    expect(enabled?.tagName).toBe("STRONG");
    await act(async () => {
      (enabled as HTMLElement).click();
      await Promise.resolve();
    });

    expect(container.querySelector("[data-branch='enabled']")).toBeNull();
    expect(container.querySelector("[data-branch='disabled']")?.tagName).toBe("SPAN");
    expect(container.querySelector("output")?.textContent).toBe("1");
    expect(executions).toBe(1);
  });

  it("keeps local block state coherent with a parent prop update in the same event", async () => {
    let executions = 0;
    const Child = createCompiledComponent({
      displayName: "PropAndLocalBlock",
      initialize: () => [0],
      render(props: { label: string }, state, blocks) {
        executions += 1;
        const Conditional = blocks.Conditional;
        return (
          <article>
            <Conditional
              id={0}
              render={() =>
                Number(state[0].get()) > 0 ? (
                  <p data-result="value">
                    {props.label}: {Number(state[0].get())}
                  </p>
                ) : (
                  <span data-result="empty">Empty</span>
                )
              }
            />
            <button onClick={() => state[0].set((value) => Number(value) + 1)}>Local</button>
          </article>
        );
      },
      bindings: [{ kind: "block", id: 0, dependencies: [0] }],
    });

    function Parent() {
      const [label, setLabel] = useState("Before");
      return (
        <div onClick={() => setLabel("After")}>
          <Child label={label} />
        </div>
      );
    }

    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<Parent />));
    const initialExecutions = executions;

    await act(async () => {
      click(container, "button");
      await Promise.resolve();
    });

    expect(container.querySelector("[data-result='value']")?.textContent).toBe("After: 1");
    expect(executions).toBe(initialExecutions + 1);
  });

  it("works through StrictMode remounting without re-executing on a local toggle", async () => {
    let executions = 0;
    const StrictToggle = createCompiledComponent({
      displayName: "StrictConditional",
      initialize: () => [false],
      render(_props: Record<string, never>, state, blocks) {
        executions += 1;
        const Conditional = blocks.Conditional;
        return (
          <div>
            <button onClick={() => state[0].set((value) => !value)}>Toggle</button>
            <Conditional
              id={0}
              render={() => Boolean(state[0].get()) && <p data-strict="ready">Ready</p>}
            />
          </div>
        );
      },
      bindings: [{ kind: "block", id: 0, dependencies: [0] }],
    });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () =>
      root.render(
        <StrictMode>
          <StrictToggle />
        </StrictMode>,
      ),
    );
    const initialExecutions = executions;

    await act(async () => {
      click(container, "button");
      await Promise.resolve();
    });

    expect(container.querySelector("[data-strict='ready']")?.textContent).toBe("Ready");
    expect(executions).toBe(initialExecutions);
  });

  it("drops a queued conditional refresh after the component unmounts", async () => {
    const Toggle = createCompiledComponent({
      displayName: "UnmountedConditional",
      initialize: () => [false],
      render(_props: Record<string, never>, state, blocks) {
        const Conditional = blocks.Conditional;
        return (
          <div>
            <button onClick={() => state[0].set(true)}>Show</button>
            <Conditional id={0} render={() => Boolean(state[0].get()) && <p>Shown</p>} />
          </div>
        );
      },
      bindings: [{ kind: "block", id: 0, dependencies: [0] }],
    });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(<Toggle />));

    await act(async () => {
      click(container, "button");
      root.unmount();
      await Promise.resolve();
    });

    expect(container.textContent).toBe("");
  });

  it("preserves ordinary SSR markup and hydrates a conditional branch", async () => {
    const Toggle = createCompiledComponent({
      displayName: "HydratedConditional",
      initialize: () => [true],
      render(_props: Record<string, never>, state, blocks) {
        const Conditional = blocks.Conditional;
        return (
          <div>
            <button onClick={() => state[0].set((value) => !value)}>Toggle</button>
            <Conditional
              id={0}
              render={() =>
                Boolean(state[0].get()) ? <strong data-server="branch">Enabled</strong> : null
              }
            />
          </div>
        );
      },
      bindings: [{ kind: "block", id: 0, dependencies: [0] }],
    });
    const html = renderToString(<Toggle />);
    expect(html).toContain('<strong data-server="branch">Enabled</strong>');
    expect(html).not.toContain("farm");

    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.append(container);
    const recoverableErrors: unknown[] = [];
    let root!: ReturnType<typeof hydrateRoot>;
    await act(async () => {
      root = hydrateRoot(container, <Toggle />, {
        onRecoverableError: (error) => recoverableErrors.push(error),
      });
    });
    roots.push(root);

    await act(async () => {
      click(container, "button");
      await Promise.resolve();
    });
    expect(container.querySelector("[data-server='branch']")).toBeNull();
    expect(recoverableErrors).toEqual([]);
  });

  it("preserves selection when a controlled input updates inside the block", async () => {
    const FormBlock = createCompiledComponent({
      displayName: "ConditionalForm",
      initialize: () => [true, "Farm"],
      render(_props: Record<string, never>, state, blocks) {
        const Conditional = blocks.Conditional;
        return (
          <section>
            <Conditional
              id={0}
              render={() =>
                Boolean(state[0].get()) ? (
                  <label>
                    Note
                    <input value={String(state[1].get())} onChange={() => undefined} />
                  </label>
                ) : null
              }
            />
            <button onClick={() => state[1].set("Compiler")}>Replace value</button>
          </section>
        );
      },
      bindings: [{ kind: "block", id: 0, dependencies: [0, 1] }],
    });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<FormBlock />));
    const input = container.querySelector("input")!;
    input.focus();
    input.setSelectionRange(1, 3);

    await act(async () => {
      click(container, "button");
      await Promise.resolve();
    });

    expect(input.value).toBe("Compiler");
    expect(input.selectionStart).toBe(1);
    expect(input.selectionEnd).toBe(3);
  });

  it("handles object, array, and nullish condition transitions", async () => {
    let observedValue: unknown;
    let nullEvents = 0;
    const ValueBlock = createCompiledComponent({
      displayName: "ConditionalValues",
      initialize: () => [null],
      render(_props: Record<string, never>, state, blocks) {
        const Conditional = blocks.Conditional;
        return (
          <section>
            <button data-value="object" onClick={() => state[0].set({ ready: true })} />
            <button data-value="array" onClick={() => state[0].set([])} />
            <button
              data-value="clear"
              onClick={() => {
                nullEvents += 1;
                state[0].set(null);
              }}
            />
            <Conditional
              id={0}
              render={() => {
                observedValue = state[0].get();
                return observedValue ? (
                  <p data-present="value">{Array.isArray(observedValue) ? "array" : "object"}</p>
                ) : null;
              }}
            />
          </section>
        );
      },
      bindings: [{ kind: "block", id: 0, dependencies: [0] }],
    });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<ValueBlock />));
    expect(container.querySelector("[data-present='value']")).toBeNull();

    for (const [value, expected] of [
      ["object", "object"],
      ["array", "array"],
    ] as const) {
      await act(async () => {
        click(container, `[data-value='${value}']`);
        await Promise.resolve();
      });
      expect(container.querySelector("[data-present='value']")?.textContent).toBe(expected);
    }

    await act(async () => {
      click(container, "[data-value='clear']");
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(nullEvents).toBe(1);
    expect(observedValue).toBeNull();
    expect(container.querySelector("[data-present='value']")).toBeNull();
  });

  it("routes a block render failure through a React error boundary", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    class Boundary extends React.Component<React.PropsWithChildren, { failed: boolean }> {
      state = { failed: false };
      static getDerivedStateFromError() {
        return { failed: true };
      }
      render() {
        return this.state.failed ? <p data-error="caught">Recovered</p> : this.props.children;
      }
    }
    const BrokenBlock = createCompiledComponent({
      displayName: "BrokenConditional",
      initialize: () => [false],
      render(_props: Record<string, never>, state, blocks) {
        const Conditional = blocks.Conditional;
        return (
          <div>
            <button onClick={() => state[0].set(true)}>Break</button>
            <Conditional
              id={0}
              render={() => {
                if (state[0].get()) throw new Error("branch failed");
                return <p>Safe</p>;
              }}
            />
          </div>
        );
      },
      bindings: [{ kind: "block", id: 0, dependencies: [0] }],
    });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () =>
      root.render(
        <Boundary>
          <BrokenBlock />
        </Boundary>,
      ),
    );

    await act(async () => {
      click(container, "button");
      await Promise.resolve();
    });

    expect(container.querySelector("[data-error='caught']")?.textContent).toBe("Recovered");
  });

  it("matches normal React after one thousand deterministic randomized updates", async () => {
    let seed = 0x5f3759df;
    const nextRandom = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0x1_0000_0000;
    };
    const Compiled = createCompiledComponent({
      displayName: "RandomConditional",
      initialize: () => [false, 0],
      render(_props: Record<string, never>, state, blocks) {
        const Conditional = blocks.Conditional;
        return (
          <div>
            <button data-random="toggle" onClick={() => state[0].set((value) => !value)} />
            <button
              data-random="increment"
              onClick={() => state[1].set((value) => Number(value) + 1)}
            />
            <Conditional
              id={0}
              render={() =>
                Boolean(state[0].get()) ? (
                  <strong>On {Number(state[1].get())}</strong>
                ) : (
                  <span>Off {Number(state[1].get())}</span>
                )
              }
            />
          </div>
        );
      },
      bindings: [{ kind: "block", id: 0, dependencies: [0, 1] }],
    });
    function Base() {
      const [enabled, setEnabled] = useState(false);
      const [count, setCount] = useState(0);
      return (
        <div>
          <button data-random="toggle" onClick={() => setEnabled((value) => !value)} />
          <button data-random="increment" onClick={() => setCount((value) => value + 1)} />
          {enabled ? <strong>On {count}</strong> : <span>Off {count}</span>}
        </div>
      );
    }

    const compiledContainer = document.createElement("div");
    const baseContainer = document.createElement("div");
    document.body.append(compiledContainer, baseContainer);
    const compiledRoot = createRoot(compiledContainer);
    const baseRoot = createRoot(baseContainer);
    roots.push(compiledRoot, baseRoot);
    await act(async () => {
      compiledRoot.render(<Compiled />);
      baseRoot.render(<Base />);
    });

    for (let batch = 0; batch < 100; batch += 1) {
      await act(async () => {
        for (let update = 0; update < 10; update += 1) {
          const action = nextRandom() < 0.35 ? "toggle" : "increment";
          click(compiledContainer, `[data-random='${action}']`);
          click(baseContainer, `[data-random='${action}']`);
        }
        await Promise.resolve();
      });
      expect(compiledContainer.innerHTML).toBe(baseContainer.innerHTML);
    }
  });
});
