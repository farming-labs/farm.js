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
  title: string;
  accent: boolean;
  staticFail?: boolean;
  loading: boolean;
  error: boolean;
  items: Item[];
}

const initialModel: Model = {
  title: "Inventory",
  accent: false,
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

function headerDescriptor(model: Model): CompilerHostElement {
  return {
    ...host(
      "header",
      [model.title],
      [
        { name: "className", value: model.accent ? "accent" : "plain" },
        { name: "data-title", value: model.title.toLowerCase() },
      ],
    ),
    styles: [{ name: "opacity", value: model.accent ? 1 : 0.6 }],
  };
}

function dividerDescriptor(model: Model): CompilerHostElement {
  return host(
    "i",
    [`Rows: ${model.items.length}`],
    [{ name: "data-count", value: model.items.length }],
  );
}

function footerDescriptor(model: Model): CompilerHostElement {
  return {
    ...host(
      "footer",
      [model.error ? "Blocked" : "Ready"],
      [{ name: "data-summary", value: `${model.title}:${model.items.length}` }],
    ),
    styles: [{ name: "width", value: model.accent ? 24 : 12 }],
  };
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
        headerDescriptor(model),
        ...(model.loading
          ? [host("p", ["Loading…"], [{ name: "data-loading", value: true }])]
          : []),
        dividerDescriptor(model),
        ...model.items.map(itemDescriptor),
        model.error
          ? host("strong", ["Error"], [{ name: "data-status", value: "error" }])
          : host("span", ["Ready"], [{ name: "data-status", value: "ready" }]),
        footerDescriptor(model),
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
      bindings: [
        {
          kind: "text",
          segment: 0,
          sibling: 0,
          path: [],
          read: () => {
            if (readModel().staticFail) throw new Error("static sibling binding failed");
            return readModel().title;
          },
        },
        {
          kind: "attribute",
          segment: 0,
          sibling: 0,
          path: [],
          name: "className",
          read: () => (readModel().accent ? "accent" : "plain"),
        },
        {
          kind: "attribute",
          segment: 0,
          sibling: 0,
          path: [],
          name: "data-title",
          read: () => readModel().title.toLowerCase(),
        },
        {
          kind: "style",
          segment: 0,
          sibling: 0,
          path: [],
          name: "opacity",
          read: () => (readModel().accent ? 1 : 0.6),
        },
        {
          kind: "text",
          segment: 1,
          sibling: 0,
          path: [],
          read: () => ["Rows: ", readModel().items.length],
        },
        {
          kind: "attribute",
          segment: 1,
          sibling: 0,
          path: [],
          name: "data-count",
          read: () => readModel().items.length,
        },
        {
          kind: "text",
          segment: 3,
          sibling: 0,
          path: [],
          read: () => (readModel().error ? "Blocked" : "Ready"),
        },
        {
          kind: "attribute",
          segment: 3,
          sibling: 0,
          path: [],
          name: "data-summary",
          read: () => `${readModel().title}:${readModel().items.length}`,
        },
        {
          kind: "style",
          segment: 3,
          sibling: 0,
          path: [],
          name: "width",
          read: () => (readModel().accent ? 24 : 12),
        },
      ],
    },
  };
}

function mixedMarkup(model: Model, prefix = "") {
  return (
    <section data-mixed data-prefix={prefix || undefined}>
      <header
        className={model.accent ? "accent" : "plain"}
        data-title={model.title.toLowerCase()}
        style={{ opacity: model.accent ? 1 : 0.6 }}
      >
        {model.title}
      </header>
      {model.loading && <p data-loading>Loading…</p>}
      <i data-count={model.items.length}>Rows: {model.items.length}</i>
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
      <footer
        data-summary={`${model.title}:${model.items.length}`}
        style={{ width: model.accent ? 24 : 12 }}
      >
        {model.error ? "Blocked" : "Ready"}
      </footer>
    </section>
  );
}

