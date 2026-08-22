import React, { StrictMode, useState } from "react";
import { act } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createCompiledComponent,
  type CompiledComponentDefinition,
  type CompilerStateUpdater,
} from "../compiler-runtime";

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

async function flushCompilerUpdates(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("compiler-owned host conditional runtime", () => {
  it("patches a stable branch and replaces only the branch when its condition changes", async () => {
    let executions = 0;
    let setEnabled: (next: CompilerStateUpdater) => void = () => undefined;
    let setCount: (next: CompilerStateUpdater) => void = () => undefined;
    const Status = createCompiledComponent({
      displayName: "CompiledHostStatus",
      initialize: () => [true, 1],
      render(_props: Record<string, never>, state, blocks) {
        executions += 1;
        setEnabled = (next) => state[0].set(next);
        setCount = (next) => state[1].set(next);
        const HostConditional = blocks.HostConditional;
        return (
          <main>
            <HostConditional
              id={0}
              render={() => (
                <div data-slot="status">
                  {state[0].get() ? (
                    <strong className={Number(state[1].get()) > 1 ? "ready" : "idle"}>
                      <span>Enabled {Number(state[1].get())}</span>
                    </strong>
                  ) : (
                    <span data-count={Number(state[1].get())}>
                      Disabled {Number(state[1].get())}
                    </span>
                  )}
                </div>
              )}
              test={() => state[0].get()}
              truthy={{
                create: () => ({
                  kind: "element",
                  tag: "strong",
                  attributes: [
                    {
                      name: "className",
                      value: Number(state[1].get()) > 1 ? "ready" : "idle",
                    },
                  ],
                  styles: [],
                  children: [
                    {
                      kind: "element",
                      tag: "span",
                      attributes: [],
                      styles: [],
                      children: [["Enabled ", Number(state[1].get())]],
                    },
                  ],
                }),
                bindings: [
                  {
                    kind: "attribute",
                    path: [],
                    name: "className",
                    read: () => (Number(state[1].get()) > 1 ? "ready" : "idle"),
                  },
                  {
                    kind: "text",
                    path: [0],
                    read: () => ["Enabled ", Number(state[1].get())],
                  },
                ],
              }}
              falsy={{
                create: () => ({
                  kind: "element",
                  tag: "span",
                  attributes: [{ name: "data-count", value: Number(state[1].get()) }],
                  styles: [],
                  children: [["Disabled ", Number(state[1].get())]],
                }),
                bindings: [
                  {
                    kind: "attribute",
                    path: [],
                    name: "data-count",
                    read: () => Number(state[1].get()),
                  },
                  {
                    kind: "text",
                    path: [],
                    read: () => ["Disabled ", Number(state[1].get())],
                  },
                ],
              }}
            />
          </main>
        );
      },
      bindings: [{ kind: "block", id: 0, dependencies: [0, 1] }],
    });

    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<Status />));
    const initialBranch = container.querySelector("strong")!;

    await act(async () => {
      setCount(2);
      await flushCompilerUpdates();
    });
    expect(container.querySelector("strong")).toBe(initialBranch);
    expect(initialBranch.className).toBe("ready");
    expect(initialBranch.textContent).toBe("Enabled 2");

    await act(async () => {
      setEnabled(false);
      await flushCompilerUpdates();
    });
    expect(initialBranch.isConnected).toBe(false);
    expect(container.querySelector("[data-slot='status']")?.textContent).toBe("Disabled 2");
    expect(container.querySelector("span")?.getAttribute("data-count")).toBe("2");
    expect(executions).toBe(1);
  });

  it("mounts and removes a logical branch without adding a marker node", async () => {
    let setVisible: (next: CompilerStateUpdater) => void = () => undefined;
    const Panel = createCompiledComponent({
      displayName: "LogicalHostConditional",
      initialize: () => [false],
      render(_props: Record<string, never>, state, blocks) {
        setVisible = (next) => state[0].set(next);
        const HostConditional = blocks.HostConditional;
        return (
          <section>
            <HostConditional
              id={0}
              logical
              render={() => (
                <div data-slot="logical">
                  {Boolean(state[0].get()) && <p data-branch="visible">Visible</p>}
                </div>
              )}
              test={() => state[0].get()}
              truthy={{
                create: () => ({
                  kind: "element",
                  tag: "p",
                  attributes: [{ name: "data-branch", value: "visible" }],
                  styles: [],
                  children: ["Visible"],
                }),
                bindings: [],
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
    await act(async () => root.render(<Panel />));
    const slot = container.querySelector("[data-slot='logical']")!;
    expect(slot.childNodes).toHaveLength(0);

    await act(async () => {
      setVisible(true);
      await flushCompilerUpdates();
    });
    expect(slot.children).toHaveLength(1);
    expect(slot.firstElementChild?.tagName).toBe("P");

    await act(async () => {
      setVisible(false);
      await flushCompilerUpdates();
    });
    expect(slot.childNodes).toHaveLength(0);
  });

  it("falls back to React when logical && produces a visible numeric primitive", async () => {
    let setValue: (next: CompilerStateUpdater) => void = () => undefined;
    let branchRenders = 0;
    const Panel = createCompiledComponent({
      displayName: "NumericLogicalFallback",
      initialize: () => [false],
      render(_props: Record<string, never>, state, blocks) {
        setValue = (next) => state[0].set(next);
        const HostConditional = blocks.HostConditional;
        return (
          <section>
            <HostConditional
              id={0}
              logical
              render={() => {
                branchRenders += 1;
                return (
                  <div data-slot="numeric">
                    {(state[0].get() as boolean | number) && <p>Visible</p>}
                  </div>
                );
              }}
              test={() => state[0].get()}
              truthy={{
                create: () => ({
                  kind: "element",
                  tag: "p",
                  attributes: [],
                  styles: [],
                  children: ["Visible"],
                }),
                bindings: [],
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
    await act(async () => root.render(<Panel />));

    await act(async () => {
      setValue(0);
      await flushCompilerUpdates();
    });
    expect(container.querySelector("[data-slot='numeric']")?.textContent).toBe("0");
    expect(branchRenders).toBeGreaterThan(1);

    await act(async () => {
      setValue(true);
      await flushCompilerUpdates();
    });
    expect(container.querySelector("[data-slot='numeric']")?.textContent).toBe("Visible");
  });

  it("keeps DOM state across updates while in permanent fallback", async () => {
    let setFlag: (next: CompilerStateUpdater) => void = () => undefined;
    let setLabel: (next: CompilerStateUpdater) => void = () => undefined;
    const Panel = createCompiledComponent({
      displayName: "FallbackDomStatePanel",
      initialize: () => [true, "one"],
      render(_props: Record<string, never>, state, blocks) {
        setFlag = (next) => state[0].set(next);
        setLabel = (next) => state[1].set(next);
        const HostConditional = blocks.HostConditional;
        return (
          <section>
            <HostConditional
              id={0}
              render={() => (
                // The whitespace text nodes around the branch make adopt()
                // fail its single-element check, so the block enters
                // permanent React fallback at mount.
                <div data-slot="box">
                  {" "}
                  {state[0].get() ? (
                    <b title={String(state[1].get())}>
                      <input data-slot="field" />
                    </b>
                  ) : (
                    <i>off</i>
                  )}{" "}
                </div>
              )}
              test={() => state[0].get()}
              truthy={{
                create: () => ({
                  kind: "element",
                  tag: "b",
                  attributes: [],
                  styles: [],
                  children: [],
                }),
                bindings: [],
              }}
            />
          </section>
        );
      },
      bindings: [{ kind: "block", id: 0, dependencies: [0, 1] }],
    });

    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<Panel />));

    const input = container.querySelector<HTMLInputElement>("[data-slot='field']");
    expect(input).not.toBeNull();
    input!.value = "typed";

    // An update to a dependency the branch renders must reconcile in place.
    await act(async () => {
      setLabel("two");
      await flushCompilerUpdates();
    });

    const afterUpdate = container.querySelector<HTMLInputElement>("[data-slot='field']");
    expect(container.querySelector("b")?.getAttribute("title")).toBe("two");
    expect(afterUpdate).toBe(input);
    expect(afterUpdate!.value).toBe("typed");

    // Branch switches still work through React's normal reconciliation.
    await act(async () => {
      setFlag(false);
      await flushCompilerUpdates();
    });
    expect(container.querySelector("[data-slot='field']")).toBeNull();
    expect(container.querySelector("i")?.textContent).toBe("off");
  });

  it("combines a parent prop commit and local branch update in the same event", async () => {
    let childExecutions = 0;
    const Child = createCompiledComponent({
      displayName: "PropHostConditional",
      initialize: () => [0],
      render(props: { prefix: string }, state, blocks) {
        childExecutions += 1;
        const HostConditional = blocks.HostConditional;
        return (
          <article>
            <button onClick={() => state[0].set((value) => Number(value) + 1)}>Update</button>
            <HostConditional
              id={0}
              render={() => (
                <div>
                  {Number(state[0].get()) > 0 ? (
                    <strong>
                      {props.prefix}:{Number(state[0].get())}
                    </strong>
                  ) : (
                    <span>Empty</span>
                  )}
                </div>
              )}
              test={() => Number(state[0].get()) > 0}
              truthy={{
                create: () => ({
                  kind: "element",
                  tag: "strong",
                  attributes: [],
                  styles: [],
                  children: [[props.prefix, ":", state[0].get()]],
                }),
                bindings: [
                  { kind: "text", path: [], read: () => [props.prefix, ":", state[0].get()] },
                ],
              }}
              falsy={{
                create: () => ({
                  kind: "element",
                  tag: "span",
                  attributes: [],
                  styles: [],
                  children: ["Empty"],
                }),
                bindings: [],
              }}
            />
          </article>
        );
      },
      bindings: [{ kind: "block", id: 0, dependencies: [0] }],
    });

    function Parent() {
      const [prefix, setPrefix] = useState("Before");
      return (
        <div onClick={() => setPrefix("After")}>
          <Child prefix={prefix} />
        </div>
      );
    }

    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<Parent />));
    const initialExecutions = childExecutions;
    await act(async () => {
      container.querySelector("button")!.click();
      await flushCompilerUpdates();
    });
    await flushCompilerUpdates();
    expect(container.querySelector("strong")?.textContent).toBe("After:1");
    expect(childExecutions).toBe(initialExecutions + 1);
  });

  it("cleans a nested branch subscription when its outer React block disappears", async () => {
    let setOuter: (next: CompilerStateUpdater) => void = () => undefined;
    let setInner: (next: CompilerStateUpdater) => void = () => undefined;
    let innerReads = 0;
    const Panel = createCompiledComponent({
      displayName: "NestedHostConditional",
      initialize: () => [true, true],
      render(_props: Record<string, never>, state, blocks) {
        setOuter = (next) => state[0].set(next);
        setInner = (next) => state[1].set(next);
        const Conditional = blocks.Conditional;
        const HostConditional = blocks.HostConditional;
        const readInner = () => {
          innerReads += 1;
          return Boolean(state[1].get());
        };
        return (
          <main>
            <Conditional
              id={0}
              render={() =>
                Boolean(state[0].get()) && (
                  <section>
                    <HostConditional
                      id={1}
                      render={() => (
                        <div>{readInner() ? <p>Enabled</p> : <span>Disabled</span>}</div>
                      )}
                      test={readInner}
                      truthy={{
                        create: () => ({
                          kind: "element",
                          tag: "p",
                          attributes: [],
                          styles: [],
                          children: ["Enabled"],
                        }),
                        bindings: [],
                      }}
                      falsy={{
                        create: () => ({
                          kind: "element",
                          tag: "span",
                          attributes: [],
                          styles: [],
                          children: ["Disabled"],
                        }),
                        bindings: [],
                      }}
                    />
                  </section>
                )
              }
            />
          </main>
        );
      },
      bindings: [
        { kind: "block", id: 0, dependencies: [0] },
        { kind: "block", id: 1, parent: 0, dependencies: [1] },
      ],
    });

    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<Panel />));
    await act(async () => {
      setOuter(false);
      await flushCompilerUpdates();
    });
    const readsAfterUnmount = innerReads;
    await act(async () => {
      setInner(false);
      await flushCompilerUpdates();
    });
    expect(innerReads).toBe(readsAfterUnmount);

    await act(async () => {
      setOuter(true);
      await flushCompilerUpdates();
    });
    expect(container.querySelector("span")?.textContent).toBe("Disabled");
  });

  it("hydrates in StrictMode and drops queued work after unmount", async () => {
    const errors: unknown[] = [];
    const Panel = createCompiledComponent({
      displayName: "HydratedHostConditional",
      initialize: () => [true, "Alpha"],
      render(_props: Record<string, never>, state, blocks) {
        const HostConditional = blocks.HostConditional;
        return (
          <section>
            <button onClick={() => state[1].set("Beta")}>Update</button>
            <HostConditional
              id={0}
              render={() => <div>{state[0].get() ? <p>{String(state[1].get())}</p> : null}</div>}
              test={() => state[0].get()}
              truthy={{
                create: () => ({
                  kind: "element",
                  tag: "p",
                  attributes: [],
                  styles: [],
                  children: [String(state[1].get())],
                }),
                bindings: [{ kind: "text", path: [], read: () => String(state[1].get()) }],
              }}
            />
          </section>
        );
      },
      bindings: [{ kind: "block", id: 0, dependencies: [0, 1] }],
    });

    const container = document.createElement("div");
    container.innerHTML = renderToString(
      <StrictMode>
        <Panel />
      </StrictMode>,
    );
    document.body.append(container);
    const serverBranch = container.querySelector("p")!;
    await act(async () => {
      const root = hydrateRoot(
        container,
        <StrictMode>
          <Panel />
        </StrictMode>,
        {
          onRecoverableError: (error) => errors.push(error),
        },
      );
      roots.push(root);
    });
    expect(errors).toEqual([]);
    expect(container.querySelector("p")).toBe(serverBranch);

    await act(async () => {
      container.querySelector("button")!.click();
      await flushCompilerUpdates();
    });
    expect(container.querySelector("p")).toBe(serverBranch);
    expect(serverBranch.textContent).toBe("Beta");

    const root = roots.pop()!;
    await act(async () => {
      container.querySelector("button")!.click();
      root.unmount();
      await flushCompilerUpdates();
    });
    expect(errors).toEqual([]);
  });

  it("lets React recover a hydration mismatch before adopting the branch", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const errors: unknown[] = [];
    const Panel = createCompiledComponent({
      displayName: "MismatchedHostConditional",
      initialize: () => ["Alpha"],
      render(_props: Record<string, never>, state, blocks) {
        const HostConditional = blocks.HostConditional;
        return (
          <section>
            <button onClick={() => state[0].set("Beta")}>Update</button>
            <HostConditional
              id={0}
              render={() => (
                <div>
                  <p>{String(state[0].get())}</p>
                </div>
              )}
              test={() => true}
              truthy={{
                create: () => ({
                  kind: "element",
                  tag: "p",
                  attributes: [],
                  styles: [],
                  children: [String(state[0].get())],
                }),
                bindings: [{ kind: "text", path: [], read: () => String(state[0].get()) }],
              }}
            />
          </section>
        );
      },
      bindings: [{ kind: "block", id: 0, dependencies: [0] }],
    });

    const container = document.createElement("div");
    container.innerHTML = renderToString(<Panel />).replace("<p>Alpha</p>", "<span>Wrong</span>");
    document.body.append(container);
    await act(async () => {
      const root = hydrateRoot(container, <Panel />, {
        onRecoverableError: (error) => errors.push(error),
      });
      roots.push(root);
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(container.querySelector("p")?.textContent).toBe("Alpha");

    await act(async () => {
      container.querySelector("button")!.click();
      await flushCompilerUpdates();
    });
    expect(container.querySelector("p")?.textContent).toBe("Beta");
  });

  it("creates and updates a selected option after switching to a form branch", async () => {
    let setVisible: (next: CompilerStateUpdater) => void = () => undefined;
    let setMode: (next: CompilerStateUpdater) => void = () => undefined;
    const Field = createCompiledComponent({
      displayName: "SelectHostConditional",
      initialize: () => [false, "fast"],
      render(_props: Record<string, never>, state, blocks) {
        setVisible = (next) => state[0].set(next);
        setMode = (next) => state[1].set(next);
        const HostConditional = blocks.HostConditional;
        return (
          <form>
            <HostConditional
              id={0}
              render={() => (
                <div>
                  {state[0].get() ? (
                    <select disabled value={String(state[1].get())}>
                      <option value="safe">Safe</option>
                      <option value="fast">Fast</option>
                    </select>
                  ) : (
                    <span>Hidden</span>
                  )}
                </div>
              )}
              test={() => state[0].get()}
              truthy={{
                create: () => ({
                  kind: "element",
                  tag: "select",
                  attributes: [
                    { name: "disabled", value: true },
                    { name: "value", value: state[1].get() },
                  ],
                  styles: [],
                  children: [
                    {
                      kind: "element",
                      tag: "option",
                      attributes: [{ name: "value", value: "safe" }],
                      styles: [],
                      children: ["Safe"],
                    },
                    {
                      kind: "element",
                      tag: "option",
                      attributes: [{ name: "value", value: "fast" }],
                      styles: [],
                      children: ["Fast"],
                    },
                  ],
                }),
                bindings: [
                  { kind: "attribute", path: [], name: "value", read: () => state[1].get() },
                ],
              }}
              falsy={{
                create: () => ({
                  kind: "element",
                  tag: "span",
                  attributes: [],
                  styles: [],
                  children: ["Hidden"],
                }),
                bindings: [],
              }}
            />
          </form>
        );
      },
      bindings: [{ kind: "block", id: 0, dependencies: [0, 1] }],
    });

    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<Field />));
    await act(async () => {
      setVisible(true);
      await flushCompilerUpdates();
    });
    const select = container.querySelector("select")!;
    expect(select.value).toBe("fast");
    expect(select.selectedIndex).toBe(1);

    await act(async () => {
      setMode("safe");
      await flushCompilerUpdates();
    });
    expect(container.querySelector("select")).toBe(select);
    expect(select.value).toBe("safe");
    expect(select.selectedIndex).toBe(0);
  });

  it("preserves focused input identity and selection while patching a branch", async () => {
    let setValue: (next: CompilerStateUpdater) => void = () => undefined;
    const Field = createCompiledComponent({
      displayName: "FocusedHostConditional",
      initialize: () => [true, "Alpha"],
      render(_props: Record<string, never>, state, blocks) {
        setValue = (next) => state[1].set(next);
        const HostConditional = blocks.HostConditional;
        return (
          <form>
            <HostConditional
              id={0}
              render={() => (
                <div>
                  {state[0].get() ? <input readOnly value={String(state[1].get())} /> : null}
                </div>
              )}
              test={() => state[0].get()}
              truthy={{
                create: () => ({
                  kind: "element",
                  tag: "input",
                  attributes: [
                    { name: "readOnly", value: true },
                    { name: "value", value: state[1].get() },
                  ],
                  styles: [],
                  children: [],
                }),
                bindings: [
                  { kind: "attribute", path: [], name: "value", read: () => state[1].get() },
                ],
              }}
            />
          </form>
        );
      },
      bindings: [{ kind: "block", id: 0, dependencies: [0, 1] }],
    });

    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<Field />));
    const input = container.querySelector("input")!;
    input.focus();
    input.setSelectionRange(1, 4, "forward");
    await act(async () => {
      setValue("Alpine");
      await flushCompilerUpdates();
    });
    expect(container.querySelector("input")).toBe(input);
    expect(input.value).toBe("Alpine");
    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([1, 4]);
  });

  it("preserves state and branch identity through a compatible Fast Refresh", async () => {
    const hmrId = `host-conditional-refresh-${Math.random()}`;
    const definition = (prefix: string): CompiledComponentDefinition<Record<string, never>> => ({
      displayName: "RefreshHostConditional",
      hmrId,
      stateSignature: "1",
      initialize: () => ["Alpha"],
      render(_props, state, blocks) {
        const HostConditional = blocks.HostConditional;
        return (
          <section>
            <button onClick={() => state[0].set("Updated")}>Update</button>
            <HostConditional
              id={0}
              render={() => (
                <div>
                  <p>
                    {prefix}
                    {String(state[0].get())}
                  </p>
                </div>
              )}
              test={() => true}
              truthy={{
                create: () => ({
                  kind: "element",
                  tag: "p",
                  attributes: [],
                  styles: [],
                  children: [[prefix, state[0].get()]],
                }),
                bindings: [{ kind: "text", path: [], read: () => [prefix, state[0].get()] }],
              }}
            />
          </section>
        );
      },
      bindings: [{ kind: "block", id: 0, dependencies: [0] }],
    });

    const Initial = createCompiledComponent(definition("Before: "));
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<Initial />));
    const branch = container.querySelector("p")!;
    await act(async () => {
      const Updated = createCompiledComponent(definition("After: "));
      expect(Updated).toBe(Initial);
      await flushCompilerUpdates();
    });
    await flushCompilerUpdates();
    expect(container.querySelector("p")).toBe(branch);
    expect(branch.textContent).toBe("After: Alpha");

    await act(async () => {
      container.querySelector("button")!.click();
      await flushCompilerUpdates();
    });
    expect(container.querySelector("p")).toBe(branch);
    expect(branch.textContent).toBe("After: Updated");
  });

  it("routes binding failures through the nearest React error boundary", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    class Boundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
      state = { failed: false };
      static getDerivedStateFromError() {
        return { failed: true };
      }
      render() {
        return this.state.failed ? <p>Recovered by boundary</p> : this.props.children;
      }
    }
    const Panel = createCompiledComponent({
      displayName: "ThrowingHostConditional",
      initialize: () => [0],
      render(_props: Record<string, never>, state, blocks) {
        const read = () => {
          const value = Number(state[0].get());
          if (value > 0) throw new Error("broken conditional binding");
          return value;
        };
        const HostConditional = blocks.HostConditional;
        return (
          <section>
            <button onClick={() => state[0].set(1)}>Break</button>
            <HostConditional
              id={0}
              render={() => (
                <div>
                  <p>{read()}</p>
                </div>
              )}
              test={() => true}
              truthy={{
                create: () => ({
                  kind: "element",
                  tag: "p",
                  attributes: [],
                  styles: [],
                  children: [read()],
                }),
                bindings: [{ kind: "text", path: [], read }],
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
    await act(async () =>
      root.render(
        <Boundary>
          <Panel />
        </Boundary>,
      ),
    );
    await act(async () => {
      container.querySelector("button")!.click();
      await flushCompilerUpdates();
    });
    expect(container.textContent).toBe("Recovered by boundary");
  });

  it("matches React across 3,000 deterministic randomized branch transitions", async () => {
    interface Model {
      visible: boolean;
      count: number;
      label: string | null;
      active: boolean;
    }
    let setCompiled: (next: CompilerStateUpdater) => void = () => undefined;
    let setReact: React.Dispatch<React.SetStateAction<Model>> = () => undefined;
    let compiledExecutions = 0;
    const initial: Model = { visible: true, count: 0, label: null, active: false };
    const Compiled = createCompiledComponent({
      displayName: "RandomHostConditional",
      initialize: () => [initial],
      render(_props: Record<string, never>, state, blocks) {
        compiledExecutions += 1;
        setCompiled = (next) => state[0].set(next);
        const model = () => state[0].get() as Model;
        const HostConditional = blocks.HostConditional;
        return (
          <section data-version="compiled">
            <HostConditional
              id={0}
              render={() => (
                <div>
                  {model().visible ? (
                    <strong
                      className={model().active ? "active" : "idle"}
                      data-count={model().count}
                    >
                      {model().label ?? "none"}:{model().count}
                    </strong>
                  ) : (
                    <span data-count={model().count}>hidden:{model().label ?? "none"}</span>
                  )}
                </div>
              )}
              test={() => model().visible}
              truthy={{
                create: () => ({
                  kind: "element",
                  tag: "strong",
                  attributes: [
                    { name: "className", value: model().active ? "active" : "idle" },
                    { name: "data-count", value: model().count },
                  ],
                  styles: [],
                  children: [[model().label ?? "none", ":", model().count]],
                }),
                bindings: [
                  {
                    kind: "attribute",
                    path: [],
                    name: "className",
                    read: () => (model().active ? "active" : "idle"),
                  },
                  { kind: "attribute", path: [], name: "data-count", read: () => model().count },
                  {
                    kind: "text",
                    path: [],
                    read: () => [model().label ?? "none", ":", model().count],
                  },
                ],
              }}
              falsy={{
                create: () => ({
                  kind: "element",
                  tag: "span",
                  attributes: [{ name: "data-count", value: model().count }],
                  styles: [],
                  children: [["hidden:", model().label ?? "none"]],
                }),
                bindings: [
                  { kind: "attribute", path: [], name: "data-count", read: () => model().count },
                  { kind: "text", path: [], read: () => ["hidden:", model().label ?? "none"] },
                ],
              }}
            />
          </section>
        );
      },
      bindings: [{ kind: "block", id: 0, dependencies: [0] }],
    });
    function Normal() {
      const [model, update] = useState(initial);
      setReact = update;
      return (
        <section data-version="react">
          <div>
            {model.visible ? (
              <strong className={model.active ? "active" : "idle"} data-count={model.count}>
                {model.label ?? "none"}:{model.count}
              </strong>
            ) : (
              <span data-count={model.count}>hidden:{model.label ?? "none"}</span>
            )}
          </div>
        </section>
      );
    }

    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () =>
      root.render(
        <>
          <Compiled />
          <Normal />
        </>,
      ),
    );
    let seed = 0x5eed1234;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed;
    };
    let model = initial;
    for (let index = 0; index < 3000; index += 1) {
      const value = random();
      model = {
        visible: (value & 1) === 0,
        count: value % 97,
        label: value % 5 === 0 ? null : `item-${value % 31}`,
        active: (value & 4) !== 0,
      };
      const next = model;
      await act(async () => {
        setCompiled(next);
        setReact(next);
        await flushCompilerUpdates();
      });
      const compiled = container.querySelector("[data-version='compiled'] > div")!;
      const normal = container.querySelector("[data-version='react'] > div")!;
      expect(compiled.innerHTML).toBe(normal.innerHTML);
    }
    expect(compiledExecutions).toBe(1);
  }, 30_000);
});
