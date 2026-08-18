import React, {
  StrictMode,
  createContext,
  memo,
  useContext,
  useState,
  type ReactNode,
} from "react";
import { act } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCompiledComponent, type CompilerStateUpdater } from "../compiler-runtime";

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

function trackRoot(root: Root): Root {
  roots.push(root);
  return root;
}

describe("compiled React component island runtime", () => {
  it("updates only a dependent island and preserves child-local state", async () => {
    let outerRenders = 0;
    let staticRenders = 0;
    let chartRenders = 0;

    function StaticHeader() {
      staticRenders += 1;
      return <h1>Dashboard</h1>;
    }

    function Chart({ value }: { value: number }) {
      chartRenders += 1;
      const [selected, setSelected] = useState(false);
      return (
        <button data-chart onClick={() => setSelected((current) => !current)}>
          {value}:{selected ? "selected" : "idle"}
        </button>
      );
    }

    const Dashboard = createCompiledComponent({
      displayName: "Dashboard",
      initialize: () => [0],
      render(_props: Record<string, never>, state, blocks) {
        outerRenders += 1;
        const Component = blocks.Component;
        return (
          <main>
            <StaticHeader />
            <button data-increment onClick={() => state[0].set((value) => Number(value) + 1)}>
              Increment
            </button>
            <output ref={blocks.target(0)}>{Number(state[0].get())}</output>
            <Component id={0} render={() => <Chart value={Number(state[0].get())} />} />
          </main>
        );
      },
      bindings: [
        {
          kind: "text",
          path: [2],
          target: 0,
          dependencies: [0],
          read: (_props, state) => state[0].get(),
        },
        { kind: "block", id: 0, dependencies: [0] },
      ],
    });

    const container = document.createElement("div");
    document.body.append(container);
    const root = trackRoot(createRoot(container));
    await act(async () => root.render(<Dashboard />));

    await act(async () => container.querySelector<HTMLElement>("[data-chart]")!.click());
    expect(container.querySelector("[data-chart]")?.textContent).toBe("0:selected");

    await act(async () => {
      container.querySelector<HTMLElement>("[data-increment]")!.click();
      await flushCompilerUpdates();
    });

    expect(container.querySelector("output")?.textContent).toBe("1");
    expect(container.querySelector("[data-chart]")?.textContent).toBe("1:selected");
    expect(outerRenders).toBe(1);
    expect(staticRenders).toBe(1);
    expect(chartRenders).toBe(3);
  });

  it("keeps stable DOM targets when an earlier island returns null, fragments, or many nodes", async () => {
    function VariableShape({ mode }: { mode: number }) {
      if (mode === 0) return null;
      if (mode === 1) return <i data-shape="one">One</i>;
      return (
        <>
          <i data-shape="two-a">Two A</i>
          <i data-shape="two-b">Two B</i>
        </>
      );
    }

    const Panel = createCompiledComponent({
      displayName: "StableIslandTargets",
      initialize: () => [0, 0],
      render(_props: Record<string, never>, state, blocks) {
        const Component = blocks.Component;
        return (
          <section>
            <button
              data-update
              onClick={() => {
                state[0].set((value) => (Number(value) + 1) % 3);
                state[1].set((value) => Number(value) + 1);
              }}
            >
              Update
            </button>
            <Component id={0} render={() => <VariableShape mode={Number(state[0].get())} />} />
            <output ref={blocks.target(0)}>{Number(state[1].get())}</output>
          </section>
        );
      },
      bindings: [
        { kind: "block", id: 0, dependencies: [0] },
        {
          kind: "text",
          path: [1],
          target: 0,
          dependencies: [1],
          read: (_props, state) => state[1].get(),
        },
      ],
    });

    const container = document.createElement("div");
    document.body.append(container);
    const root = trackRoot(createRoot(container));
    await act(async () => root.render(<Panel />));

    for (const [expectedShape, expectedCount] of [
      ["one", "1"],
      ["two-a", "2"],
      [undefined, "3"],
      ["one", "4"],
    ] as const) {
      await act(async () => {
        container.querySelector<HTMLElement>("[data-update]")!.click();
        await flushCompilerUpdates();
      });
      expect(container.querySelector("output")?.textContent).toBe(expectedCount);
      expect(container.querySelector("[data-shape]")?.getAttribute("data-shape")).toBe(
        expectedShape,
      );
    }
  });

  it("preserves context propagation through a memoized compiled owner", async () => {
    const Theme = createContext("light");
    function Consumer({ count }: { count: number }) {
      return (
        <output data-consumer>
          {useContext(Theme)}:{count}
        </output>
      );
    }
    const Panel = createCompiledComponent({
      displayName: "ContextIsland",
      initialize: () => [0],
      render(_props: Record<string, never>, state, blocks) {
        const Component = blocks.Component;
        return (
          <section>
            <button onClick={() => state[0].set((value) => Number(value) + 1)}>Increment</button>
            <Component id={0} render={() => <Consumer count={Number(state[0].get())} />} />
          </section>
        );
      },
      bindings: [{ kind: "block", id: 0, dependencies: [0] }],
    });
    const MemoPanel = memo(Panel);
    function App() {
      const [theme, setTheme] = useState("light");
      return (
        <Theme.Provider value={theme}>
          <button data-theme onClick={() => setTheme("dark")}>
            Theme
          </button>
          <MemoPanel />
        </Theme.Provider>
      );
    }

    const container = document.createElement("div");
    document.body.append(container);
    const root = trackRoot(createRoot(container));
    await act(async () => root.render(<App />));
    await act(async () => container.querySelector<HTMLElement>("[data-theme]")!.click());
    expect(container.querySelector("[data-consumer]")?.textContent).toBe("dark:0");
  });

  it("supports StrictMode, hydration, and dropping a queued island update after unmount", async () => {
    function Value({ value }: { value: number }) {
      return <output>{value}</output>;
    }
    const Panel = createCompiledComponent({
      displayName: "HardenedIsland",
      initialize: () => [0],
      render(_props: Record<string, never>, state, blocks) {
        const Component = blocks.Component;
        return (
          <section>
            <button onClick={() => state[0].set((value) => Number(value) + 1)}>Update</button>
            <Component id={0} render={() => <Value value={Number(state[0].get())} />} />
          </section>
        );
      },
      bindings: [{ kind: "block", id: 0, dependencies: [0] }],
    });

    const html = renderToString(
      <StrictMode>
        <Panel />
      </StrictMode>,
    );
    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.append(container);
    let root!: Root;
    await act(async () => {
      root = hydrateRoot(
        container,
        <StrictMode>
          <Panel />
        </StrictMode>,
      );
    });
    trackRoot(root);

    await act(async () => {
      container.querySelector("button")!.click();
      await flushCompilerUpdates();
    });
    expect(container.querySelector("output")?.textContent).toBe("1");

    await act(async () => {
      container.querySelector("button")!.click();
      root.unmount();
      roots.splice(roots.indexOf(root), 1);
      await flushCompilerUpdates();
    });
    expect(container.textContent).toBe("");
  });

  it("routes island render failures through React error boundaries", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    function Risky({ fail }: { fail: boolean }) {
      if (fail) throw new Error("island failed");
      return <span>Safe</span>;
    }
    class Boundary extends React.Component<{ children: ReactNode }, { failed: boolean }> {
      state = { failed: false };
      static getDerivedStateFromError() {
        return { failed: true };
      }
      render() {
        return this.state.failed ? <p>Recovered</p> : this.props.children;
      }
    }
    const Panel = createCompiledComponent({
      displayName: "ErrorIsland",
      initialize: () => [false],
      render(_props: Record<string, never>, state, blocks) {
        const Component = blocks.Component;
        return (
          <section>
            <button onClick={() => state[0].set(true)}>Fail</button>
            <Component id={0} render={() => <Risky fail={Boolean(state[0].get())} />} />
          </section>
        );
      },
      bindings: [{ kind: "block", id: 0, dependencies: [0] }],
    });

    const container = document.createElement("div");
    document.body.append(container);
    const root = trackRoot(createRoot(container));
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
    expect(container.textContent).toBe("Recovered");
  });

  it("keeps parent prop updates and compiled local updates coherent in one event", async () => {
    function Value({ value }: { value: number }) {
      return <output>{value}</output>;
    }
    const Panel = createCompiledComponent<{ offset: number; updateParent(): void }>({
      displayName: "PropAndCellIsland",
      initialize: () => [0],
      render(props, state, blocks) {
        const Component = blocks.Component;
        return (
          <section>
            <button
              onClick={() => {
                state[0].set((value) => Number(value) + 1);
                props.updateParent();
              }}
            >
              Update both
            </button>
            <Component
              id={0}
              render={() => <Value value={props.offset + Number(state[0].get())} />}
            />
          </section>
        );
      },
      bindings: [{ kind: "block", id: 0, dependencies: [0] }],
    });
    function App() {
      const [offset, setOffset] = useState(10);
      return <Panel offset={offset} updateParent={() => setOffset((value) => value + 1)} />;
    }

    const container = document.createElement("div");
    document.body.append(container);
    const root = trackRoot(createRoot(container));
    await act(async () => root.render(<App />));
    await act(async () => {
      container.querySelector("button")!.click();
      await flushCompilerUpdates();
    });
    expect(container.querySelector("output")?.textContent).toBe("12");
  });

  it("matches React across 1,000 deterministic object, array, and nullish prop transitions", async () => {
    type Value = number | null | { count: number } | number[];
    type Update = (value: Value) => Value;
    const serialize = (value: Value) =>
      value === null
        ? "null"
        : Array.isArray(value)
          ? `array:${value.join(",")}`
          : typeof value === "object"
            ? `object:${value.count}`
            : `number:${value}`;
    let seed = 0x7f4a7c15;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed;
    };
    const updates: Update[] = Array.from({ length: 1000 }, () => {
      const kind = random() % 4;
      const amount = (random() % 9) - 4;
      if (kind === 0) return () => null;
      if (kind === 1) return (value) => [Array.isArray(value) ? value.length : 0, amount];
      if (kind === 2) return () => ({ count: amount });
      return (value) =>
        (typeof value === "number" ? value : value && !Array.isArray(value) ? value.count : 0) +
        amount;
    });
    let compiledSet: (next: CompilerStateUpdater) => void = () => undefined;
    let reactSet: React.Dispatch<React.SetStateAction<Value>> = () => undefined;
    let compiledOwnerRenders = 0;

    function Readout({ value }: { value: Value }) {
      return <output>{serialize(value)}</output>;
    }
    const Compiled = createCompiledComponent({
      displayName: "RandomIslandProps",
      initialize: () => [0],
      render(_props: Record<string, never>, state, blocks) {
        compiledOwnerRenders += 1;
        compiledSet = (next) => state[0].set(next);
        const Component = blocks.Component;
        return (
          <section>
            <Component id={0} render={() => <Readout value={state[0].get() as Value} />} />
          </section>
        );
      },
      bindings: [{ kind: "block", id: 0, dependencies: [0] }],
    });
    function Normal() {
      const [value, setValue] = useState<Value>(0);
      reactSet = setValue;
      return (
        <section>
          <Readout value={value} />
        </section>
      );
    }

    const compiledContainer = document.createElement("div");
    const reactContainer = document.createElement("div");
    document.body.append(compiledContainer, reactContainer);
    const compiledRoot = trackRoot(createRoot(compiledContainer));
    const reactRoot = trackRoot(createRoot(reactContainer));
    await act(async () => {
      compiledRoot.render(<Compiled />);
      reactRoot.render(<Normal />);
    });

    for (let offset = 0; offset < updates.length; offset += 10) {
      await act(async () => {
        for (const update of updates.slice(offset, offset + 10)) {
          compiledSet((value) => update(value as Value));
          reactSet(update);
        }
        await flushCompilerUpdates();
      });
      expect(compiledContainer.textContent).toBe(reactContainer.textContent);
    }
    expect(compiledOwnerRenders).toBe(1);
  });
});
