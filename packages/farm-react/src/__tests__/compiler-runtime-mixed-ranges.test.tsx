import React, { Profiler, StrictMode, useState } from "react";
import { act } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createCompiledComponent,
  type CompiledComponentDefinition,
  type CompilerHostConditionalBranch,
  type CompilerHostElement,
  type CompilerKeyedRowBinding,
  type CompilerStateUpdater,
} from "../compiler-runtime";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

interface Tag {
  id: string;
  label: string;
}

interface Item {
  id: string;
  label: string;
  visible: boolean;
  tags: Tag[];
  fail?: boolean;
}

interface Model {
  loading: boolean;
  error: boolean;
  items: Item[];
}

const initialModel: Model = {
  loading: false,
  error: false,
  items: [
    {
      id: "a",
      label: "Alpha",
      visible: true,
      tags: [
        { id: "a1", label: "A one" },
        { id: "a2", label: "A two" },
      ],
    },
    {
      id: "b",
      label: "Beta",
      visible: false,
      tags: [{ id: "b1", label: "B one" }],
    },
  ],
};

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

function host(
  tag: string,
  children: readonly unknown[] = [],
  attributes: readonly { name: string; value: unknown }[] = [],
): CompilerHostElement {
  return { kind: "element", tag, attributes, styles: [], children };
}

function branch(create: () => CompilerHostElement): CompilerHostConditionalBranch {
  return { create, bindings: [] };
}

function tagDescriptor(tag: Tag, index: number): CompilerHostElement {
  return host(
    "em",
    [tag.label],
    [
      { name: "data-tag", value: tag.id },
      { name: "data-tag-index", value: index },
    ],
  );
}

const tagBindings: CompilerKeyedRowBinding[] = [
  { kind: "attribute", path: [], name: "data-tag-index", read: (_tag, index) => index },
  { kind: "text", path: [], read: (tag) => (tag as Tag).label },
];

function itemDescriptor(item: Item, index: number): CompilerHostElement {
  const detail = {
    ...host("div", [
      ...(item.visible
        ? [host("strong", [item.label], [{ name: "data-visible", value: item.id }])]
        : []),
      host("i", ["Tags"]),
      ...item.tags.map(tagDescriptor),
    ]),
    block: {
      kind: "mixed-ranges" as const,
      id: 1,
      ranges: [
        {
          kind: "conditional" as const,
          before: 0,
          test: () => item.visible,
          logical: true,
          truthy: branch(() =>
            host("strong", [item.label], [{ name: "data-visible", value: item.id }]),
          ),
        },
        {
          kind: "keyed" as const,
          before: 1,
          items: () => item.tags,
          rowKey: (tag: unknown) => (tag as Tag).id,
          create: (tag: unknown, tagIndex: number) => tagDescriptor(tag as Tag, tagIndex),
          bindings: tagBindings,
        },
      ],
      trailing: 0,
    },
  };
  return host(
    "article",
    [host("span", [item.label]), detail],
    [
      { name: "data-item", value: item.id },
      { name: "data-item-index", value: index },
    ],
  );
}

const itemBindings: CompilerKeyedRowBinding[] = [
  { kind: "attribute", path: [], name: "data-item-index", read: (_item, index) => index },
  {
    kind: "text",
    path: [0],
    read: (item) => {
      if ((item as Item).fail) throw new Error("mixed range binding failed");
      return (item as Item).label;
    },
  },
];

