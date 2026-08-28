import React, { StrictMode, useState } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCompiledComponent, type CompilerStateUpdater } from "../compiler-runtime";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

interface Item {
  id: unknown;
  label: string;
}

interface Counters {
  bindingReads: number;
  executions: number;
  targetReads: number;
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

function createMembershipHarness(initialItems: Item[], initialMembership: Set<unknown>) {
  const counters: Counters = { bindingReads: 0, executions: 0, targetReads: 0 };
  let updateItems: (next: CompilerStateUpdater) => void = () => undefined;
  let updateMembership: (next: CompilerStateUpdater) => void = () => undefined;
  const Rows = createCompiledComponent({
    displayName: "MembershipTargetRows",
    initialize: () => [initialItems, initialMembership],
    render(_props: Record<string, never>, state, blocks) {
      counters.executions += 1;
      const readItems = () => state[0].get() as Item[];
      const membership = () => state[1].get() as Set<unknown>;
      const membershipTarget = () => {
        counters.targetReads += 1;
        return membership();
      };
      updateItems = (next) => state[0].set(next);
      updateMembership = (next) => state[1].set(next);
      const KeyedRows = blocks.KeyedRows;
      return (
        <main>
          <KeyedRows
            bindings={[
              {
                dependencies: [1],
                membershipTarget: { dependency: 1, read: membershipTarget },
                kind: "attribute",
                name: "data-marked",
                path: [],
                read: (item) => {
                  counters.bindingReads += 1;
                  return membership().has((item as Item).id);
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
              attributes: [
                { name: "data-key", value: String((item as Item).id) },
                { name: "data-marked", value: membership().has((item as Item).id) },
              ],
              styles: [],
              children: [(item as Item).label],
            })}
            id={0}
            items={readItems}
            render={() => (
              <ul>
                {readItems().map((item) => (
                  <li
                    data-key={String(item.id)}
                    data-marked={membership().has(item.id)}
                    key={String(item.id)}
                  >
                    {item.label}
                  </li>
                ))}
              </ul>
            )}
            rowKey={(item) => (item as Item).id as React.Key}
            structureDependencies={[0]}
          />
        </main>
      );
    },
    bindings: [{ kind: "block", id: 0, dependencies: [0, 1] }],
  });
  return {
    Rows,
    counters,
    setItems: (next: CompilerStateUpdater) => updateItems(next),
    setMembership: (next: CompilerStateUpdater) => updateMembership(next),
  };
}

function membershipSnapshot(container: Element): Array<[string | null, string | null]> {
  return [...container.querySelectorAll("li")].map((row) => [
    row.getAttribute("data-key"),
    row.getAttribute("data-marked"),
  ]);
}

describe("compiled keyed membership targets", () => {
  it("evaluates only keys in the Set symmetric difference", async () => {
    const initial = items(2_000);
    const harness = createMembershipHarness(initial, new Set(["row-10"]));
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<harness.Rows />));

    harness.counters.bindingReads = 0;
    harness.counters.targetReads = 0;
    await act(async () => {
      harness.setMembership(new Set(["row-10", "row-1500"]));
      await flushCompilerUpdates();
    });
    expect(harness.counters.bindingReads).toBe(1);
    expect(harness.counters.targetReads).toBe(1);

    harness.counters.bindingReads = 0;
    await act(async () => {
      harness.setMembership(new Set(["row-12", "row-1501"]));
      await flushCompilerUpdates();
    });
    expect(harness.counters.bindingReads).toBe(4);
    expect(
      [...container.querySelectorAll('[data-marked="true"]')].map((row) =>
        row.getAttribute("data-key"),
      ),
    ).toEqual(["row-12", "row-1501"]);

    harness.counters.bindingReads = 0;
    await act(async () => {
      harness.setMembership(new Set(["row-12", "row-1501"]));
      await flushCompilerUpdates();
    });
    expect(harness.counters.bindingReads).toBe(0);
    expect(harness.counters.executions).toBe(1);
  });

  it("preserves Set equality when different primitive values share one React key string", async () => {
    const initial: Item[] = [
      { id: null, label: "Null" },
      { id: undefined, label: "Undefined" },
      { id: 1, label: "Number" },
    ];
    const harness = createMembershipHarness(initial, new Set([null, 1]));
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<harness.Rows />));

    harness.counters.bindingReads = 0;
    await act(async () => {
      harness.setMembership(new Set([undefined, "1"]));
      await flushCompilerUpdates();
    });

    expect(harness.counters.bindingReads).toBe(3);
    expect(membershipSnapshot(container)).toEqual([
      ["null", "false"],
      ["undefined", "true"],
      ["1", "false"],
    ]);
  });

  it("uses complete reconciliation for mixed structural work and refreshes its cache", async () => {
    const initial = items(100);
    const harness = createMembershipHarness(initial, new Set(["row-1"]));
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<harness.Rows />));

    harness.counters.bindingReads = 0;
    harness.counters.targetReads = 0;
    await act(async () => {
      harness.setMembership(new Set(["row-80"]));
      harness.setItems((current) =>
        (current as Item[]).map((item) =>
          item.id === "row-80" ? { ...item, label: "Updated row" } : item,
        ),
      );
      await flushCompilerUpdates();
    });
    expect(harness.counters.bindingReads).toBe(initial.length);
    expect(harness.counters.targetReads).toBe(2);
    expect(container.querySelector('[data-key="row-80"]')?.textContent).toBe("Updated row");

    harness.counters.bindingReads = 0;
    await act(async () => {
      harness.setMembership(new Set(["row-81"]));
      await flushCompilerUpdates();
    });
    expect(harness.counters.bindingReads).toBe(2);
  });

  it("hands customized Set values back to React before evaluating compiled bindings", async () => {
    class CustomizedSet extends Set<unknown> {}
    const initial = items(32);
    const harness = createMembershipHarness(initial, new CustomizedSet(["row-1"]));
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<harness.Rows />));

    expect(harness.counters.bindingReads).toBe(0);
    await act(async () => {
      harness.setMembership(new CustomizedSet(["row-20"]));
      await flushCompilerUpdates();
    });

    expect(harness.counters.bindingReads).toBe(0);
    expect(container.querySelector('[data-key="row-20"]')?.getAttribute("data-marked")).toBe(
      "true",
    );
    expect(harness.counters.executions).toBe(1);
  });

  it("keeps an own Set has override under React ownership", async () => {
    const customized = new Set<unknown>(["row-1"]);
    Object.defineProperty(customized, "has", {
      configurable: true,
      value: (value: unknown) => value === "row-1",
    });
    const harness = createMembershipHarness(items(8), customized);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<harness.Rows />));

    expect(harness.counters.bindingReads).toBe(0);
    expect(container.querySelector('[data-key="row-1"]')?.getAttribute("data-marked")).toBe("true");
    expect(container.querySelector('[data-key="row-2"]')?.getAttribute("data-marked")).toBe(
      "false",
    );
  });

  it("matches React across 2,000 randomized queued updates", async () => {
    const initial = items(128);
    const harness = createMembershipHarness(initial, new Set());
    let reactSet: React.Dispatch<React.SetStateAction<Set<unknown>>> = () => undefined;
    function Normal() {
      const [membership, setMembership] = useState<Set<unknown>>(new Set());
      reactSet = setMembership;
      return (
        <ul>
          {initial.map((item) => (
            <li
              data-key={String(item.id)}
              data-marked={membership.has(item.id)}
              key={String(item.id)}
            >
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
      compiledRoot.render(<harness.Rows />);
      reactRoot.render(<Normal />);
    });

    harness.counters.bindingReads = 0;
    let random = 0x5e7a11;
    const nextRandom = () => (random = (Math.imul(random, 1_664_525) + 1_013_904_223) >>> 0);
    let committed = new Set<unknown>();
    for (let batch = 0; batch < 100; batch += 1) {
      let final = committed;
      await act(async () => {
        for (let update = 0; update < 20; update += 1) {
          const size = nextRandom() % 9;
          const next = new Set<unknown>();
          for (let index = 0; index < size; index += 1) {
            const value = nextRandom();
            next.add(value % 13 === 0 ? `missing-${value}` : `row-${value % initial.length}`);
          }
          final = next;
          harness.setMembership(next);
          reactSet(next);
        }
        await flushCompilerUpdates();
      });
      const changed = new Set(
        [...committed, ...final].filter((value) => committed.has(value) !== final.has(value)),
      );
      const presentChanged = [...changed].filter((value) =>
        initial.some((item) => Object.is(item.id, value)),
      ).length;
      expect(harness.counters.bindingReads, `targeted reads in batch ${batch}`).toBe(
        presentChanged,
      );
      expect(membershipSnapshot(compiledContainer), `DOM after batch ${batch}`).toEqual(
        membershipSnapshot(reactContainer),
      );
      committed = final;
      harness.counters.bindingReads = 0;
    }
  });

  it("is StrictMode-safe and drops a queued membership update after unmount", async () => {
    const harness = createMembershipHarness(items(16), new Set());
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () =>
      root.render(
        <StrictMode>
          <harness.Rows />
        </StrictMode>,
      ),
    );

    harness.counters.bindingReads = 0;
    await act(async () => {
      harness.setMembership(new Set(["row-8"]));
      root.unmount();
      roots.splice(roots.indexOf(root), 1);
      await flushCompilerUpdates();
    });
    expect(harness.counters.bindingReads).toBe(0);
    expect(container.childElementCount).toBe(0);
  });
});
