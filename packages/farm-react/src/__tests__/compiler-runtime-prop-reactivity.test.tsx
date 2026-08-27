import React, { startTransition, StrictMode, Suspense, useState } from "react";
import { act } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCompiledComponent } from "../compiler-runtime";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const roots = new Set<Root>();

function trackRoot(root: Root): Root {
  roots.add(root);
  return root;
}

async function flushCompilerUpdates(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  await act(async () => {
    for (const root of roots) root.unmount();
  });
  roots.clear();
  document.body.replaceChildren();
});

describe("compiled primitive prop reactivity", () => {
  it("patches text, attributes, styles, and controlled values without rerunning the render plan", async () => {
    interface Props {
      active: boolean;
      label: string;
      width: number;
    }

    let renderPlans = 0;
    let updateParent: React.Dispatch<React.SetStateAction<Props>> = () => undefined;
    const Counter = createCompiledComponent<Props>({
      displayName: "PrimitivePropCounter",
      initialize: () => [0],
      readProps: (props) => [props.label, props.active, props.width],
      render(_props, state) {
        renderPlans += 1;
        return (
          <section data-active={state[2].get()} style={{ width: Number(state[3].get()) }}>
            <button onClick={() => state[0].set((value) => Number(value) + 1)}>Local</button>
            <output>
              {String(state[1].get())}:{Number(state[0].get())}
            </output>
            <input value={String(state[1].get())} onChange={() => undefined} />
          </section>
        );
      },
      bindings: [
        {
          kind: "attribute",
          path: [],
          name: "data-active",
          dependencies: [2],
          read: (_p, state) => state[2].get(),
        },
        {
          kind: "style",
          path: [],
          name: "width",
          dependencies: [3],
          read: (_p, state) => state[3].get(),
        },
        {
          kind: "text",
          path: [1],
          dependencies: [0, 1],
          read: (_p, state) => [state[1].get(), ":", state[0].get()],
        },
        {
          kind: "attribute",
          path: [2],
          name: "value",
          dependencies: [1],
          read: (_p, state) => state[1].get(),
        },
      ],
    });

    function Parent() {
      const [props, setProps] = useState<Props>({ active: false, label: "before", width: 120 });
      updateParent = setProps;
      return <Counter {...props} />;
    }

    const container = document.createElement("div");
    document.body.append(container);
    const root = trackRoot(createRoot(container));
    await act(async () => root.render(<Parent />));
    const initialRenderPlans = renderPlans;
    const section = container.querySelector("section");
    const input = container.querySelector("input")!;
    input.focus();
    input.setSelectionRange(2, 4);

    await act(async () => {
      updateParent({ active: true, label: "after", width: 240 });
      await flushCompilerUpdates();
    });

    expect(renderPlans).toBe(initialRenderPlans);
    expect(container.querySelector("section")).toBe(section);
    expect(container.querySelector("input")).toBe(input);
    expect(section?.getAttribute("data-active")).toBe("true");
    expect((section as HTMLElement).style.width).toBe("240px");
    expect(container.querySelector("output")?.textContent).toBe("after:0");
    expect(input.value).toBe("after");
    expect(input.selectionStart).toBe(2);
    expect(input.selectionEnd).toBe(4);

    await act(async () => {
      container.querySelector("button")!.click();
      updateParent((current) => ({ ...current, label: "together" }));
      await flushCompilerUpdates();
    });

    expect(container.querySelector("output")?.textContent).toBe("together:1");
    expect(renderPlans).toBe(initialRenderPlans);
  });

  it("updates a prop-driven host conditional without rerunning its owner plan", async () => {
    interface Props {
      enabled: boolean;
      label: string;
    }

    let renderPlans = 0;
    let updateParent: React.Dispatch<React.SetStateAction<Props>> = () => undefined;
    const Conditional = createCompiledComponent<Props>({
      displayName: "PropConditional",
      initialize: () => [0],
      readProps: (props) => [props.enabled, props.label],
      render(_props, state, blocks) {
        renderPlans += 1;
        const HostConditional = blocks.HostConditional;
        return (
          <article>
            <HostConditional
              id={0}
              render={() => (
                <div>
                  {state[1].get() ? <strong>{String(state[2].get())}</strong> : <span>Off</span>}
                </div>
              )}
              test={() => state[1].get()}
              truthy={{
                create: () => ({
                  kind: "element",
                  tag: "strong",
                  attributes: [],
                  styles: [],
                  children: [state[2].get()],
                }),
                bindings: [{ kind: "text", path: [], read: () => state[2].get() }],
              }}
              falsy={{
                create: () => ({
                  kind: "element",
                  tag: "span",
                  attributes: [],
                  styles: [],
                  children: ["Off"],
                }),
                bindings: [],
              }}
            />
          </article>
        );
      },
      bindings: [{ kind: "block", id: 0, dependencies: [1, 2] }],
    });

    function Parent() {
      const [props, setProps] = useState<Props>({ enabled: false, label: "Before" });
      updateParent = setProps;
      return <Conditional {...props} />;
    }

    const container = document.createElement("div");
    document.body.append(container);
    const root = trackRoot(createRoot(container));
    await act(async () => root.render(<Parent />));
    const initialRenderPlans = renderPlans;

    await act(async () => {
      updateParent({ enabled: true, label: "After" });
      await flushCompilerUpdates();
    });
    await flushCompilerUpdates();

    expect(container.querySelector("strong")?.textContent).toBe("After");
    expect(renderPlans).toBe(initialRenderPlans);

    await act(async () => {
      updateParent({ enabled: false, label: "Hidden" });
      await flushCompilerUpdates();
    });
    expect(container.querySelector("span")?.textContent).toBe("Off");
    expect(renderPlans).toBe(initialRenderPlans);
  });

  it("falls back to a full React render for object and function prop identities", async () => {
    interface Props {
      format(value: string): string;
      item: { label: string };
    }

    let renderPlans = 0;
    let updateParent: React.Dispatch<React.SetStateAction<Props>> = () => undefined;
    const IdentityProps = createCompiledComponent<Props>({
      displayName: "IdentityProps",
      initialize: () => [0],
      readProps: (props) => [props.item, props.format],
      render(_props, state) {
        renderPlans += 1;
        const item = state[1].get() as Props["item"];
        const format = state[2].get() as Props["format"];
        return <output>{format(item.label)}</output>;
      },
      bindings: [
        {
          kind: "text",
          path: [],
          dependencies: [1, 2],
          read: (_props, state) => {
            const item = state[1].get() as Props["item"];
            const format = state[2].get() as Props["format"];
            return format(item.label);
          },
        },
      ],
    });

    function Parent() {
      const [props, setProps] = useState<Props>({
        item: { label: "one" },
        format: (value) => value.toUpperCase(),
      });
      updateParent = setProps;
      return <IdentityProps {...props} />;
    }

    const container = document.createElement("div");
    document.body.append(container);
    const root = trackRoot(createRoot(container));
    await act(async () => root.render(<Parent />));
    const initialRenderPlans = renderPlans;

    await act(async () => {
      updateParent({ item: { label: "two" }, format: (value) => `[${value}]` });
      await flushCompilerUpdates();
    });

    expect(container.textContent).toBe("[two]");
    expect(renderPlans).toBe(initialRenderPlans + 1);
  });

  it("keeps identity-value snapshots coherent inside nested compiled blocks", async () => {
    interface Model {
      label: string;
      visible: boolean;
    }
    interface Props {
      model: Model;
    }

    let updateParent: React.Dispatch<React.SetStateAction<Model>> = () => undefined;
    const NestedIdentity = createCompiledComponent<Props>({
      displayName: "NestedIdentityProps",
      initialize: () => [0],
      readProps: (props) => [props.model],
      render(_props, state, blocks) {
        const HostConditional = blocks.HostConditional;
        return (
          <article>
            <HostConditional
              id={0}
              render={() => {
                const model = state[1].get() as Model;
                return (
                  <div>{model.visible ? <strong>{model.label}</strong> : <span>Hidden</span>}</div>
                );
              }}
              test={() => (state[1].get() as Model).visible}
              truthy={{
                create: () => ({
                  kind: "element",
                  tag: "strong",
                  attributes: [],
                  styles: [],
                  children: [(state[1].get() as Model).label],
                }),
                bindings: [
                  {
                    kind: "text",
                    path: [],
                    read: () => (state[1].get() as Model).label,
                  },
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
          </article>
        );
      },
      bindings: [{ kind: "block", id: 0, dependencies: [1] }],
    });

    function Parent() {
      const [model, setModel] = useState<Model>({ label: "Before", visible: false });
      updateParent = setModel;
      return <NestedIdentity model={model} />;
    }

    const container = document.createElement("div");
    document.body.append(container);
    const root = trackRoot(createRoot(container));
    await act(async () => root.render(<Parent />));

    await act(async () => {
      updateParent({ label: "After", visible: true });
      await flushCompilerUpdates();
    });

    expect(container.querySelector("strong")?.textContent).toBe("After");
    expect(container.querySelector("span")).toBeNull();
  });

  it("does not cache an abandoned concurrent prop render", async () => {
    type Value = string | { label: string };
    interface Props {
      value: Value;
    }

    let setValue: React.Dispatch<React.SetStateAction<Value>> = () => undefined;
    let releaseSuspension = () => undefined;
    const suspension = new Promise<void>((resolve) => {
      releaseSuspension = resolve;
    });

    function Suspender({ active }: { active: boolean }) {
      if (active) throw suspension;
      return null;
    }

    const ConcurrentValue = createCompiledComponent<Props>({
      displayName: "ConcurrentPrimitiveProp",
      initialize: () => [0],
      readProps: (props) => [props.value],
      render(_props, state) {
        const value = state[1].get() as Value;
        return (
          <section>
            <output>{typeof value === "string" ? value : value.label}</output>
            <Suspender active={typeof value === "object"} />
          </section>
        );
      },
      bindings: [
        {
          kind: "text",
          path: [0],
          dependencies: [1],
          read: (_props, state) => {
            const value = state[1].get() as Value;
            return typeof value === "string" ? value : value.label;
          },
        },
      ],
    });

    function Parent() {
      const [value, updateValue] = useState<Value>("before");
      setValue = updateValue;
      return (
        <Suspense fallback={<p>Loading</p>}>
          <ConcurrentValue value={value} />
        </Suspense>
      );
    }

    const container = document.createElement("div");
    document.body.append(container);
    const root = trackRoot(createRoot(container));
    await act(async () => root.render(<Parent />));

    await act(async () => {
      startTransition(() => setValue({ label: "abandoned" }));
      await Promise.resolve();
    });
    expect(container.textContent).toBe("before");

    await act(async () => {
      setValue("after");
      await flushCompilerUpdates();
    });
    expect(container.textContent).toBe("after");
    expect(container.querySelector("p")).toBeNull();

    await act(async () => releaseSuspension());
  });

  it("matches React through deterministic primitive and nullish prop transitions", async () => {
    type Value = string | number | boolean | null | undefined;
    interface Props {
      value: Value;
    }

    let compiledPlans = 0;
    let setCompiled: React.Dispatch<React.SetStateAction<Value>> = () => undefined;
    let setBaseline: React.Dispatch<React.SetStateAction<Value>> = () => undefined;
    const CompiledValue = createCompiledComponent<Props>({
      displayName: "RandomPrimitiveProps",
      initialize: () => [0],
      readProps: (props) => [props.value],
      render(_props, state) {
        compiledPlans += 1;
        return <output>{String(state[1].get())}</output>;
      },
      bindings: [
        { kind: "text", path: [], dependencies: [1], read: (_p, state) => String(state[1].get()) },
      ],
    });
    function CompiledParent() {
      const [value, setValue] = useState<Value>(null);
      setCompiled = setValue;
      return <CompiledValue value={value} />;
    }
    function BaselineParent() {
      const [value, setValue] = useState<Value>(null);
      setBaseline = setValue;
      return <output>{String(value)}</output>;
    }

    const compiledContainer = document.createElement("div");
    const baselineContainer = document.createElement("div");
    document.body.append(compiledContainer, baselineContainer);
    const compiledRoot = trackRoot(createRoot(compiledContainer));
    const baselineRoot = trackRoot(createRoot(baselineContainer));
    await act(async () => {
      compiledRoot.render(
        <StrictMode>
          <CompiledParent />
        </StrictMode>,
      );
      baselineRoot.render(<BaselineParent />);
    });
    const initialPlans = compiledPlans;
    const values: Value[] = [undefined, "", "farm", 0, -1, 42.5, false, true, null];

    for (let index = 0; index < 256; index += 1) {
      const next = values[(index * 17 + 5) % values.length];
      await act(async () => {
        setCompiled(next);
        setBaseline(next);
        await flushCompilerUpdates();
      });
      expect(compiledContainer.textContent).toBe(baselineContainer.textContent);
    }

    expect(compiledPlans).toBe(initialPlans);
  });

  it("hydrates first and preserves the primitive prop path afterward", async () => {
    interface Props {
      label: string;
    }
    let renderPlans = 0;
    const Hydrated = createCompiledComponent<Props>({
      displayName: "HydratedPrimitiveProp",
      initialize: () => [0],
      readProps: (props) => [props.label],
      render(_props, state) {
        renderPlans += 1;
        return <output>{String(state[1].get())}</output>;
      },
      bindings: [
        { kind: "text", path: [], dependencies: [1], read: (_p, state) => state[1].get() },
      ],
    });
    const container = document.createElement("div");
    container.innerHTML = renderToString(<Hydrated label="server" />);
    document.body.append(container);
    let updateParent: React.Dispatch<React.SetStateAction<string>> = () => undefined;
    function Parent() {
      const [label, setLabel] = useState("server");
      updateParent = setLabel;
      return <Hydrated label={label} />;
    }

    let root!: Root;
    await act(async () => {
      root = hydrateRoot(container, <Parent />);
      await flushCompilerUpdates();
    });
    trackRoot(root);
    const hydratedPlans = renderPlans;
    await act(async () => {
      updateParent("client");
      await flushCompilerUpdates();
    });

    expect(container.textContent).toBe("client");
    expect(renderPlans).toBe(hydratedPlans);
  });
});
