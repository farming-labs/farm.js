import React, { act, useId, useState, type ReactNode } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToReadableStream, renderToStaticMarkup } from "react-dom/server";
import { parseAst } from "vite";
import { afterEach, describe, expect, it } from "vitest";
import {
  createFarmIsolatedClientBoundary,
  createFarmIsolatedHydrationRuntime,
  createFarmServerPageBoundary,
  isolateFarmServerPageGraph,
} from "../client/isolated-boundary";
import { Link } from "../client/link";
import { createFarmServerTreeElement, renderFarmServerTreePage } from "../client/server-tree";
import { transformIsolatedClientBoundaryModule, type FarmModuleAstNode } from "../vite";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// A client component that holds an element in a data prop and renders it only when opened, the
// way fumadocs' page tree carries its icons through a provider.
function MenuSource({ items }: { items: Array<{ name: string; icon: ReactNode }> }) {
  const [open, setOpen] = useState(false);
  return (
    <nav>
      <button id="menu" onClick={() => setOpen(true)}>
        {open ? "open" : "closed"}
      </button>
      {open ? items.map((item) => <span key={item.name}>{item.icon}</span>) : null}
    </nav>
  );
}
function CounterSource({ label }: { label: string }) {
  const [count, setCount] = useState(0);
  return (
    <button id="counter" onClick={() => setCount((value) => value + 1)}>
      {label}:{count}
    </button>
  );
}
const modules: Record<string, Record<string, unknown>> = {
  "/src/menu.tsx": { __farm_client_boundary_originals__: { Menu: MenuSource } },
  "/src/counter.tsx": { __farm_client_boundary_originals__: { Counter: CounterSource } },
  // Built-in client components load from the package's own exports.
  "@farm.js/core/client": { Link },
};
const Menu = createFarmIsolatedClientBoundary(React, MenuSource, "/src/menu.tsx", "Menu", "load");
const Counter = createFarmIsolatedClientBoundary(
  React,
  CounterSource,
  "/src/counter.tsx",
  "Counter",
  "load",
);

// A server component that calls a hook, as lucide-react's icons do: the tree cannot represent it.
function HookIcon() {
  const id = useId();
  return <svg data-icon={id.length > 0 ? "ok" : "no"} />;
}

const load = async (reference: string) => {
  const module = modules[reference];
  if (!module) throw new Error(`missing test module ${reference}`);
  return module;
};

const mountedRoots: Array<ReturnType<typeof hydrateRoot>> = [];
afterEach(() => {
  for (const root of mountedRoots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

async function renderTree(element: ReactNode) {
  const tree = await renderFarmServerTreePage(React, element, {
    isolate: (node) => isolateFarmServerPageGraph(React, node),
    renderHtml: (node) => renderToStaticMarkup(node),
  });
  const stream = await renderToReadableStream(<div id="layout">{tree}</div>);
  await stream.allReady;
  return new Response(stream).text();
}

async function hydrateTree(html: string, key: string) {
  const container = document.createElement("div");
  container.innerHTML = html;
  document.body.append(container);
  const runtime = createFarmIsolatedHydrationRuntime({
    ReactRuntime: React,
    hydrateRoot,
    load,
    schedule: async ({ hydrate }) => hydrate(),
  });
  const ServerHtml = createFarmServerPageBoundary(React, runtime);
  const build = async (source: ParentNode | string) =>
    createFarmServerTreeElement(React, source, { load, ServerHtml, key });
  const tree = await build(container.querySelector("#layout")!);
  expect(tree).not.toBeNull();
  const errors: unknown[] = [];
  let root!: ReturnType<typeof hydrateRoot>;
  await act(async () => {
    root = hydrateRoot(container, <div id="layout">{tree}</div>, {
      onRecoverableError: (error) => errors.push(error),
    });
  });
  mountedRoots.push(root);
  return { container, errors, root, build };
}

describe("server layouts", () => {
  it("rebuilds a node a client component holds in its props without rendering it", async () => {
    const html = await renderTree(<Menu items={[{ name: "home", icon: <HookIcon /> }]} />);
    // Not in the rendered markup, so the payload carries its HTML.
    expect(html.replace(/<script[\s\S]*?<\/script>/g, "")).not.toContain("data-icon");
    expect(html).toMatch(/"\$":"x"[^}]*"h":"\\u003csvg data-icon=\\"ok\\"/);

    const { container, errors } = await hydrateTree(html, "/docs");
    expect(errors).toEqual([]);
    await act(async () => (container.querySelector("#menu") as HTMLButtonElement).click());
    expect(container.querySelector("#menu")!.textContent).toBe("open");
    expect(container.querySelector('[data-icon="ok"]')).not.toBeNull();
  });

  it("keeps client state when the layout's tree is rebuilt for another page", async () => {
    const layout = (page: string) => (
      <section>
        <Counter label="nav" />
        <article>{page}</article>
      </section>
    );
    const { container, root, build } = await hydrateTree(
      await renderTree(layout("first")),
      "/docs",
    );
    await act(async () => (container.querySelector("#counter") as HTMLButtonElement).click());
    expect(container.querySelector("#counter")!.textContent).toBe("nav:1");

    // A navigation rebuilds the tree from the next document, keyed by the layout's pattern.
    const next = await build(await renderTree(layout("second")));
    await act(async () => root.render(<div id="layout">{next}</div>));
    expect(container.querySelector("article")!.textContent).toBe("second");
    expect(container.querySelector("#counter")!.textContent).toBe("nav:1");
  });

  it("renders Farm's Link as a client component the browser hydrates", async () => {
    const html = await renderTree(
      <p>
        <Link href="/docs/guide">Guide</Link>
      </p>,
    );
    expect(html).toContain('"r":"@farm.js/core/client","e":"Link"');
    expect(html).not.toContain("farm-server-html");
    const { container, errors } = await hydrateTree(html, "/docs");
    expect(errors).toEqual([]);
    const anchor = container.querySelector('a[href="/docs/guide"]')!;
    expect(Object.keys(anchor).some((key) => key.startsWith("__reactProps"))).toBe(true);
  });
});

describe("isolated client boundary transform", () => {
  const transform = (code: string) =>
    transformIsolatedClientBoundaryModule({
      code,
      moduleReference: "/src/sidebar.tsx",
      islandStrategy: "load",
      parse: (source) => parseAst(source) as unknown as FarmModuleAstNode,
    })!;

  it("wraps components and leaves uppercase data exports as they are", async () => {
    const output = transform(`
export const SIDEBAR_WIDTH = 260;
export const LABELS = { open: "Open" };
export const Sidebar = () => null;
export const Panel = memo(() => null);
export function Header() { return null; }
`);
    expect(output).toContain("export { __farm_isolated_boundary_Sidebar__ as Sidebar }");
    expect(output).toContain("export { __farm_isolated_boundary_Panel__ as Panel }");
    expect(output).toContain("export { __farm_isolated_boundary_Header__ as Header }");
    expect(output).toContain("export const SIDEBAR_WIDTH = 260;");
    expect(output).toContain('export const LABELS = { open: "Open" };');
    expect(output).not.toContain("__farm_isolated_boundary_SIDEBAR_WIDTH__");
    expect(output).not.toContain("__farm_isolated_boundary_LABELS__");
  });
});
