import React, { StrictMode, useState } from "react";
import { act } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createCompiledComponent,
  type CompilerConditionalRange,
  type CompilerHostConditionalBranch,
  type CompilerStateUpdater,
} from "../compiler-runtime";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

interface ConditionalModel {
  count: number;
  enabled: boolean;
  loading: boolean | number;
}

interface ConditionalBoardProps {
  title?: string;
}

class ConditionalRangeErrorBoundary extends React.Component<
  React.PropsWithChildren,
  { message: string | null }
> {
  state = { message: null as string | null };

  static getDerivedStateFromError(error: Error) {
    return { message: error.message };
  }

  render() {
    return this.state.message ? <div role="alert">{this.state.message}</div> : this.props.children;
  }
}

const roots = new Set<Root>();

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

async function flushCompilerUpdates(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function statusBranch(
  tag: string,
  slot: string,
  label: string,
  readCount: () => number,
): CompilerHostConditionalBranch {
  return {
    create: () => ({
      kind: "element",
      tag,
      attributes: [
        { name: "data-slot", value: slot },
        { name: "data-count", value: readCount() },
      ],
      styles: [],
      children: [[label, " ", readCount()]],
    }),
    bindings: [
      {
        kind: "attribute",
        path: [],
        name: "data-count",
        read: readCount,
      },
      {
        kind: "text",
        path: [],
        read: () => [label, " ", readCount()],
      },
    ],
  };
}

function defineConditionalBoard(
  metrics: { executions: number; rangeRenders: number },
  rootOwned = false,
) {
  const initial: ConditionalModel = { count: 1, enabled: true, loading: false };
  let updateModel: (next: CompilerStateUpdater) => void = () => undefined;
  let readModel: () => ConditionalModel = () => initial;

  const ConditionalBoard = createCompiledComponent<ConditionalBoardProps>({
    displayName: "ConditionalBoard",
    initialize: () => [initial],
    render(props, state, blocks) {
      metrics.executions += 1;
      const model = () => state[0].get() as ConditionalModel;
      readModel = model;
      updateModel = (next) => state[0].set(next);
      const ConditionalRanges = blocks.ConditionalRanges;
      const ranges: CompilerConditionalRange[] = [
        {
          before: 1,
          logical: true,
          test: () => model().loading,
          truthy: statusBranch("p", "loading", "Loading", () => model().count),
        },
        {
          before: 1,
          test: () => model().enabled,
          truthy: statusBranch("strong", "status", "Enabled", () => model().count),
          falsy: statusBranch("span", "status", "Disabled", () => model().count),
        },
      ];
      const rangeRoot = (
        <ConditionalRanges
          id={0}
          bindings={[
            {
              kind: "text",
              segment: 0,
              sibling: 0,
              path: [],
              read: () => [props.title || "Dashboard", " ", model().count],
            },
            {
              kind: "attribute",
              segment: 0,
              sibling: 0,
              path: [],
              name: "className",
              read: () => (model().enabled ? "enabled" : "disabled"),
            },
            {
              kind: "text",
              segment: 1,
              sibling: 0,
              path: [],
              read: () => ["Stable ", model().count],
            },
            {
              kind: "text",
              segment: 2,
              sibling: 0,
              path: [],
              read: () => ["Footer ", model().count],
            },
            {
              kind: "style",
              segment: 2,
              sibling: 0,
              path: [],
              name: "opacity",
              read: () => (model().loading ? 0.5 : 1),
            },
          ]}
          ranges={ranges}
          rootRef={rootOwned ? undefined : blocks.target(1)}
          render={() => {
            metrics.rangeRenders += 1;
            return (
              <article data-board="conditions" data-count={model().count}>
                <header className={model().enabled ? "enabled" : "disabled"} data-static="header">
                  {props.title || "Dashboard"} {model().count}
                </header>
                {model().loading && (
                  <p data-count={model().count} data-slot="loading">
                    Loading {model().count}
                  </p>
                )}
                <section data-static="content">Stable {model().count}</section>
                {model().enabled ? (
                  <strong data-count={model().count} data-slot="status">
                    Enabled {model().count}
                  </strong>
                ) : (
                  <span data-count={model().count} data-slot="status">
                    Disabled {model().count}
                  </span>
                )}
                <footer data-static="footer" style={{ opacity: model().loading ? 0.5 : 1 }}>
                  Footer {model().count}
                </footer>
              </article>
            );
          }}
          trailing={1}
        />
      );
      return rootOwned ? (
        rangeRoot
      ) : (
        <main>
          <h1>{props.title || "Conditions"}</h1>
          {rangeRoot}
        </main>
      );
    },
    bindings: [
      {
        kind: "attribute" as const,
        path: rootOwned ? [] : [1],
        target: rootOwned ? undefined : 1,
        dependencies: [0],
        name: "data-count",
        read: (_props: ConditionalBoardProps, state: readonly { get(): unknown }[]) =>
          (state[0].get() as ConditionalModel).count,
      },
      { kind: "block", id: 0, dependencies: [0] },
    ],
  });

  return {
    ConditionalBoard,
    initial,
    readModel: () => readModel(),
    updateModel: (next: CompilerStateUpdater) => updateModel(next),
  };
}

function conditionalSnapshot(container: Element) {
  const board = container.querySelector<HTMLElement>("[data-board='conditions']")!;
  return {
    count: board.dataset.count,
    children: [...board.children].map(
      (child) =>
        `${child.tagName}:${child.getAttribute("data-static") || child.getAttribute("data-slot")}:${child.textContent}`,
    ),
  };
}

describe("compiled conditional DOM ranges", () => {
  it("owns the exact component root and updates only the affected slots", async () => {
    const metrics = { executions: 0, rangeRenders: 0 };
    const board = defineConditionalBoard(metrics, true);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.add(root);
    await act(async () => root.render(<board.ConditionalBoard />));

    const article = container.querySelector<HTMLElement>("[data-board='conditions']")!;
    const header = article.querySelector('[data-static="header"]')!;
    const content = article.querySelector('[data-static="content"]')!;
    const footer = article.querySelector('[data-static="footer"]')!;
    const enabled = article.querySelector('[data-slot="status"]')!;
    const initialExecutions = metrics.executions;
    const initialRangeRenders = metrics.rangeRenders;

    await act(async () => {
      board.updateModel((current) => ({ ...(current as ConditionalModel), count: 2 }));
      await flushCompilerUpdates();
    });

    expect(container.firstElementChild).toBe(article);
    expect(article.dataset.count).toBe("2");
    expect(article.querySelector('[data-static="header"]')).toBe(header);
    expect(article.querySelector('[data-static="content"]')).toBe(content);
    expect(article.querySelector('[data-static="footer"]')).toBe(footer);
    expect(article.querySelector('[data-slot="status"]')).toBe(enabled);
    expect(enabled.textContent).toBe("Enabled 2");
    expect(content.textContent).toBe("Stable 2");
    expect(header.textContent).toBe("Dashboard 2");
    expect(header.getAttribute("class")).toBe("enabled");
    expect(footer.textContent).toBe("Footer 2");

    await act(async () => {
      board.updateModel({ count: 3, enabled: false, loading: true });
      await flushCompilerUpdates();
    });

    expect([...article.children].map((child) => child.getAttribute("data-slot"))).toEqual([
      null,
      "loading",
      null,
      "status",
      null,
    ]);
    expect(article.querySelector('[data-slot="loading"]')?.textContent).toBe("Loading 3");
    expect(article.querySelector('[data-slot="status"]')?.textContent).toBe("Disabled 3");
    expect(header.getAttribute("class")).toBe("disabled");
    expect(footer.textContent).toBe("Footer 3");
    expect((footer as HTMLElement).style.opacity).toBe("0.5");
    expect(enabled.isConnected).toBe(false);
    expect(metrics.executions).toBe(initialExecutions);
    expect(metrics.rangeRenders).toBe(initialRangeRenders);
  });

  it("mounts adjacent empty slots in deterministic order without marker nodes", async () => {
    let update: (next: CompilerStateUpdater) => void = () => undefined;
    const Adjacent = createCompiledComponent({
      displayName: "AdjacentConditionalRanges",
      initialize: () => [{ first: false, second: false }],
      render(_props: Record<string, never>, state, blocks) {
        update = (next) => state[0].set(next);
        const model = () => state[0].get() as { first: boolean; second: boolean };
        const branch = (slot: string): CompilerHostConditionalBranch => ({
          create: () => ({
            kind: "element",
            tag: "p",
            attributes: [{ name: "data-slot", value: slot }],
            styles: [],
            children: [slot],
          }),
          bindings: [],
        });
        const ConditionalRanges = blocks.ConditionalRanges;
        return (
          <ConditionalRanges
            id={0}
            ranges={[
              {
                before: 1,
                logical: true,
                test: () => model().first,
                truthy: branch("first"),
              },
              {
                before: 0,
                logical: true,
                test: () => model().second,
                truthy: branch("second"),
              },
            ]}
            render={() => (
              <section>
                <header>Header</header>
                {model().first && <p data-slot="first">first</p>}
                {model().second && <p data-slot="second">second</p>}
                <footer>Footer</footer>
              </section>
            )}
            trailing={1}
          />
        );
      },
      bindings: [{ kind: "block", id: 0, dependencies: [0] }],
    });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.add(root);
    await act(async () => root.render(<Adjacent />));
    const section = container.querySelector("section")!;
    expect(section.childNodes).toHaveLength(2);

    await act(async () => {
      update({ first: true, second: true });
      await flushCompilerUpdates();
    });
    expect([...section.querySelectorAll("[data-slot]")].map((node) => node.textContent)).toEqual([
      "first",
      "second",
    ]);

    await act(async () => {
      update({ first: false, second: true });
      await flushCompilerUpdates();
    });
    expect([...section.querySelectorAll("[data-slot]")].map((node) => node.textContent)).toEqual([
      "second",
    ]);
  });

  it("keeps controlled selection coherent while patching a stable branch", async () => {
    let update: (next: CompilerStateUpdater) => void = () => undefined;
    const Editor = createCompiledComponent({
      displayName: "ConditionalRangeEditor",
      initialize: () => ["Compiler"],
      render(_props: Record<string, never>, state, blocks) {
        update = (next) => state[0].set(next);
        const value = () => String(state[0].get());
        const ConditionalRanges = blocks.ConditionalRanges;
        return (
          <ConditionalRanges
            id={0}
            ranges={[
              {
                before: 0,
                test: () => true,
                truthy: {
                  create: () => ({
                    kind: "element",
                    tag: "input",
                    attributes: [
                      { name: "data-slot", value: "editor" },
                      { name: "readOnly", value: true },
                      { name: "value", value: value() },
                    ],
                    styles: [],
                    children: [],
                  }),
                  bindings: [{ kind: "attribute", path: [], name: "value", read: value }],
                },
              },
            ]}
            render={() => (
              <section>
                <input data-slot="editor" readOnly value={value()} />
              </section>
            )}
            trailing={0}
          />
        );
      },
      bindings: [{ kind: "block", id: 0, dependencies: [0] }],
    });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.add(root);
    await act(async () => root.render(<Editor />));
    const input = container.querySelector("input")!;
    input.focus();
    input.setSelectionRange(2, 5);

    await act(async () => {
      update("ComXpiler");
      await flushCompilerUpdates();
    });

    expect(container.querySelector("input")).toBe(input);
    expect(input.value).toBe("ComXpiler");
    expect(input.selectionStart).toBe(2);
    expect(input.selectionEnd).toBe(5);
  });

  it("returns the complete container to React when adopted DOM does not match its descriptor", async () => {
    let update: (next: CompilerStateUpdater) => void = () => undefined;
    let rangeRenders = 0;
    const InvalidAdoption = createCompiledComponent({
      displayName: "InvalidConditionalRangeAdoption",
      initialize: () => ["one"],
      render(_props: Record<string, never>, state, blocks) {
        update = (next) => state[0].set(next);
        const value = () => String(state[0].get());
        const ConditionalRanges = blocks.ConditionalRanges;
        return (
          <ConditionalRanges
            id={0}
            ranges={[
              {
                before: 0,
                test: () => true,
                truthy: {
                  create: () => ({
                    kind: "element",
                    tag: "strong",
                    attributes: [{ name: "data-slot", value: "value" }],
                    styles: [],
                    children: [value()],
                  }),
                  bindings: [{ kind: "text", path: [], read: value }],
                },
              },
            ]}
            render={() => {
              rangeRenders += 1;
              return (
                <section>
                  <p data-slot="value">{value()}</p>
                </section>
              );
            }}
            trailing={0}
          />
        );
      },
      bindings: [{ kind: "block", id: 0, dependencies: [0] }],
    });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.add(root);
    await act(async () => root.render(<InvalidAdoption />));

    expect(container.querySelector("p")?.textContent).toBe("one");
    expect(container.querySelector("strong")).toBeNull();
    expect(rangeRenders).toBe(2);

    await act(async () => {
      update("two");
      await flushCompilerUpdates();
    });

    expect(container.querySelector("p")?.textContent).toBe("two");
    expect(container.querySelector("strong")).toBeNull();
    expect(rangeRenders).toBe(3);
  });

  it("switches the complete range owner to React for visible numeric logical output", async () => {
    let update: (next: CompilerStateUpdater) => void = () => undefined;
    let renders = 0;
    const Numeric = createCompiledComponent({
      displayName: "NumericConditionalRange",
      initialize: () => [false as boolean | number],
      render(_props: Record<string, never>, state, blocks) {
        update = (next) => state[0].set(next);
        const value = () => state[0].get() as boolean | number;
        const ConditionalRanges = blocks.ConditionalRanges;
        return (
          <ConditionalRanges
            id={0}
            ranges={[
              {
                before: 1,
                logical: true,
                test: value,
                truthy: {
                  create: () => ({
                    kind: "element",
                    tag: "p",
                    attributes: [],
                    styles: [],
                    children: ["Visible"],
                  }),
                  bindings: [],
                },
              },
            ]}
            render={() => {
              renders += 1;
              return (
                <section>
                  <header>Header</header>
                  {value() && <p>Visible</p>}
                  <footer>Footer</footer>
                </section>
              );
            }}
            trailing={1}
          />
        );
      },
      bindings: [{ kind: "block", id: 0, dependencies: [0] }],
    });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.add(root);
    await act(async () => root.render(<Numeric />));
    const original = container.querySelector("section")!;

    await act(async () => {
      update(0);
      await flushCompilerUpdates();
    });

    expect(container.querySelector("section")).not.toBe(original);
    expect(container.querySelector("section")?.textContent).toBe("Header0Footer");
    expect(renders).toBe(2);
  });

  it("routes descriptor errors through the nearest React error boundary", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    let update: (next: CompilerStateUpdater) => void = () => undefined;
    const Throwing = createCompiledComponent({
      displayName: "ThrowingConditionalRange",
      initialize: () => [{ enabled: true, fail: false }],
      render(_props: Record<string, never>, state, blocks) {
        update = (next) => state[0].set(next);
        const model = () => state[0].get() as { enabled: boolean; fail: boolean };
        const branch = (label: string): CompilerHostConditionalBranch => ({
          create: () => {
            if (model().fail) throw new Error("conditional range failed");
            return {
              kind: "element",
              tag: "p",
              attributes: [],
              styles: [],
              children: [label],
            };
          },
          bindings: [],
        });
        const ConditionalRanges = blocks.ConditionalRanges;
        return (
          <ConditionalRanges
            id={0}
            ranges={[
              {
                before: 0,
                test: () => model().enabled,
                truthy: branch("Enabled"),
                falsy: branch("Disabled"),
              },
            ]}
            render={() => <section>{model().enabled ? <p>Enabled</p> : <p>Disabled</p>}</section>}
            trailing={0}
          />
        );
      },
      bindings: [{ kind: "block", id: 0, dependencies: [0] }],
    });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.add(root);
    await act(async () =>
      root.render(
        <ConditionalRangeErrorBoundary>
          <Throwing />
        </ConditionalRangeErrorBoundary>,
      ),
    );

    await act(async () => {
      update({ enabled: false, fail: true });
      await flushCompilerUpdates();
    });

    expect(container.querySelector('[role="alert"]')?.textContent).toBe("conditional range failed");
  });

  it.each([
    ["nested container", false],
    ["component root", true],
  ])(
    "recovers %s hydration mismatches in StrictMode and ignores work after unmount",
    async (_label, rootOwned) => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      const metrics = { executions: 0, rangeRenders: 0 };
      const board = defineConditionalBoard(metrics, rootOwned);
      const serverHtml = renderToString(
        <StrictMode>
          <board.ConditionalBoard />
        </StrictMode>,
      );
      const container = document.createElement("div");
      container.innerHTML = serverHtml.replace("Stable", "Server mismatch");
      document.body.append(container);
      const recoverable = vi.fn();
      const root = hydrateRoot(
        container,
        <StrictMode>
          <board.ConditionalBoard />
        </StrictMode>,
        { onRecoverableError: recoverable },
      );
      roots.add(root);
      await act(async () => flushCompilerUpdates());
      expect(recoverable).toHaveBeenCalled();

      await act(async () => {
        board.updateModel({ count: 4, enabled: false, loading: true });
        await flushCompilerUpdates();
      });
      expect(container.querySelector('[data-slot="loading"]')?.textContent).toBe("Loading 4");
      expect(container.querySelector('[data-slot="status"]')?.textContent).toBe("Disabled 4");

      await act(async () => {
        board.updateModel({ count: 5, enabled: true, loading: false });
        root.unmount();
        await flushCompilerUpdates();
      });
      roots.delete(root);
      expect(container.innerHTML).toBe("");
    },
  );

  it.each([
    ["nested container", false],
    ["component root", true],
  ])(
    "falls back safely for %s when parent props change static output",
    async (_label, rootOwned) => {
      const metrics = { executions: 0, rangeRenders: 0 };
      const board = defineConditionalBoard(metrics, rootOwned);
      const container = document.createElement("div");
      document.body.append(container);
      const root = createRoot(container);
      roots.add(root);
      await act(async () => root.render(<board.ConditionalBoard title="First" />));
      const original = container.querySelector<HTMLElement>("[data-board='conditions']")!;

      await act(async () => {
        root.render(<board.ConditionalBoard title="Second" />);
        board.updateModel({ count: 7, enabled: false, loading: true });
        await flushCompilerUpdates();
      });

      expect(container.querySelector<HTMLElement>("[data-board='conditions']")).not.toBe(original);
      expect(container.querySelector('[data-static="header"]')?.textContent).toBe("Second 7");
      expect(container.querySelector('[data-slot="loading"]')?.textContent).toBe("Loading 7");
    },
  );

  it.each([
    ["nested container", false],
    ["component root", true],
  ])(
    "matches normal React through 3,000 deterministic %s transitions",
    async (_label, rootOwned) => {
      const metrics = { executions: 0, rangeRenders: 0 };
      const compiled = defineConditionalBoard(metrics, rootOwned);
      let normalModel = compiled.initial;
      let setNormal: React.Dispatch<React.SetStateAction<ConditionalModel>> = () => undefined;

      function NormalBoard() {
        const [model, setModel] = useState(compiled.initial);
        normalModel = model;
        setNormal = setModel;
        return (
          <article data-board="conditions" data-count={model.count}>
            <header className={model.enabled ? "enabled" : "disabled"} data-static="header">
              Dashboard {model.count}
            </header>
            {model.loading && (
              <p data-count={model.count} data-slot="loading">
                Loading {model.count}
              </p>
            )}
            <section data-static="content">Stable {model.count}</section>
            {model.enabled ? (
              <strong data-count={model.count} data-slot="status">
                Enabled {model.count}
              </strong>
            ) : (
              <span data-count={model.count} data-slot="status">
                Disabled {model.count}
              </span>
            )}
            <footer data-static="footer" style={{ opacity: model.loading ? 0.5 : 1 }}>
              Footer {model.count}
            </footer>
          </article>
        );
      }

      const compiledContainer = document.createElement("div");
      const normalContainer = document.createElement("div");
      document.body.append(compiledContainer, normalContainer);
      const compiledRoot = createRoot(compiledContainer);
      const normalRoot = createRoot(normalContainer);
      roots.add(compiledRoot);
      roots.add(normalRoot);
      await act(async () => {
        compiledRoot.render(<compiled.ConditionalBoard />);
        normalRoot.render(<NormalBoard />);
      });

      let seed = 0x6d2b79f5;
      const random = () => {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        return seed;
      };
      const operations = Array.from({ length: 3000 }, (_, step) => ({
        operation: random() % 6,
        value: random(),
        step,
      }));
      const update = (model: ConditionalModel, step: number): ConditionalModel => {
        const operation = operations[step];
        if (operation.operation === 0) return { ...model, loading: !model.loading };
        if (operation.operation === 1) return { ...model, enabled: !model.enabled };
        if (operation.operation === 2) return { ...model, count: operation.value % 1000 };
        if (operation.operation === 3) {
          return { ...model, count: model.count + 1, loading: !model.loading };
        }
        if (operation.operation === 4) {
          return { ...model, count: model.count - 1, enabled: !model.enabled };
        }
        return {
          count: operation.step,
          enabled: operation.value % 2 === 0,
          loading: operation.value % 3 === 0,
        };
      };
      const initialExecutions = metrics.executions;
      const initialRangeRenders = metrics.rangeRenders;

      for (let offset = 0; offset < operations.length; offset += 25) {
        await act(async () => {
          for (let step = offset; step < offset + 25; step += 1) {
            const updater = (current: ConditionalModel) => update(current, step);
            compiled.updateModel((current) => updater(current as ConditionalModel));
            setNormal(updater);
          }
          await flushCompilerUpdates();
        });
        expect(compiled.readModel(), `model after batch ${offset}`).toEqual(normalModel);
        expect(conditionalSnapshot(compiledContainer), `DOM after batch ${offset}`).toEqual(
          conditionalSnapshot(normalContainer),
        );
      }

      expect(metrics.executions).toBe(initialExecutions);
      expect(metrics.rangeRenders).toBe(initialRangeRenders);
    },
    30_000,
  );
});
