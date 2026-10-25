import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createCompiledComponent,
  type CompiledComponentDefinition,
  type CompilerKeyedRowBinding,
  type CompilerKeyedRowElement,
} from "../compiler-runtime";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

interface Row {
  id: number;
  label: string;
  classValue?: unknown;
}

type Shape = "table" | "hidden-first" | "style" | "duplicate-class";

function rowClass(row: Row, selected: number): unknown {
  return Object.hasOwn(row, "classValue") ? row.classValue : selected === row.id ? "danger" : "";
}

const roots: Root[] = [];

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.replaceChildren();
});

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function rows(from: number, count: number, suffix = ""): Row[] {
  return Array.from({ length: count }, (_, index) => ({
    id: from + index,
    label: `row ${from + index}${suffix}`,
  }));
}

// Every value that differs between rows is a binding, as the compiler emits.
function rowDescriptor(
  shape: Shape,
  row: Row,
  index: number,
  selected: number,
): CompilerKeyedRowElement {
  const cell = (
    tag: string,
    children: unknown[],
    attributes: { name: string; value: unknown }[] = [],
  ) => ({
    kind: "element" as const,
    tag,
    attributes,
    styles: [],
    children,
  });
  const button = cell(
    "button",
    ["x"],
    [
      { name: "type", value: "button" },
      { name: "disabled", value: true },
    ],
  );
  return {
    kind: "element",
    tag: "tr",
    attributes: [
      ...(shape === "duplicate-class" ? [{ name: "class", value: row.label }] : []),
      { name: "className", value: rowClass(row, selected) },
      { name: "data-id", value: row.id },
      { name: "aria-selected", value: selected === row.id },
      ...(shape === "hidden-first" ? [{ name: "hidden", value: row.id % 2 === 0 }] : []),
      { name: "data-static", value: "kept" },
    ],
    styles: shape === "style" ? [{ name: "opacity", value: row.id % 2 ? 0.5 : 1 }] : [],
    children: [
      cell("td", [row.id], [{ name: "className", value: "col-md-1" }]),
      cell("td", [cell("a", ["#", row.id, " ", row.label], [{ name: "title", value: row.label }])]),
      cell("td", [index % 2 ? "" : index]),
      cell("td", [button]),
      cell("td", [], [{ name: "className", value: "col-md-6" }]),
    ],
  };
}

function rowBindings(shape: Shape, selected: () => number): CompilerKeyedRowBinding[] {
  const bindings: CompilerKeyedRowBinding[] = [
    {
      kind: "attribute",
      path: [],
      name: "className",
      read: (item) => rowClass(item as Row, selected()),
    },
    { kind: "attribute", path: [], name: "data-id", read: (item) => (item as Row).id },
    {
      kind: "attribute",
      path: [],
      name: "aria-selected",
      read: (item) => selected() === (item as Row).id,
    },
    { kind: "text", path: [0], read: (item) => [(item as Row).id] },
    {
      kind: "attribute",
      path: [1, 0],
      name: "title",
      read: (item) => (item as Row).label,
    },
    {
      kind: "text",
      path: [1, 0],
      read: (item) => ["#", (item as Row).id, " ", (item as Row).label],
    },
    { kind: "text", path: [2], read: (_item, index) => [index % 2 ? "" : index] },
  ];
  if (shape === "hidden-first") {
    bindings.push({
      kind: "attribute",
      path: [],
      name: "hidden",
      read: (item) => (item as Row).id % 2 === 0,
    });
  }
  if (shape === "style") {
    bindings.push({
      kind: "style",
      path: [],
      name: "opacity",
      read: (item) => ((item as Row).id % 2 ? 0.5 : 1),
    });
  }
  if (shape === "duplicate-class") {
    bindings.unshift({
      kind: "attribute",
      path: [],
      name: "class",
      read: (item) => (item as Row).label,
    });
  }
  return bindings;
}

