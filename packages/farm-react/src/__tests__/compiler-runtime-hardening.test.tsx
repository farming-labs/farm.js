import React, { StrictMode, useState, type ReactNode } from "react";
import { act } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCompiledComponent, type CompiledComponentDefinition } from "../compiler-runtime";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const roots = new Set<Root>();

function trackRoot(root: Root): Root {
  roots.add(root);
  return root;
}

async function flushCompilerUpdates() {
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
  vi.restoreAllMocks();
});

function counterDefinition(
  displayName: string,
  prefix = "Count: ",
): CompiledComponentDefinition<Record<string, never>> {
  return {
    displayName,
    initialize: () => [0],
    render(_props, state) {
      return (
        <button onClick={() => state[0].set((value) => Number(value) + 1)}>
          {prefix}
          {Number(state[0].get())}
        </button>
      );
    },
    bindings: [
      {
        kind: "text",
        path: [],
        dependencies: [0],
        read: (_props, state) => [prefix, state[0].get()],
      },
    ],
  };
}

describe("compiled React runtime hardening", () => {
  it("survives the StrictMode development mount cycle without rerendering on a local update", async () => {
    let renders = 0;
    const definition = counterDefinition("StrictCounter");
    const Counter = createCompiledComponent({
      ...definition,
      render(props, state) {
        renders += 1;
        return definition.render(props, state);
      },
    });
    const container = document.createElement("div");
    document.body.append(container);
    const root = trackRoot(createRoot(container));

    await act(async () => {
      root.render(
        <StrictMode>
          <Counter />
        </StrictMode>,
      );
    });
    const initialRenders = renders;

    await act(async () => {
      container.querySelector("button")!.click();
      await flushCompilerUpdates();
    });

    expect(container.textContent).toBe("Count: 1");
    expect(renders).toBe(initialRenders);
  });

  it("drops a queued binding flush when the component unmounts first", async () => {
    let bindingReads = 0;
    const definition = counterDefinition("UnmountedCounter");
    const Counter = createCompiledComponent({
      ...definition,
      bindings: definition.bindings.map((binding) => ({
        ...binding,
        read(props, state) {
          bindingReads += 1;
          return binding.read(props, state);
        },
      })),
    });
    const container = document.createElement("div");
    document.body.append(container);
    const root = trackRoot(createRoot(container));
    await act(async () => root.render(<Counter />));

    await act(async () => {
      container.querySelector("button")!.click();
      root.unmount();
      roots.delete(root);
      await flushCompilerUpdates();
    });

    expect(container.textContent).toBe("");
    expect(bindingReads).toBe(0);
  });

  it("keeps parent props and compiler-local state coherent when both update in one event", async () => {
    interface Props {
      label: string;
      updateParent(): void;
    }

    const Counter = createCompiledComponent<Props>({
      displayName: "ParentAndLocalCounter",
      initialize: () => [0],
      render(props, state) {
        return (
          <button
            onClick={() => {
              state[0].set((value) => Number(value) + 1);
              props.updateParent();
            }}
          >
            {props.label}:{Number(state[0].get())}
          </button>
        );
      },
      bindings: [
        {
          kind: "text",
          path: [],
          dependencies: [0],
          read: (props, state) => [props.label, ":", state[0].get()],
        },
      ],
    });

    function Parent() {
      const [label, setLabel] = useState("before");
      return <Counter label={label} updateParent={() => setLabel("after")} />;
    }

    const container = document.createElement("div");
    document.body.append(container);
    const root = trackRoot(createRoot(container));
    await act(async () => root.render(<Parent />));

    await act(async () => {
      container.querySelector("button")!.click();
      await flushCompilerUpdates();
    });

    expect(container.textContent).toBe("after:1");
  });

  it("batches setter calls from nested and bubbled event handlers", async () => {
    const BubblingCounter = createCompiledComponent({
      displayName: "BubblingCounter",
      initialize: () => [0],
      render(_props: Record<string, never>, state) {
        return (
          <section onClick={() => state[0].set((value) => Number(value) + 1)}>
            <button onClick={() => state[0].set((value) => Number(value) + 1)}>Update</button>
            <output>{Number(state[0].get())}</output>
          </section>
        );
      },
      bindings: [
        {
          kind: "text",
          path: [1],
          dependencies: [0],
          read: (_props, state) => state[0].get(),
        },
      ],
    });
    const container = document.createElement("div");
    document.body.append(container);
    const root = trackRoot(createRoot(container));
    await act(async () => root.render(<BubblingCounter />));

    await act(async () => {
      container.querySelector("button")!.click();
      await flushCompilerUpdates();
    });

    expect(container.querySelector("output")?.textContent).toBe("2");
  });

  it("preserves compiled row state when a React-owned keyed list reorders", async () => {
    interface Item {
      id: string;
      name: string;
    }

    const Row = createCompiledComponent<{ item: Item }>({
      displayName: "CompiledKeyedRow",
      initialize: () => [0],
      render(props, state) {
        return (
          <li>
            <button onClick={() => state[0].set((value) => Number(value) + 1)}>
              {props.item.name}:{Number(state[0].get())}
            </button>
          </li>
        );
      },
      bindings: [
        {
          kind: "text",
          path: [0],
          dependencies: [0],
          read: (props, state) => [props.item.name, ":", state[0].get()],
        },
      ],
    });

    function List() {
      const [items, setItems] = useState<Item[]>([
        { id: "a", name: "A" },
        { id: "b", name: "B" },
      ]);
      return (
        <section>
          <button onClick={() => setItems((current) => [...current].reverse())}>Reverse</button>
          <ul>
            {items.map((item) => (
              <Row key={item.id} item={item} />
            ))}
          </ul>
        </section>
      );
    }

    const container = document.createElement("div");
    document.body.append(container);
    const root = trackRoot(createRoot(container));
    await act(async () => root.render(<List />));
    const buttons = () => [...container.querySelectorAll("li button")];

    await act(async () => {
      buttons()[0].click();
      await flushCompilerUpdates();
    });
    expect(buttons().map((button) => button.textContent)).toEqual(["A:1", "B:0"]);

    await act(async () => container.querySelector("section > button")!.click());
    expect(buttons().map((button) => button.textContent)).toEqual(["B:0", "A:1"]);
  });

  it("preserves controlled input selection and composition-driven values", async () => {
    const ControlledInput = createCompiledComponent({
      displayName: "ControlledInput",
      initialize: () => ["", false],
      render(_props: Record<string, never>, state) {
        return (
          <input
            data-composing={Boolean(state[1].get())}
            onCompositionEnd={() => state[1].set(false)}
            onCompositionStart={() => state[1].set(true)}
            onInput={(event) => state[0].set(event.currentTarget.value)}
            value={String(state[0].get())}
          />
        );
      },
      bindings: [
        {
          kind: "attribute",
          path: [],
          dependencies: [0],
          name: "value",
          read: (_props, state) => state[0].get(),
        },
        {
          kind: "attribute",
          path: [],
          dependencies: [1],
          name: "data-composing",
          read: (_props, state) => Boolean(state[1].get()),
        },
      ],
    });
    const container = document.createElement("div");
    document.body.append(container);
    const root = trackRoot(createRoot(container));
    await act(async () => root.render(<ControlledInput />));
    const input = container.querySelector("input")!;

    await act(async () => {
      input.dispatchEvent(new Event("compositionstart", { bubbles: true }));
      input.value = "farm";
      input.setSelectionRange(4, 4);
      input.dispatchEvent(new InputEvent("input", { bubbles: true, data: "farm" }));
      await flushCompilerUpdates();
    });

    expect(input.value).toBe("farm");
    expect(input.selectionStart).toBe(4);
    expect(input.getAttribute("data-composing")).toBe("true");

    await act(async () => {
      input.focus();
      input.value = "faXrm";
      input.setSelectionRange(3, 3);
      input.dispatchEvent(new InputEvent("input", { bubbles: true, data: "X" }));
      // Model React's controlled-input restoration before the compiler's
      // queued binding flush. The runtime must restore the event-time caret.
      input.value = "";
      await flushCompilerUpdates();
    });
    expect(input.value).toBe("faXrm");
    expect(input.selectionStart).toBe(3);
    expect(input.selectionEnd).toBe(3);

    await act(async () => {
      input.dispatchEvent(new Event("compositionend", { bubbles: true }));
      await flushCompilerUpdates();
    });
    expect(input.getAttribute("data-composing")).toBe("false");
  });

  it("preserves state across a compatible Fast Refresh definition update", async () => {
    const hmrId = `hardening-refresh-${Math.random()}`;
    const InitialCounter = createCompiledComponent({
      ...counterDefinition("RefreshCounter", "Before: "),
      hmrId,
      stateSignature: "1",
    });
    const container = document.createElement("div");
    document.body.append(container);
    const root = trackRoot(createRoot(container));
    await act(async () => root.render(<InitialCounter />));
    await act(async () => {
      container.querySelector("button")!.click();
      await flushCompilerUpdates();
    });

    let UpdatedCounter!: typeof InitialCounter;
    await act(async () => {
      UpdatedCounter = createCompiledComponent({
        ...counterDefinition("RefreshCounter", "After: "),
        hmrId,
        stateSignature: "1",
      });
    });
    expect(UpdatedCounter).toBe(InitialCounter);
    expect(container.textContent).toBe("After: 1");

    await act(async () => {
      container.querySelector("button")!.click();
      await flushCompilerUpdates();
    });
    expect(container.textContent).toBe("After: 2");
  });

  it("recovers from hydration mismatches and remains interactive", async () => {
    const Counter = createCompiledComponent(counterDefinition("HydrationMismatchCounter"));
    const container = document.createElement("div");
    container.innerHTML = renderToString(<Counter />).replace("Count: ", "Wrong: ");
    document.body.append(container);
    const recoverableErrors: unknown[] = [];
    let root!: Root;

    await act(async () => {
      root = hydrateRoot(container, <Counter />, {
        onRecoverableError(error) {
          recoverableErrors.push(error);
        },
      });
      await flushCompilerUpdates();
    });
    trackRoot(root);

    expect(recoverableErrors.length).toBeGreaterThan(0);
    expect(container.textContent).toBe("Count: 0");
    await act(async () => {
      container.querySelector("button")!.click();
      await flushCompilerUpdates();
    });
    expect(container.textContent).toBe("Count: 1");
  });

  it("routes binding failures through the nearest React error boundary", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    class Boundary extends React.Component<{ children: ReactNode }, { failed: boolean }> {
      state = { failed: false };

      static getDerivedStateFromError() {
        return { failed: true };
      }

      render() {
        return this.state.failed ? <p>Recovered by boundary</p> : this.props.children;
      }
    }

    const ThrowingBinding = createCompiledComponent({
      displayName: "ThrowingBinding",
      initialize: () => [false],
      render(_props: Record<string, never>, state) {
        return <button onClick={() => state[0].set(true)}>Safe</button>;
      },
      bindings: [
        {
          kind: "text",
          path: [],
          dependencies: [0],
          read: () => {
            throw new Error("binding failed");
          },
        },
      ],
    });
    const container = document.createElement("div");
    document.body.append(container);
    const root = trackRoot(createRoot(container));
    await act(async () =>
      root.render(
        <Boundary>
          <ThrowingBinding />
        </Boundary>,
      ),
    );

    await act(async () => {
      container.querySelector("button")!.click();
      await flushCompilerUpdates();
    });

    expect(container.textContent).toBe("Recovered by boundary");
  });

  it("updates object, array, and nullish state cells", async () => {
    const StructuredState = createCompiledComponent({
      displayName: "StructuredState",
      initialize: () => [{ count: 0 }, [1], null],
      render(_props: Record<string, never>, state) {
        const object = state[0].get() as { count: number };
        const array = state[1].get() as number[];
        const nullable = state[2].get() as string | null;
        return (
          <section>
            <button onClick={() => state[0].set({ count: object.count + 1 })}>Object</button>
            <button onClick={() => state[1].set((value) => [...(value as number[]), 2])}>
              Array
            </button>
            <button onClick={() => state[2].set(nullable === null ? "ready" : null)}>Null</button>
            <output>
              {object.count}|{array.join(",")}|{nullable ?? "null"}
            </output>
          </section>
        );
      },
      bindings: [
        {
          kind: "text",
          path: [3],
          dependencies: [0, 1, 2],
          read: (_props, state) => {
            const object = state[0].get() as { count: number };
            const array = state[1].get() as number[];
            const nullable = state[2].get() as string | null;
            return [object.count, "|", array.join(","), "|", nullable ?? "null"];
          },
        },
      ],
    });
    const container = document.createElement("div");
    document.body.append(container);
    const root = trackRoot(createRoot(container));
    await act(async () => root.render(<StructuredState />));

    await act(async () => {
      for (const button of container.querySelectorAll("button")) button.click();
      await flushCompilerUpdates();
    });

    expect(container.querySelector("output")?.textContent).toBe("1|1,2|ready");
  });
});

