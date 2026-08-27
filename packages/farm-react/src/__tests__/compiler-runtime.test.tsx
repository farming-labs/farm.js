import React, { Profiler, useState } from "react";
import { act } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
});

function createCompiledCounter(onRender: () => void) {
  return createCompiledComponent({
    displayName: "Counter",
    initialize: () => [0],
    render(_props: Record<string, never>, state) {
      onRender();
      return (
        <button
          className={Number(state[0].get()) > 0 ? "active" : "idle"}
          onClick={() => state[0].set((value) => Number(value) + 1)}
        >
          Count: {Number(state[0].get())}
        </button>
      );
    },
    bindings: [
      {
        kind: "text",
        path: [],
        dependencies: [0],
        read: (_props, state) => ["Count: ", state[0].get()],
      },
      {
        kind: "attribute",
        path: [],
        dependencies: [0],
        name: "className",
        read: (_props, state) => (Number(state[0].get()) > 0 ? "active" : "idle"),
      },
    ],
  });
}

describe("compiled React runtime", () => {
  it("updates bindings without a React render or commit", async () => {
    let compiledRenders = 0;
    let baseRenders = 0;
    let compiledCommits = 0;
    let baseCommits = 0;
    const CompiledCounter = createCompiledCounter(() => compiledRenders++);

    function BaseCounter() {
      baseRenders += 1;
      const [count, setCount] = useState(0);
      return (
        <button
          className={count > 0 ? "active" : "idle"}
          onClick={() => setCount((value) => value + 1)}
        >
          Count: {count}
        </button>
      );
    }

    const compiledContainer = document.createElement("div");
    const baseContainer = document.createElement("div");
    document.body.append(compiledContainer, baseContainer);
    const compiledRoot = createRoot(compiledContainer);
    const baseRoot = createRoot(baseContainer);
    roots.push(compiledRoot, baseRoot);

    await act(async () => {
      compiledRoot.render(
        <Profiler id="compiled" onRender={() => compiledCommits++}>
          <CompiledCounter />
        </Profiler>,
      );
      baseRoot.render(
        <Profiler id="base" onRender={() => baseCommits++}>
          <BaseCounter />
        </Profiler>,
      );
    });

    await act(async () => {
      compiledContainer.querySelector("button")!.click();
      baseContainer.querySelector("button")!.click();
      await Promise.resolve();
    });

    expect(compiledContainer.textContent).toBe("Count: 1");
    expect(compiledContainer.querySelector("button")?.className).toBe("active");
    expect(baseContainer.textContent).toBe("Count: 1");
    expect(compiledRenders).toBe(1);
    expect(compiledCommits).toBe(1);
    expect(baseRenders).toBe(2);
    expect(baseCommits).toBe(2);
  });

  it("preserves the host markup across SSR and hydration", async () => {
    const Counter = createCompiledCounter(() => {});
    const html = renderToString(<Counter />);
    expect(html.replace("<!-- -->", "")).toContain('<button class="idle">Count: 0</button>');
    expect(html).not.toContain("farm");

    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.append(container);
    let root!: ReturnType<typeof hydrateRoot>;
    await act(async () => {
      root = hydrateRoot(container, <Counter />);
    });
    roots.push(root);

    await act(async () => {
      container.querySelector("button")!.click();
      await Promise.resolve();
    });
    expect(container.textContent).toBe("Count: 1");
  });

  it("preserves React state snapshots while batching functional updates", async () => {
    let observedDuringEvent: unknown;
    const Counter = createCompiledComponent({
      displayName: "BatchedCounter",
      initialize: () => [0],
      render(_props: Record<string, never>, state) {
        return (
          <button
            onClick={() => {
              state[0].set((value) => Number(value) + 1);
              state[0].set((value) => Number(value) + 1);
              observedDuringEvent = state[0].get();
            }}
          >
            {Number(state[0].get())}
          </button>
        );
      },
      bindings: [
        {
          kind: "text",
          path: [],
          dependencies: [0],
          read: (_props, state) => state[0].get(),
        },
      ],
    });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<Counter />));

    await act(async () => {
      container.querySelector("button")!.click();
      expect(observedDuringEvent).toBe(0);
      await Promise.resolve();
    });

    expect(container.textContent).toBe("2");
  });

  it("tracks only the active short-circuit branch and resubscribes when it changes", async () => {
    let bindingReads = 0;
    const ConditionalValue = createCompiledComponent({
      displayName: "ConditionalValue",
      reactivity: "hybrid",
      initialize: () => [true, "active-0", "inactive-0"],
      render(_props: Record<string, never>, state) {
        return (
          <div>
            <button onClick={() => state[1].set("active-1")}>active</button>
            <button onClick={() => state[2].set("inactive-1")}>inactive</button>
            <button onClick={() => state[0].set((value) => !value)}>toggle</button>
            <span>{state[0].get() ? state[1].get() : state[2].get()}</span>
          </div>
        );
      },
      bindings: [
        {
          kind: "text",
          tracking: "dynamic",
          path: [3],
          dependencies: [0, 1, 2],
          read: (_props, state) => {
            bindingReads += 1;
            return state[0].get() ? state[1].get() : state[2].get();
          },
        },
      ],
    });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<ConditionalValue />));

    expect(bindingReads).toBe(1);
    const buttons = container.querySelectorAll("button");
    await act(async () => {
      buttons[1].click();
      await Promise.resolve();
    });
    expect(bindingReads).toBe(1);
    expect(container.querySelector("span")?.textContent).toBe("active-0");

    await act(async () => {
      buttons[2].click();
      await Promise.resolve();
    });
    expect(bindingReads).toBe(2);
    expect(container.querySelector("span")?.textContent).toBe("inactive-1");

    await act(async () => {
      buttons[0].click();
      await Promise.resolve();
    });
    expect(bindingReads).toBe(2);
  });

  it("indexes a thousand static bindings without evaluating unrelated readers", async () => {
    const bindingCount = 1_024;
    const reads = Array.from({ length: bindingCount }, () => 0);
    let cells: readonly { get(): unknown; set(next: unknown): void }[] = [];
    const IndexedBindings = createCompiledComponent({
      displayName: "IndexedBindings",
      reactivity: "static",
      initialize: () => Array.from({ length: bindingCount }, () => 0),
      render(_props: Record<string, never>, state) {
        cells = state;
        return React.createElement(
          "div",
          null,
          ...state.map((cell, index) => React.createElement("span", { key: index }, cell.get())),
        );
      },
      bindings: Array.from({ length: bindingCount }, (_, index) => ({
        kind: "text" as const,
        path: [index],
        dependencies: [index],
        read: (_props: Record<string, never>, state: readonly { get(): unknown }[]) => {
          reads[index] += 1;
          return state[index].get();
        },
      })),
    });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<IndexedBindings />));

    await act(async () => {
      cells[737].set(1);
      await Promise.resolve();
    });

    expect(reads.reduce((total, count) => total + count, 0)).toBe(1);
    expect(reads[737]).toBe(1);
    expect(container.querySelectorAll("span")[737].textContent).toBe("1");
  });

  it("stringifies boolean data and ARIA bindings like React", async () => {
    const Toggle = createCompiledComponent({
      displayName: "BooleanAttributes",
      initialize: () => [false],
      render(_props: Record<string, never>, state) {
        return (
          <button
            aria-pressed={Boolean(state[0].get())}
            data-active={Boolean(state[0].get())}
            onClick={() => state[0].set((value) => !value)}
          >
            Toggle
          </button>
        );
      },
      bindings: [
        {
          kind: "attribute",
          path: [],
          dependencies: [0],
          name: "data-active",
          read: (_props, state) => Boolean(state[0].get()),
        },
        {
          kind: "attribute",
          path: [],
          dependencies: [0],
          name: "aria-pressed",
          read: (_props, state) => Boolean(state[0].get()),
        },
      ],
    });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<Toggle />));

    const button = container.querySelector("button")!;
    expect(button.getAttribute("data-active")).toBe("false");
    expect(button.getAttribute("aria-pressed")).toBe("false");

    await act(async () => {
      button.click();
      await Promise.resolve();
    });
    expect(button.getAttribute("data-active")).toBe("true");
    expect(button.getAttribute("aria-pressed")).toBe("true");

    await act(async () => {
      button.click();
      await Promise.resolve();
    });
    expect(button.getAttribute("data-active")).toBe("false");
    expect(button.getAttribute("aria-pressed")).toBe("false");
  });
});
