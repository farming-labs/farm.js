import React, { StrictMode, act } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCompiledComponent, type CompilerKeyedRowElement } from "../compiler-runtime";

interface Row {
  id: number;
  label: string;
  title: string | null;
  opacity: number;
}

const roots: Root[] = [];

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  vi.restoreAllMocks();
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.replaceChildren();
});

class Boundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? <p>Recovered</p> : this.props.children;
  }
}

async function mount(reactivity: "static" | "hybrid", hydrate: boolean) {
  const container = document.createElement("div");
  document.body.append(container);
  const initial: Row[] = [1, 2, 3].map((id) => ({
    id,
    label: `Row ${id}`,
    title: "old",
    opacity: 1,
  }));
  const reads: Array<{ field: string; row: number; text: string | null }> = [];
  let fail = false;
  let setRows: (next: Row[]) => void = () => undefined;
  const read = (item: unknown, field: "label" | "title" | "opacity") => {
    const row = item as Row;
    reads.push({ field, row: row.id, text: container.querySelector("ul")?.textContent ?? null });
    if (fail && row.id === 2 && field === "opacity") throw new Error("late binding failed");
    return row[field];
  };
  const descriptor = (row: Row): CompilerKeyedRowElement => ({
    kind: "element",
    tag: "li",
    attributes: [{ name: "title", value: row.title }],
    styles: [{ name: "opacity", value: row.opacity }],
    children: [
      {
        kind: "element",
        tag: "input",
        attributes: [{ name: "value", value: "draft" }],
        styles: [],
        children: [],
      },
      { kind: "element", tag: "span", attributes: [], styles: [], children: [row.label] },
    ],
  });
  const List = createCompiledComponent({
    displayName: "PreparedBindingRows",
    reactivity,
    initialize: () => [initial],
    render(_props: Record<string, never>, state, blocks) {
      setRows = (next) => state[0].set(next);
      const items = () => state[0].get() as Row[];
      return (
        <section>
          <blocks.KeyedRows
            id={0}
            items={items}
            rowKey={(item) => (item as Row).id}
            create={(item) => descriptor(item as Row)}
            bindings={[
              { kind: "text", path: [1], read: (item) => [read(item, "label")] },
              { kind: "attribute", name: "title", path: [], read: (item) => read(item, "title") },
              { kind: "style", name: "opacity", path: [], read: (item) => read(item, "opacity") },
            ]}
            render={() => (
              <ul>
                {items().map((row) => (
                  <li key={row.id} title={row.title ?? undefined} style={{ opacity: row.opacity }}>
                    <input defaultValue="draft" />
                    <span>{row.label}</span>
                  </li>
                ))}
              </ul>
            )}
          />
        </section>
      );
    },
    bindings: [{ kind: "block", id: 0, dependencies: [0] }],
  });
  const element = (
    <StrictMode>
      <Boundary>
        <List />
      </Boundary>
    </StrictMode>
  );
  if (hydrate) container.innerHTML = renderToString(element);
  await act(async () => {
    if (hydrate) roots.push(hydrateRoot(container, element));
    else {
      const root = createRoot(container);
      roots.push(root);
      root.render(element);
    }
  });
  reads.length = 0;
  return {
    container,
    initial,
    reads,
    fail: () => {
      fail = true;
    },
    update: async (next: Row[]) => {
      await act(async () => {
        setRows(next);
        await Promise.resolve();
        await Promise.resolve();
      });
    },
  };
}