function mixedDescriptor(readModel: () => Model, prefix = ""): CompilerHostElement {
  const model = readModel();
  return {
    ...host(
      "section",
      [
        host("header", ["Inventory"]),
        ...(model.loading
          ? [host("p", ["Loading…"], [{ name: "data-loading", value: true }])]
          : []),
        host("i", ["Rows"]),
        ...model.items.map(itemDescriptor),
        model.error
          ? host("strong", ["Error"], [{ name: "data-status", value: "error" }])
          : host("span", ["Ready"], [{ name: "data-status", value: "ready" }]),
        host("footer", ["End"]),
      ],
      [
        { name: "data-mixed", value: true },
        { name: "data-prefix", value: prefix || undefined },
      ],
    ),
    block: {
      kind: "mixed-ranges",
      id: 0,
      ranges: [
        {
          kind: "conditional",
          before: 1,
          test: () => readModel().loading,
          logical: true,
          truthy: branch(() => host("p", ["Loading…"], [{ name: "data-loading", value: true }])),
        },
        {
          kind: "keyed",
          before: 1,
          items: () => readModel().items,
          rowKey: (item: unknown) => (item as Item).id,
          create: (item: unknown, index: number) => itemDescriptor(item as Item, index),
          bindings: itemBindings,
        },
        {
          kind: "conditional",
          before: 0,
          test: () => readModel().error,
          truthy: branch(() =>
            host("strong", ["Error"], [{ name: "data-status", value: "error" }]),
          ),
          falsy: branch(() => host("span", ["Ready"], [{ name: "data-status", value: "ready" }])),
        },
      ],
      trailing: 1,
    },
  };
}

function mixedMarkup(model: Model, prefix = "") {
  return (
    <section data-mixed data-prefix={prefix || undefined}>
      <header>Inventory</header>
      {model.loading && <p data-loading>Loading…</p>}
      <i>Rows</i>
      {model.items.map((item, index) => (
        <article key={item.id} data-item={item.id} data-item-index={index}>
          <span>{item.label}</span>
          <div>
            {item.visible && <strong data-visible={item.id}>{item.label}</strong>}
            <i>Tags</i>
            {item.tags.map((tag, tagIndex) => (
              <em key={tag.id} data-tag={tag.id} data-tag-index={tagIndex}>
                {tag.label}
              </em>
            ))}
          </div>
        </article>
      ))}
      {model.error ? (
        <strong data-status="error">Error</strong>
      ) : (
        <span data-status="ready">Ready</span>
      )}
      <footer>End</footer>
    </section>
  );
}

function cloneInitialModel(): Model {
  return structuredClone(initialModel);
}

function createMixedFixture(initial = cloneInitialModel()) {
  let setModel: (next: CompilerStateUpdater) => void = () => undefined;
  let executions = 0;
  const definition: CompiledComponentDefinition<{ prefix?: string }> = {
    displayName: "MixedFixture",
    initialize: () => [initial],
    render: (props, state, blocks) => {
      executions += 1;
      setModel = (next) => state[0].set(next);
      const readModel = () => state[0].get() as Model;
      return (
        <blocks.MixedRanges
          id={0}
          render={() => mixedMarkup(readModel(), props.prefix)}
          create={() => mixedDescriptor(readModel, props.prefix)}
        />
      );
    },
    bindings: [
      { kind: "block", id: 0, dependencies: [0] },
      { kind: "block", id: 1, parent: 0, dependencies: [0] },
    ],
  };
  return {
    View: createCompiledComponent(definition),
    setModel: (next: CompilerStateUpdater) => setModel(next),
    executions: () => executions,
  };
}

class Boundary extends React.Component<React.PropsWithChildren, { message: string }> {
  state = { message: "" };

  static getDerivedStateFromError(error: Error) {
    return { message: error.message };
  }

  render() {
    return this.state.message ? <p data-error>{this.state.message}</p> : this.props.children;
  }
}

