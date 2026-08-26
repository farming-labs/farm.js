import React, { StrictMode, useState } from "react";
import { act } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createCompiledComponent,
  type CompilerKeyedRange,
  type CompilerStateUpdater,
} from "../compiler-runtime";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

interface RangeItem {
  id: string;
  label: string;
}

interface RangeModel {
  primary: RangeItem[];
  secondary: RangeItem[];
}

interface RangeBoardProps {
  title?: string;
}

class RootRangeErrorBoundary extends React.Component<
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

function rangeDescriptor(before: number, readItems: () => RangeItem[]): CompilerKeyedRange {
  return {
    before,
    items: readItems,
    rowKey: (item) => (item as RangeItem).id,
    create: (item, index) => ({
      kind: "element",
      tag: "li",
      attributes: [
        { name: "data-key", value: (item as RangeItem).id },
        { name: "data-index", value: index },
      ],
      styles: [],
      children: [`${index}:${(item as RangeItem).label}`],
    }),
    bindings: [
      {
        kind: "attribute",
        name: "data-index",
        path: [],
        read: (_item, index) => index,
      },
      {
        kind: "text",
        path: [],
        read: (item, index) => [index, ":", (item as RangeItem).label],
      },
    ],
  };
}

function defineRangeBoard(
  metrics: { executions: number; rangeRenders: number },
  rootOwned = false,
) {
  const initial: RangeModel = {
    primary: [
      { id: "a", label: "Alpha" },
      { id: "b", label: "Beta" },
      { id: "c", label: "Gamma" },
      { id: "d", label: "Delta" },
    ],
    secondary: [
      { id: "x", label: "Xray" },
      { id: "y", label: "Yankee" },
    ],
  };
  let updateModel: (next: CompilerStateUpdater) => void = () => undefined;
  let readModel: () => RangeModel = () => initial;

  const RangeBoard = createCompiledComponent<RangeBoardProps>({
    displayName: "RangeBoard",
    initialize: () => [initial],
    render(props, state, blocks) {
      metrics.executions += 1;
      const model = () => state[0].get() as RangeModel;
      readModel = model;
      updateModel = (next) => state[0].set(next);
      const KeyedRanges = blocks.KeyedRanges;
      const ranges = (
        <KeyedRanges
          id={0}
          bindings={[
            {
              kind: "text",
              segment: 0,
              sibling: 0,
              path: [],
              read: () => [props.title || "Primary", " ", model().primary.length],
            },
            {
              kind: "attribute",
              segment: 0,
              sibling: 0,
              path: [],
              name: "className",
              read: () => (model().primary.length > 2 ? "many" : "few"),
            },
            {
              kind: "text",
              segment: 1,
              sibling: 0,
              path: [],
              read: () => ["Secondary ", model().secondary.length],
            },
            {
              kind: "text",
              segment: 2,
              sibling: 0,
              path: [],
              read: () => [model().primary.length + model().secondary.length, " total"],
            },
            {
              kind: "style",
              segment: 2,
              sibling: 0,
              path: [],
              name: "width",
              read: () => model().primary.length + model().secondary.length,
            },
          ]}
          ranges={[
            rangeDescriptor(1, () => model().primary),
            rangeDescriptor(1, () => model().secondary),
          ]}
          render={() => {
            metrics.rangeRenders += 1;
            return (
              <ul
                data-board="ranges"
                data-count={model().primary.length + model().secondary.length}
              >
                <li className={model().primary.length > 2 ? "many" : "few"} data-static="header">
                  {props.title || "Primary"} {model().primary.length}
                </li>
                {model().primary.map((item, index) => (
                  <li data-index={index} data-key={item.id} key={item.id}>
                    {index}:{item.label}
                  </li>
                ))}
                <li data-static="divider">Secondary {model().secondary.length}</li>
                {model().secondary.map((item, index) => (
                  <li data-index={index} data-key={item.id} key={item.id}>
                    {index}:{item.label}
                  </li>
                ))}
                <li
                  data-static="footer"
                  style={{ width: model().primary.length + model().secondary.length }}
                >
                  {model().primary.length + model().secondary.length} total
                </li>
              </ul>
            );
          }}
          trailing={1}
        />
      );
      return rootOwned ? (
        ranges
      ) : (
        <main>
          <h1>{props.title || "Ranges"}</h1>
          {ranges}
        </main>
      );
    },
    bindings: [
      ...(rootOwned
        ? [
            {
              kind: "attribute" as const,
              path: [],
              target: 1,
              dependencies: [0],
              name: "data-count",
              read: (_props: RangeBoardProps, state: readonly { get(): unknown }[]) => {
                const model = state[0].get() as RangeModel;
                return model.primary.length + model.secondary.length;
              },
            },
          ]
        : []),
      { kind: "block", id: 0, dependencies: [0] },
    ],
  });

  return {
    RangeBoard,
    initial,
    readModel: () => readModel(),
    updateModel: (next: CompilerStateUpdater) => updateModel(next),
  };
}

