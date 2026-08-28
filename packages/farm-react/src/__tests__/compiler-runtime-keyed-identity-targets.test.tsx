import React, { StrictMode, useState } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCompiledComponent, type CompilerStateUpdater } from "../compiler-runtime";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

interface Item {
  id: string;
  label: string;
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

async function flushCompilerUpdates(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function items(count: number): Item[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `row-${index}`,
    label: `Row ${index}`,
  }));
}

describe("compiled keyed identity targets", () => {
  it("evaluates only the previous and next keyed instances", async () => {
    const initial = items(2_000);
    let executions = 0;
    let bindingReads = 0;
    let setSelected: (next: CompilerStateUpdater) => void = () => undefined;
    const Rows = createCompiledComponent({
      displayName: "IdentityTargetRows",
      initialize: () => [initial, null],
      render(_props: Record<string, never>, state, blocks) {
        executions += 1;
        const readItems = () => state[0].get() as Item[];
        const selected = () => state[1].get() as string | null;
        setSelected = (next) => state[1].set(next);
        const KeyedRows = blocks.KeyedRows;
        return (
          <main>
            <KeyedRows
              bindings={[
                {
                  dependencies: [1],
                  identityTarget: { dependency: 1, read: selected },
                  kind: "attribute",
                  name: "data-selected",
                  path: [],
                  read: (item) => {
                    bindingReads += 1;
                    return (item as Item).id === selected();
                  },
                },
              ]}
              create={(item) => ({
                kind: "element",
                tag: "li",
                attributes: [
                  { name: "data-key", value: (item as Item).id },
                  { name: "data-selected", value: (item as Item).id === selected() },
                ],
                styles: [],
                children: [(item as Item).label],
              })}
              id={0}
              items={readItems}
              render={() => (
                <ul>
                  {readItems().map((item) => (
                    <li data-key={item.id} data-selected={item.id === selected()} key={item.id}>
                      {item.label}
                    </li>
                  ))}
                </ul>
              )}
              rowKey={(item) => (item as Item).id}
              structureDependencies={[0]}
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
    await act(async () => root.render(<Rows />));

    bindingReads = 0;
    await act(async () => {
      setSelected("row-1500");
      await flushCompilerUpdates();
    });
    expect(bindingReads).toBe(1);
    expect(container.querySelector('[data-key="row-1500"]')?.getAttribute("data-selected")).toBe(
      "true",
    );

    bindingReads = 0;
    await act(async () => {
      setSelected("row-12");
      await flushCompilerUpdates();
    });
    expect(bindingReads).toBe(2);
    expect(container.querySelector('[data-key="row-1500"]')?.getAttribute("data-selected")).toBe(
      "false",
    );
    expect(container.querySelector('[data-key="row-12"]')?.getAttribute("data-selected")).toBe(
      "true",
    );

    bindingReads = 0;
    await act(async () => {
      setSelected(null);
      await flushCompilerUpdates();
    });
    expect(bindingReads).toBe(1);
    expect(executions).toBe(1);
  });

  it("targets nullish runtime keys after the keyed runtime coerces them", async () => {
    const initial = [
      { id: null, label: "Null row" },
      { id: undefined, label: "Undefined row" },
    ];
    let bindingReads = 0;
    let setSelected: (next: CompilerStateUpdater) => void = () => undefined;
    const Rows = createCompiledComponent({
      displayName: "NullishIdentityTargetRows",
      initialize: () => [initial, "missing"],
      render(_props: Record<string, never>, state, blocks) {
        const readItems = () => state[0].get() as typeof initial;
        const selected = () => state[1].get() as string | null | undefined;
        setSelected = (next) => state[1].set(next);
        const KeyedRows = blocks.KeyedRows;
        return (
          <main>
            <KeyedRows
              bindings={[
                {
                  dependencies: [1],
                  identityTarget: { dependency: 1, read: selected },
                  kind: "attribute",
                  name: "data-selected",
                  path: [],
                  read: (item) => {
                    bindingReads += 1;
                    return (item as (typeof initial)[number]).id === selected();
                  },
                },
              ]}
              create={(item) => ({
                kind: "element",
                tag: "li",
                attributes: [
                  { name: "data-key", value: String((item as (typeof initial)[number]).id) },
                ],
                styles: [],
                children: [(item as (typeof initial)[number]).label],
              })}
              id={0}
              items={readItems}
              render={() => (
                <ul>
                  {readItems().map((item) => (
                    <li
                      data-key={String(item.id)}
                      data-selected={item.id === selected()}
                      key={String(item.id)}
                    >
                      {item.label}
                    </li>
                  ))}
                </ul>
              )}
              rowKey={(item) => (item as (typeof initial)[number]).id as unknown as React.Key}
              structureDependencies={[0]}
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
    await act(async () => root.render(<Rows />));

    bindingReads = 0;
    await act(async () => {
      setSelected(null);
      await flushCompilerUpdates();
    });
    expect(bindingReads).toBe(1);
    expect(
      [...container.querySelectorAll("li")].map((element) => [
        element.getAttribute("data-key"),
        element.getAttribute("data-selected"),
      ]),
    ).toEqual([
      ["null", "true"],
      ["undefined", "false"],
    ]);

    bindingReads = 0;
    await act(async () => {
      setSelected(undefined);
      await flushCompilerUpdates();
    });
    expect(bindingReads).toBe(2);
    expect(
      [...container.querySelectorAll("li")].map((element) => [
        element.getAttribute("data-key"),
        element.getAttribute("data-selected"),
      ]),
    ).toEqual([
      ["null", "false"],
      ["undefined", "true"],
    ]);
  });

  it("falls back to a complete scan for untrusted targets, then resumes targeting", async () => {
    const initial = items(64);
    let bindingReads = 0;
    let setSelected: (next: CompilerStateUpdater) => void = () => undefined;
    const Rows = createCompiledComponent({
      displayName: "GuardedIdentityTargets",
      initialize: () => [initial, { id: "row-0" }],
      render(_props: Record<string, never>, state, blocks) {
        const readItems = () => state[0].get() as Item[];
        const selected = () => state[1].get();
        setSelected = (next) => state[1].set(next);
        const KeyedRows = blocks.KeyedRows;
        return (
          <main>
            <KeyedRows
              bindings={[
                {
                  dependencies: [1],
                  identityTarget: { dependency: 1, read: selected },
                  kind: "attribute",
                  name: "data-selected",
                  path: [],
                  read: (item) => {
                    bindingReads += 1;
                    return (item as Item).id === selected();
                  },
                },
              ]}
              create={(item) => ({
                kind: "element",
                tag: "li",
                attributes: [],
                styles: [],
                children: [(item as Item).label],
              })}
              id={0}
              items={readItems}
              render={() => (
                <ul>
                  {readItems().map((item) => (
                    <li data-selected={item.id === selected()} key={item.id}>
                      {item.label}
                    </li>
                  ))}
                </ul>
              )}
              rowKey={(item) => (item as Item).id}
              structureDependencies={[0]}
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
    await act(async () => root.render(<Rows />));

    bindingReads = 0;
    await act(async () => {
      setSelected("row-4");
      await flushCompilerUpdates();
    });
    expect(bindingReads).toBe(initial.length);

    bindingReads = 0;
    await act(async () => {
      setSelected("row-5");
      await flushCompilerUpdates();
    });
    expect(bindingReads).toBe(2);
  });

  it("uses complete reconciliation for mixed structural work and refreshes its target cache", async () => {
    const initial = items(100);
    let bindingReads = 0;
    let targetReads = 0;
    let setRows: (next: CompilerStateUpdater) => void = () => undefined;
    let setSelected: (next: CompilerStateUpdater) => void = () => undefined;
    const Rows = createCompiledComponent({
      displayName: "MixedIdentityTargetUpdate",
      initialize: () => [initial, "row-1"],
      render(_props: Record<string, never>, state, blocks) {
        const readItems = () => state[0].get() as Item[];
        const selected = () => state[1].get() as string | null;
        const identityTarget = () => {
          targetReads += 1;
          return selected();
        };
        setRows = (next) => state[0].set(next);
        setSelected = (next) => state[1].set(next);
        const KeyedRows = blocks.KeyedRows;
        return (
          <main>
            <KeyedRows
              bindings={[
                {
                  dependencies: [1],
                  identityTarget: { dependency: 1, read: identityTarget },
                  kind: "attribute",
                  name: "data-selected",
                  path: [],
                  read: (item) => {
                    bindingReads += 1;
                    return (item as Item).id === selected();
                  },
                },
                {
                  dependencies: [0],
                  kind: "text",
                  path: [],
                  read: (item) => [(item as Item).label],
                },
              ]}
              create={(item) => ({
                kind: "element",
                tag: "li",
                attributes: [{ name: "data-key", value: (item as Item).id }],
                styles: [],
                children: [(item as Item).label],
              })}
              id={0}
              items={readItems}
              render={() => (
                <ul>
                  {readItems().map((item) => (
                    <li data-key={item.id} data-selected={item.id === selected()} key={item.id}>
                      {item.label}
                    </li>
                  ))}
                </ul>
              )}
              rowKey={(item) => (item as Item).id}
              structureDependencies={[0]}
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
    await act(async () => root.render(<Rows />));

    bindingReads = 0;
    targetReads = 0;
    await act(async () => {
      setRows((current) =>
        (current as Item[]).map((item) =>
          item.id === "row-10" ? { ...item, label: "Structural update" } : item,
        ),
      );
      await flushCompilerUpdates();
    });
    expect(bindingReads).toBe(initial.length);
    expect(targetReads).toBe(0);

    bindingReads = 0;
    targetReads = 0;
    await act(async () => {
      setSelected("row-80");
      setRows((current) =>
        (current as Item[]).map((item) =>
          item.id === "row-80" ? { ...item, label: "Updated row" } : item,
        ),
      );
      await flushCompilerUpdates();
    });
    expect(bindingReads).toBe(initial.length);
    expect(targetReads).toBe(1);
    expect(container.querySelector('[data-key="row-80"]')?.textContent).toBe("Updated row");

    bindingReads = 0;
    targetReads = 0;
    await act(async () => {
      setSelected("row-81");
      await flushCompilerUpdates();
    });
    expect(bindingReads).toBe(2);
    expect(targetReads).toBe(1);
  });

  it("matches React across queued randomized selections", async () => {
    const initial = items(128);
    let reads = 0;
    let compiledSet: (next: CompilerStateUpdater) => void = () => undefined;
    let reactSet: React.Dispatch<React.SetStateAction<string | null>> = () => undefined;
    const Compiled = createCompiledComponent({
      displayName: "RandomIdentityTargets",
      initialize: () => [initial, null],
      render(_props: Record<string, never>, state, blocks) {
        const readItems = () => state[0].get() as Item[];
        const selected = () => state[1].get() as string | null;
        compiledSet = (next) => state[1].set(next);
        const KeyedRows = blocks.KeyedRows;
        return (
          <main>
            <KeyedRows
              bindings={[
                {
                  dependencies: [1],
                  identityTarget: { dependency: 1, read: selected },
                  kind: "attribute",
                  name: "data-selected",
                  path: [],
                  read: (item) => {
                    reads += 1;
                    return (item as Item).id === selected();
                  },
                },
              ]}
              create={(item) => ({
                kind: "element",
                tag: "li",
                attributes: [{ name: "data-key", value: (item as Item).id }],
                styles: [],
                children: [(item as Item).label],
              })}
              id={0}
              items={readItems}
              render={() => (
                <ul>
                  {readItems().map((item) => (
                    <li data-key={item.id} data-selected={item.id === selected()} key={item.id}>
                      {item.label}
                    </li>
                  ))}
                </ul>
              )}
              rowKey={(item) => (item as Item).id}
              structureDependencies={[0]}
            />
          </main>
        );
      },
      bindings: [{ kind: "block", id: 0, dependencies: [0, 1] }],
    });

    function Normal() {
      const [selected, setSelected] = useState<string | null>(null);
      reactSet = setSelected;
      return (
        <ul>
          {initial.map((item) => (
            <li data-key={item.id} data-selected={item.id === selected} key={item.id}>
              {item.label}
            </li>
          ))}
        </ul>
      );
    }

    const compiledContainer = document.createElement("div");
    const reactContainer = document.createElement("div");
    document.body.append(compiledContainer, reactContainer);
    const compiledRoot = createRoot(compiledContainer);
    const reactRoot = createRoot(reactContainer);
    roots.push(compiledRoot, reactRoot);
    await act(async () => {
      compiledRoot.render(<Compiled />);
      reactRoot.render(<Normal />);
    });

    let random = 0x51ec7ed;
    const nextTarget = () => {
      random = (Math.imul(random, 1_664_525) + 1_013_904_223) >>> 0;
      if (random % 11 === 0) return null;
      if (random % 13 === 0) return `missing-${random}`;
      return `row-${random % initial.length}`;
    };
    const snapshot = (container: Element) =>
      [...container.querySelectorAll("li")].map((row) => row.getAttribute("data-selected"));

    for (let batch = 0; batch < 100; batch += 1) {
      reads = 0;
      await act(async () => {
        for (let update = 0; update < 20; update += 1) {
          const target = nextTarget();
          compiledSet(target);
          reactSet(target);
        }
        await flushCompilerUpdates();
      });
      expect(reads, `targeted reads in batch ${batch}`).toBeLessThanOrEqual(2);
      expect(snapshot(compiledContainer), `DOM after batch ${batch}`).toEqual(
        snapshot(reactContainer),
      );
    }
  });

  it("is StrictMode-safe and drops a queued target update after unmount", async () => {
    const initial = items(16);
    let reads = 0;
    let setSelected: (next: CompilerStateUpdater) => void = () => undefined;
    const Rows = createCompiledComponent({
      displayName: "UnmountedIdentityTarget",
      initialize: () => [initial, null],
      render(_props: Record<string, never>, state, blocks) {
        const readItems = () => state[0].get() as Item[];
        const selected = () => state[1].get() as string | null;
        setSelected = (next) => state[1].set(next);
        const KeyedRows = blocks.KeyedRows;
        return (
          <main>
            <KeyedRows
              bindings={[
                {
                  dependencies: [1],
                  identityTarget: { dependency: 1, read: selected },
                  kind: "attribute",
                  name: "data-selected",
                  path: [],
                  read: (item) => {
                    reads += 1;
                    return (item as Item).id === selected();
                  },
                },
              ]}
              create={(item) => ({
                kind: "element",
                tag: "li",
                attributes: [],
                styles: [],
                children: [(item as Item).label],
              })}
              id={0}
              items={readItems}
              render={() => (
                <ul>
                  {readItems().map((item) => (
                    <li data-selected={item.id === selected()} key={item.id}>
                      {item.label}
                    </li>
                  ))}
                </ul>
              )}
              rowKey={(item) => (item as Item).id}
              structureDependencies={[0]}
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
    await act(async () =>
      root.render(
        <StrictMode>
          <Rows />
        </StrictMode>,
      ),
    );

    reads = 0;
    await act(async () => {
      setSelected("row-8");
      root.unmount();
      roots.splice(roots.indexOf(root), 1);
      await flushCompilerUpdates();
    });
    expect(reads).toBe(0);
    expect(container.childElementCount).toBe(0);
  });
});