describe("compiler-owned mixed conditional and keyed ranges runtime", () => {
  it("commits simultaneous branches and LIS list moves without a React render", async () => {
    const fixture = createMixedFixture();
    let commits = 0;
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () =>
      root.render(
        <StrictMode>
          <Profiler id="mixed" onRender={() => (commits += 1)}>
            <fixture.View />
          </Profiler>
        </StrictMode>,
      ),
    );

    const executionsAfterMount = fixture.executions();
    const commitsAfterMount = commits;
    const alpha = container.querySelector('[data-item="a"]');
    const alphaTag = container.querySelector('[data-tag="a1"]');
    const header = container.querySelector("header");
    const divider = container.querySelector("section > i");
    const footer = container.querySelector("footer");

    await act(async () => {
      fixture.setModel((value) => {
        const model = value as Model;
        const [a, b] = model.items;
        return {
          loading: true,
          error: true,
          items: [
            { ...b, visible: true },
            {
              ...a,
              label: "Alpha updated",
              visible: false,
              tags: [
                { ...a.tags[1], label: "A two updated" },
                a.tags[0],
                { id: "a3", label: "A three" },
              ],
            },
          ],
        };
      });
      await flushCompilerUpdates();
    });

    expect(container.querySelector("[data-loading]")?.textContent).toBe("Loading…");
    expect(container.querySelector('[data-status="error"]')?.textContent).toBe("Error");
    expect(
      [...container.querySelectorAll<HTMLElement>("[data-item]")].map((item) => item.dataset.item),
    ).toEqual(["b", "a"]);
    expect(container.querySelector('[data-item="a"]')).toBe(alpha);
    expect(container.querySelector('[data-tag="a1"]')).toBe(alphaTag);
    expect(container.querySelector('[data-item="a"] span')?.textContent).toBe("Alpha updated");
    expect(container.querySelector('[data-item="a"] [data-visible]')).toBeNull();
    expect(
      [...container.querySelectorAll<HTMLElement>('[data-item="a"] [data-tag]')].map(
        (tag) => tag.dataset.tag,
      ),
    ).toEqual(["a2", "a1", "a3"]);
    expect(container.querySelector("header")).toBe(header);
    expect(container.querySelector("section > i")).toBe(divider);
    expect(container.querySelector("footer")).toBe(footer);
    expect(fixture.executions()).toBe(executionsAfterMount);
    expect(commits).toBe(commitsAfterMount);
  });

  it("drops a queued mixed refresh when the component unmounts", async () => {
    const fixture = createMixedFixture();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<fixture.View />));

    fixture.setModel((value) => ({ ...(value as Model), loading: true, items: [] }));
    await act(async () => root.unmount());
    roots.splice(roots.indexOf(root), 1);
    await flushCompilerUpdates();
    expect(container.innerHTML).toBe("");
  });

  it("converges a parent prop commit with local conditional and keyed updates", async () => {
    const fixture = createMixedFixture();
    function Parent() {
      const [prefix, setPrefix] = useState("before");
      return (
        <>
          <button data-parent onClick={() => setPrefix("after")} type="button" />
          <fixture.View prefix={prefix} />
        </>
      );
    }
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<Parent />));

    await act(async () => {
      container.querySelector<HTMLButtonElement>("[data-parent]")?.click();
      fixture.setModel((value) => ({
        ...(value as Model),
        loading: true,
        items: [...(value as Model).items].reverse(),
      }));
      await flushCompilerUpdates();
    });
    await flushCompilerUpdates();

    expect(container.querySelector("[data-mixed]")?.getAttribute("data-prefix")).toBe("after");
    expect(container.querySelector("[data-loading]")).not.toBeNull();
    expect(
      [...container.querySelectorAll<HTMLElement>("[data-item]")].map((item) => item.dataset.item),
    ).toEqual(["b", "a"]);
  });

  it("adopts server markup and preserves recovery for hydration mismatches", async () => {
    for (const mismatch of [false, true]) {
      const fixture = createMixedFixture();
      const container = document.createElement("div");
      const html = renderToString(<fixture.View />);
      container.innerHTML = mismatch ? html.replace("Alpha</span>", "Server</span>") : html;
      document.body.append(container);
      const recoverable = vi.fn();
      let root!: ReturnType<typeof hydrateRoot>;
      await act(async () => {
        root = hydrateRoot(container, <fixture.View />, { onRecoverableError: recoverable });
        await flushCompilerUpdates();
      });
      roots.push(root);
      const alpha = container.querySelector('[data-item="a"]');
      if (mismatch) expect(recoverable).toHaveBeenCalled();
      else expect(recoverable).not.toHaveBeenCalled();

      await act(async () => {
        fixture.setModel((value) => ({
          ...(value as Model),
          loading: true,
          items: [...(value as Model).items].reverse(),
        }));
        await flushCompilerUpdates();
      });
      expect(container.querySelector('[data-item="a"]')).toBe(alpha);
      expect(container.querySelector("[data-loading]")).not.toBeNull();

      await act(async () => root.unmount());
      roots.splice(roots.indexOf(root), 1);
      container.remove();
    }
  });

  it("falls back on duplicate keys and keeps every mixed dependency live", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fixture = createMixedFixture();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<fixture.View />));

    await act(async () => {
      fixture.setModel((value) => {
        const model = value as Model;
        return { ...model, items: [model.items[0], { ...model.items[0], label: "Duplicate" }] };
      });
      await flushCompilerUpdates();
    });
    expect(container.querySelectorAll('[data-item="a"]')).toHaveLength(2);
    expect(container.textContent).toContain("Duplicate");

    await act(async () => {
      fixture.setModel(() => ({
        loading: true,
        error: true,
        items: [{ id: "safe", label: "Safe", visible: true, tags: [] }],
      }));
      await flushCompilerUpdates();
    });
    expect(container.querySelector('[data-item="safe"] span')?.textContent).toBe("Safe");
    expect(container.querySelector("[data-loading]")).not.toBeNull();
    expect(container.querySelector('[data-status="error"]')).not.toBeNull();
  });

  it("routes mixed keyed binding failures through React error boundaries", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fixture = createMixedFixture();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () =>
      root.render(
        <Boundary>
          <fixture.View />
        </Boundary>,
      ),
    );

    await act(async () => {
      fixture.setModel((value) => ({
        ...(value as Model),
        items: (value as Model).items.map((item) =>
          item.id === "a" ? { ...item, fail: true } : item,
        ),
      }));
      await flushCompilerUpdates();
    });
    expect(container.querySelector("[data-error]")?.textContent).toBe("mixed range binding failed");
  });

  it("matches normal React through 3,000 deterministic mixed updates", async () => {
    const fixture = createMixedFixture();
    let updateNormal: React.Dispatch<React.SetStateAction<Model>> = () => undefined;
    function Normal() {
      const [model, setModel] = useState(cloneInitialModel);
      updateNormal = setModel;
      return mixedMarkup(model);
    }

    const compiledContainer = document.createElement("div");
    const normalContainer = document.createElement("div");
    document.body.append(compiledContainer, normalContainer);
    const compiledRoot = createRoot(compiledContainer);
    const normalRoot = createRoot(normalContainer);
    roots.push(compiledRoot, normalRoot);
    await act(async () => {
      compiledRoot.render(<fixture.View />);
      normalRoot.render(<Normal />);
    });

    const transition = (model: Model, step: number): Model => {
      const action = step % 8;
      if (action === 0) return { ...model, loading: !model.loading };
      if (action === 1) return { ...model, error: !model.error };
      if (action === 2) return { ...model, items: [...model.items].reverse() };
      if (action === 3 && model.items.length > 1) {
        return { ...model, items: [...model.items.slice(1), model.items[0]] };
      }
      if (action === 4 && model.items.length < 7) {
        return {
          ...model,
          items: [
            ...model.items,
            {
              id: `item-${step}`,
              label: `Item ${step}`,
              visible: step % 2 === 0,
              tags: [{ id: `tag-${step}`, label: `Tag ${step}` }],
            },
          ],
        };
      }
      if (action === 5 && model.items.length > 1) {
        return { ...model, items: model.items.slice(1) };
      }
      if (model.items.length === 0) return model;
      const index = step % model.items.length;
      return {
        ...model,
        items: model.items.map((item, itemIndex) => {
          if (itemIndex !== index) return item;
          if (action === 6) {
            return { ...item, label: `${item.label}!`, visible: !item.visible };
          }
          const tags =
            item.tags.length > 1
              ? [...item.tags.slice(1), item.tags[0]]
              : [...item.tags, { id: `${item.id}-tag-${step}`, label: `Nested ${step}` }];
          return { ...item, tags };
        }),
      };
    };

    for (let step = 0; step < 3_000; step += 1) {
      await act(async () => {
        fixture.setModel((value) => transition(value as Model, step));
        updateNormal((value) => transition(value, step));
        await flushCompilerUpdates();
      });
      if (step % 100 === 0) {
        expect(compiledContainer.innerHTML).toBe(normalContainer.innerHTML);
      }
    }
    expect(compiledContainer.innerHTML).toBe(normalContainer.innerHTML);
  }, 60_000);
});