type RandomValue = number | null | { count: number } | number[];

interface RandomOperation {
  amount: number;
  kind: "array" | "increment" | "null" | "object";
}

function applyRandomOperation(value: RandomValue, operation: RandomOperation): RandomValue {
  if (operation.kind === "null") return null;
  if (operation.kind === "array") {
    const array = Array.isArray(value) ? value : [];
    return [...array.slice(-4), operation.amount];
  }
  const numericValue =
    typeof value === "number"
      ? value
      : value && !Array.isArray(value)
        ? value.count
        : Array.isArray(value)
          ? (value.at(-1) ?? 0)
          : 0;
  if (operation.kind === "object") return { count: numericValue + operation.amount };
  return numericValue + operation.amount;
}

function serializeRandomValue(value: RandomValue): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `array:${value.join(",")}`;
  if (typeof value === "object") return `object:${value.count}`;
  return `number:${value}`;
}

function createRandomOperations(count: number): RandomOperation[] {
  let seed = 0x1a2b3c4d;
  const operations: RandomOperation[] = [];
  const kinds: RandomOperation["kind"][] = ["increment", "object", "array", "null"];
  for (let index = 0; index < count; index += 1) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    operations.push({
      amount: (seed % 7) - 3,
      kind: kinds[(seed >>> 8) % kinds.length],
    });
  }
  return operations;
}