function mountRows(shape: Shape, cloneRows: boolean) {
  const counters = { creates: 0 };
  const clicks: string[] = [];
  let setRows: (next: (current: Row[]) => Row[]) => void = () => undefined;
  let setSelected: (id: number) => void = () => undefined;
  const definition: CompiledComponentDefinition<object> = {
    displayName: `TemplateRows${cloneRows ? "Cloned" : "Built"}`,
    reactivity: "hybrid",
    initialize: () => [[] as Row[], 0],
    render(_props, state, blocks) {
      const items = () => state[0].get() as Row[];
      const selected = () => state[1].get() as number;
      setRows = (next) => state[0].set((current) => next(current as Row[]));
      setSelected = (id) => state[1].set(id);
      return (
        <table>
          <blocks.KeyedRows
            id={0}
            items={items}
            dependencies={[0, 1]}
            structureDependencies={[0]}
            collectionDependency={0}
            rowKey={(item) => (item as Row).id}
            create={(item, index) => {
              counters.creates += 1;
              return rowDescriptor(shape, item as Row, index, selected());
            }}
            bindings={rowBindings(shape, selected)}
            events={[
              {
                name: "onClick",
                path: [1, 0],
                invoke: (item, index) => clicks.push(`${(item as Row).label}@${index}`),
              },
            ]}
            delegateEvents
            cloneRows={cloneRows}
            render={(event) => (
              <tbody>
                {items().map((row, index) => (
                  <tr key={row.id}>
                    <td>{row.id}</td>
                    <td>
                      <a onClick={event(row, index, 0)}>{row.label}</a>
                    </td>
                  </tr>
                ))}
              </tbody>
            )}
          />
        </table>
      );
    },
    bindings: [{ kind: "block", id: 0, dependencies: [0, 1] }],
  };
  const Component = createCompiledComponent(definition);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  return {
    container,
    counters,
    clicks,
    async render() {
      await act(async () => root.render(<Component />));
    },
    async rows(next: (current: Row[]) => Row[]) {
      await act(async () => {
        setRows(next);
        await flush();
      });
    },
    async select(id: number) {
      await act(async () => {
        setSelected(id);
        await flush();
      });
    },
    html: () => container.querySelector("tbody")!.innerHTML,
  };
}

async function runScenario(shape: Shape, cloneRows: boolean) {
  const view = mountRows(shape, cloneRows);
  const snapshots: string[] = [];
  await view.render();
  await view.rows(() => rows(1, 40));
  snapshots.push(view.html());
  await view.rows(() => rows(100, 40));
  snapshots.push(view.html());
  await view.rows((current) => current.concat(rows(500, 25)));
  snapshots.push(view.html());
  await view.select(110);
  snapshots.push(view.html());
  await view.rows((current) =>
    current.map((row, index) => (index % 10 === 0 ? { ...row, label: `${row.label} !!!` } : row)),
  );
  snapshots.push(view.html());
  await view.rows((current) => {
    const next = current.slice();
    [next[1], next[30]] = [next[30], next[1]];
    return next;
  });
  snapshots.push(view.html());
  await view.rows((current) => current.filter((row) => row.id !== 105));
  snapshots.push(view.html());
  await act(async () => {
    view.container.querySelector<HTMLElement>("tbody tr:nth-child(4) a")!.click();
  });
  await view.rows(() => []);
  snapshots.push(view.html());
  return { snapshots, creates: view.counters.creates, clicks: view.clicks };
}