function rangeSnapshot(container: Element): string[] {
  return [...container.querySelectorAll<HTMLLIElement>("[data-key]")].map(
    (row) => `${row.dataset.key}:${row.dataset.index}:${row.textContent}`,
  );
}

describe("compiled keyed DOM ranges", () => {
  it("owns the exact component root and keeps root bindings coherent", async () => {
    const metrics = { executions: 0, rangeRenders: 0 };
    const board = defineRangeBoard(metrics, true);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.add(root);
    await act(async () => root.render(<board.RangeBoard />));

    const list = container.querySelector<HTMLUListElement>("[data-board='ranges']")!;
    const header = list.querySelector('[data-static="header"]')!;
    const divider = list.querySelector('[data-static="divider"]')!;
    const footer = list.querySelector('[data-static="footer"]')!;
    const alpha = list.querySelector('[data-key="a"]')!;
    const xray = list.querySelector('[data-key="x"]')!;
    const initialExecutions = metrics.executions;
    const initialRangeRenders = metrics.rangeRenders;
    expect(container.children).toHaveLength(1);
    expect(container.firstElementChild).toBe(list);
    expect(list.dataset.count).toBe("6");

    await act(async () => {
      board.updateModel((current) => {
        const model = current as RangeModel;
        return {
          primary: [model.primary[3], ...model.primary.slice(0, 3)],
          secondary: [...model.secondary, { id: "z", label: "Zulu" }],
        };
      });
      await flushCompilerUpdates();
    });

    expect(container.firstElementChild).toBe(list);
    expect(list.dataset.count).toBe("7");
    expect(header.textContent).toBe("Primary 4");
    expect(header.getAttribute("class")).toBe("many");
    expect(divider.textContent).toBe("Secondary 3");
    expect(footer.textContent).toBe("7 total");
    expect((footer as HTMLElement).style.width).toBe("7px");
    expect(list.querySelector('[data-static="header"]')).toBe(header);
    expect(list.querySelector('[data-static="divider"]')).toBe(divider);
    expect(list.querySelector('[data-static="footer"]')).toBe(footer);
    expect(list.querySelector('[data-key="a"]')).toBe(alpha);
    expect(list.querySelector('[data-key="x"]')).toBe(xray);
    expect(metrics.executions).toBe(initialExecutions);
    expect(metrics.rangeRenders).toBe(initialRangeRenders);
  });

  it("reconciles two ranges while preserving every static sibling", async () => {
    const metrics = { executions: 0, rangeRenders: 0 };
    const board = defineRangeBoard(metrics);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.add(root);
    await act(async () => root.render(<board.RangeBoard />));

    const list = container.querySelector<HTMLUListElement>("[data-board='ranges']")!;
    const header = list.querySelector('[data-static="header"]')!;
    const divider = list.querySelector('[data-static="divider"]')!;
    const footer = list.querySelector('[data-static="footer"]')!;
    const alpha = list.querySelector('[data-key="a"]')!;
    const xray = list.querySelector('[data-key="x"]')!;
    const insertBefore = vi.spyOn(list, "insertBefore");
    const initialExecutions = metrics.executions;
    const initialRangeRenders = metrics.rangeRenders;

    await act(async () => {
      board.updateModel((current) => {
        const model = current as RangeModel;
        return {
          primary: [...model.primary].reverse(),
          secondary: [model.secondary[1], { id: "z", label: "Zulu" }, model.secondary[0]],
        };
      });
      await flushCompilerUpdates();
    });

    expect(list.querySelector('[data-static="header"]')).toBe(header);
    expect(list.querySelector('[data-static="divider"]')).toBe(divider);
    expect(list.querySelector('[data-static="footer"]')).toBe(footer);
    expect(list.querySelector('[data-key="a"]')).toBe(alpha);
    expect(list.querySelector('[data-key="x"]')).toBe(xray);
    expect(rangeSnapshot(list)).toEqual([
      "d:0:0:Delta",
      "c:1:1:Gamma",
      "b:2:2:Beta",
      "a:3:3:Alpha",
      "y:0:0:Yankee",
      "z:1:1:Zulu",
      "x:2:2:Xray",
    ]);
    expect(footer.textContent).toBe("7 total");
    expect(insertBefore).toHaveBeenCalledTimes(5);
    expect(metrics.executions).toBe(initialExecutions);
    expect(metrics.rangeRenders).toBe(initialRangeRenders);
  });

  it("handles adjacent empty ranges and transitions in both directions", async () => {
    let update: (next: CompilerStateUpdater) => void = () => undefined;
    const AdjacentRanges = createCompiledComponent({
      displayName: "AdjacentRanges",
      initialize: () => [{ primary: [], secondary: [] } satisfies RangeModel],
      render(_props: Record<string, never>, state, blocks) {
        update = (next) => state[0].set(next);
        const model = () => state[0].get() as RangeModel;
        const KeyedRanges = blocks.KeyedRanges;
        return (
          <main>
            <KeyedRanges
              id={0}
              ranges={[
                rangeDescriptor(1, () => model().primary),
                rangeDescriptor(0, () => model().secondary),
              ]}
              render={() => (
                <ol>
                  <li data-static="header">Header</li>
                  {model().primary.map((item, index) => (
                    <li data-index={index} data-key={item.id} key={item.id}>
                      {index}:{item.label}
                    </li>
                  ))}
                  {model().secondary.map((item, index) => (
                    <li data-index={index} data-key={item.id} key={item.id}>
                      {index}:{item.label}
                    </li>
                  ))}
                  <li data-static="footer">Footer</li>
                </ol>
              )}
              trailing={1}
            />
          </main>
        );
      },
      bindings: [{ kind: "block", id: 0, dependencies: [0] }],
    });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.add(root);
    await act(async () => root.render(<AdjacentRanges />));
    const footer = container.querySelector('[data-static="footer"]')!;

    await act(async () => {
      update({
        primary: [{ id: "a", label: "Alpha" }],
        secondary: [{ id: "x", label: "Xray" }],
      });
      await flushCompilerUpdates();
    });
    expect(rangeSnapshot(container)).toEqual(["a:0:0:Alpha", "x:0:0:Xray"]);
    expect(container.querySelector('[data-static="footer"]')).toBe(footer);

    await act(async () => {
      update({ primary: [], secondary: [] });
      await flushCompilerUpdates();
    });
    expect(rangeSnapshot(container)).toEqual([]);
    expect(container.querySelector('[data-static="footer"]')).toBe(footer);
  });

  it.each([
    ["nested container", false],
    ["component root", true],
  ])("switches the complete %s to React when runtime keys collide", async (_label, rootOwned) => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const metrics = { executions: 0, rangeRenders: 0 };
    const board = defineRangeBoard(metrics, rootOwned);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.add(root);
    await act(async () => root.render(<board.RangeBoard />));
    const originalList = container.querySelector("ul")!;

    await act(async () => {
      board.updateModel((current) => {
        const model = current as RangeModel;
        return {
          ...model,
          primary: [
            { id: "duplicate", label: "One" },
            { id: "duplicate", label: "Two" },
          ],
        };
      });
      await flushCompilerUpdates();
    });

    expect(container.querySelector("ul")).not.toBe(originalList);
    expect(metrics.rangeRenders).toBe(2);
    expect(container.querySelectorAll('[data-key="duplicate"]')).toHaveLength(2);

    await act(async () => {
      board.updateModel((current) => ({
        ...(current as RangeModel),
        primary: [{ id: "safe", label: "Safe" }],
      }));
      await flushCompilerUpdates();
    });
    expect(container.querySelector('[data-key="safe"]')?.textContent).toBe("0:Safe");
    expect(metrics.rangeRenders).toBe(3);
  });

  it("routes root-range update errors through the nearest error boundary", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    let update: (next: CompilerStateUpdater) => void = () => undefined;
    const ThrowingRoot = createCompiledComponent({
      displayName: "ThrowingRootRange",
      initialize: () => [[{ id: "a", label: "Alpha" }]],
      render(_props: Record<string, never>, state, blocks) {
        const items = () => state[0].get() as RangeItem[];
        update = (next) => state[0].set(next);
        const KeyedRanges = blocks.KeyedRanges;
        const descriptor = rangeDescriptor(0, items);
        return (
          <KeyedRanges
            id={0}
            ranges={[
              {
                ...descriptor,
                create: (item, index) => {
                  if ((item as RangeItem).label === "Throw") {
                    throw new Error("root keyed range failed");
                  }
                  return descriptor.create(item, index);
                },
              },
            ]}
            render={() => (
              <ul>
                {items().map((item, index) => (
                  <li data-index={index} data-key={item.id} key={item.id}>
                    {index}:{item.label}
                  </li>
                ))}
              </ul>
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
    await act(async () =>
      root.render(
        <RootRangeErrorBoundary>
          <ThrowingRoot />
        </RootRangeErrorBoundary>,
      ),
    );

    await act(async () => {
      update([{ id: "broken", label: "Throw" }]);
      await flushCompilerUpdates();
    });

    expect(container.querySelector('[role="alert"]')?.textContent).toBe("root keyed range failed");
  });

  it.each([
    ["nested container", false],
    ["component root", true],
  ])(
    "recovers %s hydration mismatches in StrictMode and drops queued work after unmount",
    async (_label, rootOwned) => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      const metrics = { executions: 0, rangeRenders: 0 };
      const board = defineRangeBoard(metrics, rootOwned);
      const serverHtml = renderToString(
        <StrictMode>
          <board.RangeBoard />
        </StrictMode>,
      );
      const container = document.createElement("div");
      container.innerHTML = serverHtml.replace("Primary", "Server mismatch");
      document.body.append(container);
      const recoverable = vi.fn();
      const root = hydrateRoot(
        container,
        <StrictMode>
          <board.RangeBoard />
        </StrictMode>,
        { onRecoverableError: recoverable },
      );
      roots.add(root);
      await act(async () => flushCompilerUpdates());
      expect(recoverable).toHaveBeenCalled();

      await act(async () => {
        board.updateModel((current) => ({
          ...(current as RangeModel),
          primary: [{ id: "hydrated", label: "Hydrated" }],
        }));
        await flushCompilerUpdates();
      });
      expect(container.querySelector('[data-key="hydrated"]')?.textContent).toBe("0:Hydrated");

      await act(async () => {
        board.updateModel({ primary: [], secondary: [] });
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
      const board = defineRangeBoard(metrics, rootOwned);
      const container = document.createElement("div");
      document.body.append(container);
      const root = createRoot(container);
      roots.add(root);
      await act(async () => root.render(<board.RangeBoard title="First" />));
      const originalList = container.querySelector("ul")!;

      await act(async () => {
        root.render(<board.RangeBoard title="Second" />);
        await flushCompilerUpdates();
      });

      if (!rootOwned) expect(container.querySelector("h1")?.textContent).toBe("Second");
      expect(container.querySelector('[data-static="header"]')?.textContent).toBe("Second 4");
      expect(container.querySelector("ul")).not.toBe(originalList);
      expect(metrics.rangeRenders).toBe(2);
    },
  );

  it.each([
    ["nested container", false],
    ["component root", true],
  ])(
    "matches normal React through 2,000 deterministic %s transitions",
    async (_label, rootOwned) => {
      const metrics = { executions: 0, rangeRenders: 0 };
      const compiled = defineRangeBoard(metrics, rootOwned);
      let normalModel = compiled.initial;
      let setNormal: React.Dispatch<React.SetStateAction<RangeModel>> = () => undefined;

      function NormalBoard() {
        const [model, setModel] = useState(compiled.initial);
        normalModel = model;
        setNormal = setModel;
        return (
          <ul>
            <li className={model.primary.length > 2 ? "many" : "few"} data-static="header">
              Primary {model.primary.length}
            </li>
            {model.primary.map((item, index) => (
              <li data-index={index} data-key={item.id} key={item.id}>
                {index}:{item.label}
              </li>
            ))}
            <li data-static="divider">Secondary {model.secondary.length}</li>
            {model.secondary.map((item, index) => (
              <li data-index={index} data-key={item.id} key={item.id}>
                {index}:{item.label}
              </li>
            ))}
            <li
              data-static="footer"
              style={{ width: model.primary.length + model.secondary.length }}
            >
              {model.primary.length + model.secondary.length} total
            </li>
          </ul>
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
        compiledRoot.render(<compiled.RangeBoard />);
        normalRoot.render(<NormalBoard />);
      });

      let seed = 0x9e3779b9;
      const random = () => {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        return seed;
      };
      const operations = Array.from({ length: 2000 }, (_, step) => ({
        operation: random() % 7,
        selector: random(),
        step,
      }));
      const update = (model: RangeModel, step: number): RangeModel => {
        const { operation, selector } = operations[step];
        const side = selector % 2 === 0 ? "primary" : "secondary";
        const other = side === "primary" ? "secondary" : "primary";
        const rows = model[side];
        if (operation === 0 && rows.length > 0) {
          const target = selector % rows.length;
          return {
            ...model,
            [side]: rows.map((row, index) =>
              index === target ? { ...row, label: `${row.label}.${step}` } : row,
            ),
          };
        }
        if (operation === 1 && rows.length < 24) {
          const id = `${side[0]}${step}`;
          return { ...model, [side]: [...rows, { id, label: `Item ${step}` }] };
        }
        if (operation === 2 && rows.length > 0) {
          return { ...model, [side]: rows.slice(1) };
        }
        if (operation === 3) return { ...model, [side]: [...rows].reverse() };
        if (operation === 4 && rows.length > 1) {
          return { ...model, [side]: [...rows.slice(1), rows[0]] };
        }
        if (operation === 5 && rows.length > 0) {
          const target = selector % rows.length;
          const moved = rows[target];
          return {
            ...model,
            [side]: rows.filter((_, index) => index !== target),
            [other]: [...model[other], moved],
          };
        }
        return model;
      };
      const snapshot = (container: Element) => ({
        rows: rangeSnapshot(container),
        footer: container.querySelector('[data-static="footer"]')?.textContent,
      });
      const initialExecutions = metrics.executions;
      const initialRangeRenders = metrics.rangeRenders;

      for (let offset = 0; offset < operations.length; offset += 20) {
        await act(async () => {
          for (let step = offset; step < offset + 20; step += 1) {
            const updater = (current: RangeModel) => update(current, step);
            compiled.updateModel((current) => updater(current as RangeModel));
            setNormal(updater);
          }
          await flushCompilerUpdates();
        });
        expect(compiled.readModel(), `model after batch ${offset}`).toEqual(normalModel);
        expect(snapshot(compiledContainer), `DOM after batch ${offset}`).toEqual(
          snapshot(normalContainer),
        );
      }

      expect(metrics.executions).toBe(initialExecutions);
      expect(metrics.rangeRenders).toBe(initialRangeRenders);
    },
    30_000,
  );
});