describe("compiled-vs-React differential behavior", () => {
  it("matches React across 3,000 deterministic randomized state transitions", async () => {
    const operations = createRandomOperations(3000);
    const compiledOperations = [...operations];
    const reactOperations = [...operations];
    let compiledRenders = 0;
    let reactRenders = 0;

    const CompiledRandomState = createCompiledComponent({
      displayName: "CompiledRandomState",
      initialize: () => [0],
      render(_props: Record<string, never>, state) {
        compiledRenders += 1;
        return (
          <button
            onClick={() => {
              const operation = compiledOperations.shift();
              if (operation) {
                state[0].set((value) => applyRandomOperation(value as RandomValue, operation));
              }
            }}
          >
            {serializeRandomValue(state[0].get() as RandomValue)}
          </button>
        );
      },
      bindings: [
        {
          kind: "text",
          path: [],
          dependencies: [0],
          read: (_props, state) => serializeRandomValue(state[0].get() as RandomValue),
        },
      ],
    });

    function ReactRandomState() {
      reactRenders += 1;
      const [value, setValue] = useState<RandomValue>(0);
      return (
        <button
          onClick={() => {
            const operation = reactOperations.shift();
            if (operation) setValue((current) => applyRandomOperation(current, operation));
          }}
        >
          {serializeRandomValue(value)}
        </button>
      );
    }

    const compiledContainer = document.createElement("div");
    const reactContainer = document.createElement("div");
    document.body.append(compiledContainer, reactContainer);
    const compiledRoot = trackRoot(createRoot(compiledContainer));
    const reactRoot = trackRoot(createRoot(reactContainer));
    await act(async () => {
      compiledRoot.render(<CompiledRandomState />);
      reactRoot.render(<ReactRandomState />);
    });
    const compiledButton = compiledContainer.querySelector("button")!;
    const reactButton = reactContainer.querySelector("button")!;

    for (let batch = 0; batch < 60; batch += 1) {
      await act(async () => {
        for (let update = 0; update < 50; update += 1) {
          compiledButton.click();
          reactButton.click();
        }
        await flushCompilerUpdates();
      });
      expect(compiledButton.textContent).toBe(reactButton.textContent);
    }

    expect(compiledOperations).toHaveLength(0);
    expect(reactOperations).toHaveLength(0);
    expect(compiledRenders).toBe(1);
    expect(reactRenders).toBeGreaterThan(1);
  });
});