describe("cloned keyed rows", () => {
  it("compares against the template DOM rather than a later binding read", async () => {
    const view = mountRows("table", true);
    await view.render();
    let reads = 0;
    await view.rows(() => [
      {
        id: 1,
        label: "first",
        get classValue() {
          return reads++ === 0 ? "template" : "binding";
        },
      },
    ]);
    expect(view.container.querySelector("tr")!.getAttribute("class")).toBe("template");
    await view.rows(() => [{ id: 2, label: "second", classValue: "binding" }]);
    expect(view.container.querySelector("tr")!.getAttribute("class")).toBe("binding");
  });

  it("preserves class coercions and absent, boolean and changing classes", async () => {
    const view = mountRows("table", true);
    await view.render();
    await view.rows(() => [{ id: 1, label: "first", classValue: "copied" }]);
    const coercions: string[] = [];
    const objectClass = {
      toString() {
        coercions.push("class");
        return "copied";
      },
    };
    const values = [objectClass, "changed", "copied", null, undefined, false, true, 0];
    await view.rows(() =>
      values.map((classValue, index) => ({ id: index + 2, label: "row", classValue })),
    );
    expect(coercions).toEqual(["class"]);
    expect(
      [...view.container.querySelectorAll("tr")].map((row) => row.getAttribute("class")),
    ).toEqual(["copied", "changed", "copied", null, null, null, "", "0"]);
  });

  it("does not skip a later class binding after an earlier binding changes it", async () => {
    const view = mountRows("duplicate-class", true);
    await view.render();
    await view.rows(() => rows(1, 2));
    await view.rows(() => rows(100, 3));
    expect(
      [...view.container.querySelectorAll("tr")].map((row) => row.getAttribute("class")),
    ).toEqual(["", "", ""]);
  });

  it("does not rewrite an unchanged string class copied from the template", async () => {
    const view = mountRows("table", true);
    await view.render();
    await view.rows(() => rows(1, 2));
    const write = vi.spyOn(Element.prototype, "setAttribute");
    const read = vi.spyOn(Element.prototype, "getAttribute");

    try {
      await view.rows(() => rows(100, 20));
      expect(write.mock.calls.filter(([name]) => name === "class")).toEqual([]);
      expect(read.mock.calls.filter(([name]) => name === "class")).toEqual([]);
      expect(view.container.querySelectorAll('tr[class=""]')).toHaveLength(20);
    } finally {
      write.mockRestore();
      read.mockRestore();
    }
  });

  it("produces the same DOM as building every row from its descriptor", async () => {
    const built = await runScenario("table", false);
    const cloned = await runScenario("table", true);

    expect(cloned.snapshots).toEqual(built.snapshots);
    expect(cloned.clicks).toEqual(built.clicks);
    expect(cloned.clicks).toEqual(["row 103@3"]);
    expect(built.snapshots[0]).toContain('data-static="kept"');
    expect(built.snapshots[3]).toContain('class="danger" data-id="110"');
  });

  it("builds one descriptor per committed props object instead of one per row", async () => {
    const built = await runScenario("table", false);
    const cloned = await runScenario("table", true);

    expect(built.creates).toBeGreaterThanOrEqual(105);
    expect(cloned.creates).toBe(1);
  });

  it("patches cloned rows through their saved targets and keeps lone text nodes", async () => {
    const view = mountRows("table", true);
    await view.render();
    await view.rows(() => rows(1, 20));
    const label = view.container.querySelector("tbody tr:nth-child(11) a")!;
    const text = label.firstChild;
    const walk = vi.spyOn(Element.prototype, "firstElementChild", "get");

    await view.rows((current) =>
      current.map((row, index) => (index % 10 === 0 ? { ...row, label: `${row.label} !!!` } : row)),
    );

    expect(walk).not.toHaveBeenCalled();
    expect(label.textContent).toBe("#11 row 11 !!!");
    // React's setTextContent also writes a lone text node's data in place.
    expect(label.firstChild).toBe(text);
  });

  it("waits for a row that has every bound attribute before cloning", async () => {
    // Row 1 omits hidden, so its clones would add hidden after data-static.
    const built = await runScenario("hidden-first", false);
    const cloned = await runScenario("hidden-first", true);

    expect(cloned.snapshots).toEqual(built.snapshots);
    expect(built.snapshots[0]).toContain('aria-selected="false" hidden="" data-static="kept"');
    expect(cloned.creates).toBe(2);
  });

  it("keeps building rows with style bindings from descriptors", async () => {
    const built = await runScenario("style", false);
    const cloned = await runScenario("style", true);

    expect(cloned.snapshots).toEqual(built.snapshots);
    expect(cloned.creates).toBe(built.creates);
  });
});

describe("unhinted appends", () => {
  it("patches existing rows and appends only the new rows", async () => {
    const view = mountRows("table", true);
    await view.render();
    await view.rows(() => rows(1, 5));
    const before = [...view.container.querySelectorAll("tbody tr")];

    await view.rows((current) =>
      [...current.slice(0, 2), { ...current[2], label: "changed" }, ...current.slice(3)].concat(
        rows(10, 3),
      ),
    );

    const after = [...view.container.querySelectorAll("tbody tr")];
    expect(after.slice(0, 5)).toEqual(before);
    expect(after.map((row) => row.getAttribute("data-id"))).toEqual([
      "1",
      "2",
      "3",
      "4",
      "5",
      "10",
      "11",
      "12",
    ]);
    expect(after[2].querySelector("a")!.textContent).toBe("#3 changed");
    await act(async () => after[6].querySelector<HTMLElement>("a")!.click());
    expect(view.clicks).toEqual(["row 11@6"]);
  });

  it.each([
    ["repeats a new key", (current: Row[]) => current.concat(rows(10, 2), rows(10, 1))],
    ["reuses a committed key", (current: Row[]) => current.concat(rows(3, 1))],
  ])("falls back when the tail %s", async (_name, update) => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const view = mountRows("table", true);
    await view.render();
    await view.rows(() => rows(1, 5));
    let expected: Row[] = [];

    await view.rows((current) => (expected = update(current)));

    expect(
      [...view.container.querySelectorAll("tbody tr")].map((row) => row.firstChild!.textContent),
    ).toEqual(expected.map((row) => String(row.id)));
  });
});