function cloneInitialModel(): Model {
  return structuredClone(initialModel);
}

function LocalFallbackCounter() {
  const [count, setCount] = useState(0);
  return (
    <button type="button" onClick={() => setCount((value) => value + 1)}>
      Local: {count}
    </button>
  );
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
          title: "Inventory updated",
          accent: true,
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
    expect(header?.textContent).toBe("Inventory updated");
    expect(header?.getAttribute("class")).toBe("accent");
    expect(header?.getAttribute("data-title")).toBe("inventory updated");
    expect((header as HTMLElement | null)?.style.opacity).toBe("1");
    expect(container.querySelector("section > i")).toBe(divider);
    expect(divider?.textContent).toBe("Rows: 2");
    expect(divider?.getAttribute("data-count")).toBe("2");
    expect(container.querySelector("footer")).toBe(footer);
    expect(footer?.textContent).toBe("Blocked");
    expect(footer?.getAttribute("data-summary")).toBe("Inventory updated:2");
    expect((footer as HTMLElement | null)?.style.width).toBe("24px");
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

  it("preserves mixed range identity and static markup through a compatible Fast Refresh", async () => {
    interface RefreshModel {
      loading: boolean;
      items: Array<{ id: string; label: string }>;
    }

    const hmrId = `mixed-ranges-refresh-${Math.random()}`;
    const definition = (
      prefix: string,
      blockId = 0,
    ): CompiledComponentDefinition<Record<string, never>> => ({
      displayName: "RefreshMixedRanges",
      hmrId,
      stateSignature: "1",
      initialize: () => [
        {
          loading: true,
          items: [
            { id: "a", label: "Alpha" },
            { id: "b", label: "Beta" },
          ],
        } satisfies RefreshModel,
      ],
      render(_props, state, blocks) {
        const model = () => state[0].get() as RefreshModel;
        const MixedRanges = blocks.MixedRanges;
        const conditionalBranch = branch(() =>
          host("p", [host("span", [prefix]), host("strong", ["Loading"])]),
        );
        const createRow = (item: RefreshModel["items"][number]) =>
          host(
            "article",
            [host("span", [prefix]), host("strong", [item.label])],
            [{ name: "data-key", value: item.id }],
          );
        const create = (): CompilerHostElement => {
          const value = model();
          return {
            ...host(
              "section",
              [
                host("header", [prefix], [{ name: "data-static", value: "header" }]),
                ...(value.loading ? [conditionalBranch.create()] : []),
                host("i", ["Items"], [{ name: "data-static", value: "divider" }]),
                ...value.items.map(createRow),
                host("footer", [`${prefix} footer`]),
              ],
              [{ name: "data-mixed-refresh", value: true }],
            ),
            block: {
              kind: "mixed-ranges",
              id: blockId,
              ranges: [
                {
                  kind: "conditional",
                  before: 1,
                  test: () => model().loading,
                  logical: true,
                  truthy: conditionalBranch,
                },
                {
                  kind: "keyed",
                  before: 1,
                  items: () => model().items,
                  rowKey: (item) => (item as RefreshModel["items"][number]).id,
                  create: (item) => createRow(item as RefreshModel["items"][number]),
                  bindings: [
                    {
                      kind: "text",
                      path: [1],
                      read: (item) => (item as RefreshModel["items"][number]).label,
                    },
                  ],
                },
              ],
              trailing: 1,
              bindings: [
                {
                  kind: "text",
                  segment: 0,
                  sibling: 0,
                  path: [],
                  read: () => prefix,
                },
                {
                  kind: "text",
                  segment: 2,
                  sibling: 0,
                  path: [],
                  read: () => `${prefix} footer`,
                },
              ],
            },
          };
        };
        return (
          <main>
            <button
              onClick={() =>
                state[0].set((current) => ({
                  ...(current as RefreshModel),
                  loading: false,
                  items: (current as RefreshModel).items.map((item) =>
                    item.id === "a" ? { ...item, label: "Alpha updated" } : item,
                  ),
                }))
              }
            >
              Update
            </button>
            <MixedRanges
              id={blockId}
              create={create}
              render={() => {
                const value = model();
                return (
                  <section data-mixed-refresh>
                    <header data-static="header">{prefix}</header>
                    {value.loading && (
                      <p>
                        <span>{prefix}</span>
                        <strong>Loading</strong>
                      </p>
                    )}
                    <i data-static="divider">Items</i>
                    {value.items.map((item) => (
                      <article data-key={item.id} key={item.id}>
                        <span>{prefix}</span>
                        <strong>{item.label}</strong>
                      </article>
                    ))}
                    <footer>{prefix} footer</footer>
                  </section>
                );
              }}
            />
          </main>
        );
      },
      bindings: [{ kind: "block", id: blockId, dependencies: [0] }],
    });

    const Initial = createCompiledComponent(definition("Before"));
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<Initial />));
    const surface = container.querySelector("[data-mixed-refresh]")!;
    const header = surface.querySelector("header")!;
    const loading = surface.querySelector("p")!;
    const alpha = surface.querySelector('[data-key="a"]')!;
    const beta = surface.querySelector('[data-key="b"]')!;
    const footer = surface.querySelector("footer")!;

    await act(async () => {
      const Updated = createCompiledComponent(definition("After", 1));
      expect(Updated).toBe(Initial);
      await flushCompilerUpdates();
    });
    await flushCompilerUpdates();

    expect(container.querySelector("[data-mixed-refresh]")).toBe(surface);
    expect(surface.querySelector("header")).toBe(header);
    expect(surface.querySelector("p")).toBe(loading);
    expect(surface.querySelector('[data-key="a"]')).toBe(alpha);
    expect(surface.querySelector('[data-key="b"]')).toBe(beta);
    expect(surface.querySelector("footer")).toBe(footer);
    expect(header.textContent).toBe("After");
    expect(loading.querySelector("span")?.textContent).toBe("After");
    expect(alpha.querySelector("span")?.textContent).toBe("After");
    expect(footer.textContent).toBe("After footer");

    await act(async () => {
      container.querySelector("button")!.click();
      await flushCompilerUpdates();
    });
    expect(container.querySelector("[data-mixed-refresh]")).toBe(surface);
    expect(surface.querySelector("p")).toBeNull();
    expect(surface.querySelector('[data-key="a"]')).toBe(alpha);
    expect(alpha.querySelector("strong")?.textContent).toBe("Alpha updated");
    expect(surface.querySelector('[data-key="b"]')).toBe(beta);
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

  it("falls back on duplicate keys and preserves recovered nested fallback state", async () => {
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
        title: "Recovered",
        accent: true,
        loading: true,
        error: true,
        items: [{ id: "safe", label: "Safe", visible: true, tags: [] }],
      }));
      await flushCompilerUpdates();
    });
    expect(container.querySelector('[data-item="safe"] span')?.textContent).toBe("Safe");
    expect(container.querySelector("[data-loading]")).not.toBeNull();
    expect(container.querySelector('[data-status="error"]')).not.toBeNull();

    const recoveredSurface = container.querySelector("[data-mixed]");
    await act(async () => {
      fixture.setModel((value) => ({ ...(value as Model), title: "Still safe" }));
      await flushCompilerUpdates();
    });
    expect(container.querySelector("[data-mixed]")).toBe(recoveredSurface);
    expect(container.querySelector("header")?.textContent).toBe("Still safe");
  });

  it.each(
    (["static", "hybrid"] as const).flatMap((reactivity) =>
      (["nested container", "component root"] as const).flatMap((ownership) =>
        (["mount", "hydrate"] as const).map((lifecycle) => ({
          lifecycle,
          ownership,
          reactivity,
          rootOwned: ownership === "component root",
        })),
      ),
    ),
  )(
    "preserves React-owned state across safe mixed fallback updates ($reactivity, $ownership, $lifecycle)",
    async ({ lifecycle, reactivity, rootOwned }) => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      interface FallbackModel {
        loading: boolean;
        items: Array<{ id: string; label: string }>;
      }
      const initial: FallbackModel = {
        loading: false,
        items: [
          { id: "a", label: "Alpha" },
          { id: "b", label: "Beta" },
        ],
      };
      let updateModel: (next: CompilerStateUpdater) => void = () => undefined;
      let owner: { blockRefreshListeners: Map<number, unknown> };
      const FallbackMixedRanges = createCompiledComponent<{ prefix: string }>({
        displayName: "FallbackMixedRangesState",
        reactivity,
        initialize: () => [initial],
        render(props, state, blocks) {
          const model = () => state[0].get() as FallbackModel;
          updateModel = (next) => state[0].set(next);
          const MixedRanges = blocks.MixedRanges;
          const create = (): CompilerHostElement => {
            const value = model();
            return {
              ...host(
                "section",
                [
                  // The intentionally incomplete descriptor makes React own the
                  // fallback subtree without changing its server/client markup.
                  host("aside"),
                  ...(value.loading ? [host("p", ["Loading…"])] : []),
                  host("i", [`Rows: ${value.items.length}`]),
                  ...value.items.map((item) =>
                    host("article", [item.label], [{ name: "data-key", value: item.id }]),
                  ),
                ],
                [{ name: "data-prefix", value: props.prefix }],
              ),
              block: {
                kind: "mixed-ranges",
                id: 0,
                ranges: [
                  {
                    kind: "conditional",
                    before: 1,
                    test: () => model().loading,
                    logical: true,
                    truthy: branch(() => host("p", ["Loading…"])),
                  },
                  {
                    kind: "keyed",
                    before: 1,
                    items: () => model().items,
                    rowKey: (item: unknown) => (item as FallbackModel["items"][number]).id,
                    create: (item: unknown) =>
                      host(
                        "article",
                        [(item as FallbackModel["items"][number]).label],
                        [
                          {
                            name: "data-key",
                            value: (item as FallbackModel["items"][number]).id,
                          },
                        ],
                      ),
                    bindings: [
                      {
                        kind: "text",
                        path: [],
                        read: (item: unknown) => (item as FallbackModel["items"][number]).label,
                      },
                    ],
                  },
                ],
                trailing: 0,
                bindings: [],
              },
            };
          };
          const ranges = (
            <MixedRanges
              id={0}
              create={create}
              render={() => {
                const value = model();
                return (
                  <section data-surface="fallback-mixed-ranges" data-prefix={props.prefix}>
                    <aside>
                      <LocalFallbackCounter />
                      <input aria-label="Text" defaultValue="draft" />
                      <textarea aria-label="Note" defaultValue="draft" />
                      <select aria-label="Choice" defaultValue="a">
                        <option value="a">A</option>
                        <option value="b">B</option>
                      </select>
                    </aside>
                    {value.loading && <p>Loading…</p>}
                    <i>Rows: {value.items.length}</i>
                    {value.items.map((item) => (
                      <article data-key={item.id} key={item.id}>
                        {item.label}
                      </article>
                    ))}
                  </section>
                );
              }}
            />
          );
          return rootOwned ? ranges : <main>{ranges}</main>;
        },
        bindings: [{ kind: "block", id: 0, dependencies: [0] }],
      });
      function Parent() {
        const [prefix, setPrefix] = useState("before");
        return (
          <>
            <button data-parent-prefix type="button" onClick={() => setPrefix("after")} />
            {React.createElement(FallbackMixedRanges, {
              prefix,
              ref: (instance: unknown) => {
                if (instance) owner = instance as typeof owner;
              },
            } as React.Attributes & { prefix: string })}
          </>
        );
      }
      const container = document.createElement("div");
      document.body.append(container);
      const tree = (
        <StrictMode>
          <Parent />
        </StrictMode>
      );
      if (lifecycle === "hydrate") container.innerHTML = renderToString(tree);
      const recoverable = vi.fn();
      const root =
        lifecycle === "hydrate"
          ? hydrateRoot(container, tree, { onRecoverableError: recoverable })
          : createRoot(container);
      roots.push(root);
      await act(async () => {
        if (lifecycle === "mount") root.render(tree);
        await flushCompilerUpdates();
      });
      expect(recoverable).not.toHaveBeenCalled();

      const surface = container.querySelector<HTMLElement>(
        "[data-surface='fallback-mixed-ranges']",
      )!;
      const input = container.querySelector<HTMLInputElement>("input")!;
      const textarea = container.querySelector<HTMLTextAreaElement>("textarea")!;
      const select = container.querySelector<HTMLSelectElement>("select")!;
      await act(async () => surface.querySelector("button")!.click());
      input.value = "typed text";
      textarea.value = "typed note";
      select.value = "b";
      input.focus();
      input.setSelectionRange(1, 4, "backward");
      const fallbackListener = owner!.blockRefreshListeners.get(0);

      await act(async () => {
        container.querySelector<HTMLButtonElement>("[data-parent-prefix]")?.click();
        updateModel({
          loading: true,
          items: [
            { id: "b", label: "Beta renamed" },
            { id: "a", label: "Alpha renamed" },
          ],
        });
        await flushCompilerUpdates();
      });

      expect(container.querySelector("[data-surface='fallback-mixed-ranges']")).toBe(surface);
      expect(container.querySelector("input")).toBe(input);
      expect(container.querySelector("textarea")).toBe(textarea);
      expect(container.querySelector("select")).toBe(select);
      expect(input.value).toBe("typed text");
      expect(textarea.value).toBe("typed note");
      expect(select.value).toBe("b");
      expect(surface.querySelector("button")?.textContent).toBe("Local: 1");
      expect(document.activeElement).toBe(input);
      expect([input.selectionStart, input.selectionEnd, input.selectionDirection]).toEqual([
        1,
        4,
        "backward",
      ]);
      expect(surface.querySelector("p")?.textContent).toBe("Loading…");
      expect(surface.dataset.prefix).toBe("after");
      expect(owner!.blockRefreshListeners.get(0)).toBe(fallbackListener);
      expect(
        [...surface.querySelectorAll<HTMLElement>("article")].map((row) => row.textContent),
      ).toEqual(["Beta renamed", "Alpha renamed"]);

      await act(async () => {
        updateModel({
          loading: false,
          items: [
            { id: "duplicate", label: "Again one" },
            { id: "duplicate", label: "Again two" },
          ],
        });
        await flushCompilerUpdates();
      });
      expect(container.querySelector("input")).not.toBe(input);
      expect(
        container.querySelector("[data-surface='fallback-mixed-ranges'] button")?.textContent,
      ).toBe("Local: 0");

      await act(async () => {
        updateModel(initial);
        await flushCompilerUpdates();
      });
      const recoveredInput = container.querySelector<HTMLInputElement>("input")!;
      recoveredInput.value = "recovered";
      await act(async () => {
        updateModel({
          loading: true,
          items: [
            { id: "a", label: "Alpha final" },
            { id: "b", label: "Beta final" },
          ],
        });
        await flushCompilerUpdates();
      });
      expect(container.querySelector("input")).toBe(recoveredInput);
      expect(recoveredInput.value).toBe("recovered");
    },
  );

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

  it("routes static-sibling binding failures through React error boundaries", async () => {
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
      fixture.setModel((value) => ({ ...(value as Model), staticFail: true }));
      await flushCompilerUpdates();
    });
    expect(container.querySelector("[data-error]")?.textContent).toBe(
      "static sibling binding failed",
    );
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
      const action = step % 10;
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
      if (action === 8) return { ...model, title: `Inventory ${step}` };
      if (action === 9) return { ...model, accent: !model.accent };
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