describe.each(["static", "hybrid"] as const)("prepared keyed bindings (%s)", (reactivity) => {
  describe.each([false, true])("hydrate=%s", (hydrate) => {
    it.each(["label", "title", "opacity"] as const)(
      "does not wrap a single changed %s binding in another array",
      async (field) => {
        const view = await mount(reactivity, hydrate);
        const parents = new Set<unknown[]>();
        const push = Array.prototype.push;
        Array.prototype.push = function (this: unknown[], ...values: unknown[]) {
          const value = values[0];
          if (
            values.length === 1 &&
            Array.isArray(value) &&
            value.length === 3 &&
            typeof value[0] === "number" &&
            value[1] instanceof Element
          )
            parents.add(this);
          return Reflect.apply(push, this, values);
        };
        try {
          await view.update(
            view.initial.map((row) => ({
              ...row,
              label: field === "label" ? `${row.label}!` : row.label,
              title: field === "title" ? null : row.title,
              opacity: field === "opacity" ? 0 : row.opacity,
            })),
          );
        } finally {
          Array.prototype.push = push;
        }
        // A row-set array can receive a tuple, but has three entries. Only
        // the redundant per-row wrapper contains exactly one update tuple.
        expect([...parents].filter((parent) => parent.length === 1)).toEqual([]);
        expect(view.container.querySelector("ul")!.textContent).toBe(
          field === "label" ? "Row 1!Row 2!Row 3!" : "Row 1Row 2Row 3",
        );
        for (const row of view.container.querySelectorAll("li")) {
          expect(row.getAttribute("title")).toBe(field === "title" ? null : "old");
          expect(row.style.opacity).toBe(field === "opacity" ? "0" : "1");
        }
      },
    );

    it.each([2, 3])(
      "commits %i bindings after all reads and preserves nodes, focus, and no-ops",
      async (bindingCount) => {
        const view = await mount(reactivity, hydrate);
        const rows = [...view.container.querySelectorAll("li")];
        const text = rows[0].querySelector("span")!.firstChild;
        const input = rows[0].querySelector("input")!;
        input.value = "user draft";
        input.focus();
        input.setSelectionRange(1, 4);
        const next = view.initial.map((row) => ({
          ...row,
          label: `${row.label}!`,
          title: null,
          opacity: bindingCount === 3 ? 0 : 1,
        }));
        await view.update(next);
        expect(view.reads.map(({ row, field }) => `${row}:${field}`)).toEqual(
          [1, 2, 3].flatMap((id) => ["label", "title", "opacity"].map((field) => `${id}:${field}`)),
        );
        expect(view.reads.every(({ text }) => text === "Row 1Row 2Row 3")).toBe(true);
        expect([...view.container.querySelectorAll("li")]).toEqual(rows);
        expect(rows[0].querySelector("span")!.firstChild).toBe(text);
        for (const row of rows) {
          expect(row.hasAttribute("title")).toBe(false);
          expect(row.style.opacity).toBe(bindingCount === 3 ? "0" : "1");
        }
        expect(document.activeElement).toBe(input);
        expect(input.value).toBe("user draft");
        expect([input.selectionStart, input.selectionEnd]).toEqual([1, 4]);
        const mutations: MutationRecord[] = [];
        const observer = new MutationObserver((records) => mutations.push(...records));
        observer.observe(view.container, {
          subtree: true,
          attributes: true,
          childList: true,
          characterData: true,
        });
        await view.update(next.map((row) => ({ ...row })));
        mutations.push(...observer.takeRecords());
        observer.disconnect();
        expect(mutations).toEqual([]);
      },
    );

    it("discards earlier prepared bindings when a later binding throws", async () => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      const view = await mount(reactivity, hydrate);
      const rows = [...view.container.querySelectorAll("li")];
      const before = rows.map((row) => row.outerHTML);
      const mutations: MutationRecord[] = [];
      const observer = new MutationObserver((records) => mutations.push(...records));
      for (const row of rows)
        observer.observe(row, {
          subtree: true,
          attributes: true,
          childList: true,
          characterData: true,
        });
      view.fail();
      await view.update(
        view.initial.map((row) => ({ ...row, label: "changed", title: null, opacity: 0 })),
      );
      mutations.push(...observer.takeRecords());
      observer.disconnect();
      expect(view.container.textContent).toBe("Recovered");
      expect(rows.map((row) => row.outerHTML)).toEqual(before);
      expect(mutations).toEqual([]);
    });
  });
});
