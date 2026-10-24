import React, { act, createContext, use, useContext, useId, useState, type ReactNode } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToReadableStream } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createFarmIsolatedClientBoundary,
  createFarmIsolatedHydrationRuntime,
  createFarmServerPageBoundary,
  isolateFarmServerPageGraph,
  wrapFarmIsolatedClientGraph,
} from "../client/isolated-boundary";
import { createFarmServerTreeElement, renderFarmServerTreePage } from "../client/server-tree";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// --- client modules ("use client"), compiled the way the isolated-boundary transform does ------

const Panel = createContext<{ open: boolean; toggle(): void } | null>(null);
function PanelProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Panel.Provider value={{ open, toggle: () => setOpen((value) => !value) }}>
      {children}
    </Panel.Provider>
  );
}
function usePanel() {
  const panel = useContext(Panel);
  if (!panel) throw new Error("usePanel must be used within PanelProvider");
  return panel;
}
function HeaderButton() {
  const panel = usePanel();
  return (
    <button id="header" onClick={panel.toggle}>
      {panel.open ? "open" : "closed"}
    </button>
  );
}

function PageButtonSource({ label }: { label: string }) {
  const panel = usePanel();
  const id = useId();
  return (
    <button id="page" data-uid={id} onClick={panel.toggle}>
      {label}:{panel.open ? "open" : "closed"}
    </button>
  );
}
function CardSource({ title, children }: { title: string; children: ReactNode }) {
  const [count, setCount] = useState(0);
  return (
    <section>
      <h2>{title}</h2>
      <button id="card" onClick={() => setCount((value) => value + 1)}>
        {count}
      </button>
      {children}
    </section>
  );
}
function StarsSource({ stars }: { stars: Promise<number> }) {
  return <output id="stars">{use(stars)}</output>;
}
function CallbackSource({ onPick }: { onPick: () => void }) {
  return (
    <button id="callback" onClick={onPick}>
      pick
    </button>
  );
}
function CounterSource() {
  const [count, setCount] = useState(0);
  return (
    <button id="island" onClick={() => setCount((value) => value + 1)}>
      {count}
    </button>
  );
}

const modules: Record<string, Record<string, unknown>> = {
  "/src/page-button.tsx": { __farm_client_boundary_originals__: { PageButton: PageButtonSource } },
  "/src/card.tsx": { __farm_client_boundary_originals__: { Card: CardSource } },
  "/src/stars.tsx": { __farm_client_boundary_originals__: { Stars: StarsSource } },
  "/src/callback.tsx": { __farm_client_boundary_originals__: { Callback: CallbackSource } },
  "/src/counter.tsx": { __farm_client_boundary_originals__: { Counter: CounterSource } },
};
const PageButton = createFarmIsolatedClientBoundary(
  React,
  PageButtonSource,
  "/src/page-button.tsx",
  "PageButton",
  "load",
);
const Card = createFarmIsolatedClientBoundary(React, CardSource, "/src/card.tsx", "Card", "load");
const Stars = createFarmIsolatedClientBoundary(
  React,
  StarsSource,
  "/src/stars.tsx",
  "Stars",
  "load",
);
const Callback = createFarmIsolatedClientBoundary(
  React,
  CallbackSource,
  "/src/callback.tsx",
  "Callback",
  "load",
);
const Counter = createFarmIsolatedClientBoundary(
  React,
  CounterSource,
  "/src/counter.tsx",
  "Counter",
  "load",
);

// --- server components --------------------------------------------------------------------------

function Layout({ children }: { children: ReactNode }) {
  return (
    <PanelProvider>
      <header>
        <HeaderButton />
      </header>
      {children}
    </PanelProvider>
  );
}

async function Highlight() {
  await new Promise((resolve) => setTimeout(resolve, 1));
  return <strong>42</strong>;
}

function Frame({ children }: { children: ReactNode }) {
  return <main className="frame">{children}</main>;
}

async function HomePage() {
  const heading = await Promise.resolve("Hello");
  return (
    <Frame>
      <h1>{heading}</h1>
      <PageButton label="page" />
      <Card title="card">
        <p>
          server child <Highlight />
        </p>
      </Card>
      <ul>
        {["a", "b"].map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </Frame>
  );
}

// --- harness ------------------------------------------------------------------------------------

const load = async (reference: string) => {
  const module = modules[reference];
  if (!module) throw new Error(`missing test module ${reference}`);
  return module;
};

function createClientRuntime() {
  const runtime = createFarmIsolatedHydrationRuntime({
    ReactRuntime: React,
    hydrateRoot,
    load,
    schedule: async ({ hydrate }) => hydrate(),
  });
  return { runtime, ServerHtml: createFarmServerPageBoundary(React, runtime) };
}

function routeTree(page: ReactNode) {
  return wrapFarmIsolatedClientGraph(
    React,
    <Layout>
      <div id="__farm_page__">{page}</div>
    </Layout>,
  );
}

async function renderPage(element: ReactNode) {
  const page = await renderFarmServerTreePage(React, element, {
    isolate: (node) => isolateFarmServerPageGraph(React, node),
  });
  const stream = await renderToReadableStream(routeTree(page));
  await stream.allReady;
  return new Response(stream).text();
}

async function hydratePage(html: string) {
  const container = document.createElement("div");
  container.innerHTML = html;
  document.body.append(container);
  const { runtime, ServerHtml } = createClientRuntime();
  const page = await createFarmServerTreeElement(
    React,
    container.querySelector("#__farm_page__")!,
    { load, ServerHtml },
  );
  expect(page).not.toBeNull();
  const errors: unknown[] = [];
  let root!: ReturnType<typeof hydrateRoot>;
  await act(async () => {
    root = hydrateRoot(container, routeTree(page), {
      onRecoverableError: (error) => errors.push(error),
    });
  });
  mountedRoots.push(root);
  return { container, errors, root, runtime, ServerHtml };
}

const mountedRoots: Array<ReturnType<typeof hydrateRoot>> = [];

const click = (container: Element, selector: string) =>
  act(async () => (container.querySelector(selector) as HTMLButtonElement).click());

describe("server tree pages", () => {
  afterEach(() => {
    for (const root of mountedRoots.splice(0)) act(() => root.unmount());
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("hydrates an async page's client components inside the layout's React tree", async () => {
    const html = await renderPage(<HomePage />);
    expect(html).not.toContain("farm-client-boundary");
    expect(html).toContain("<strong>42</strong>");

    const serverUid = /data-uid="([^"]+)"/.exec(html)?.[1];
    const { container, errors } = await hydratePage(html);
    expect(errors).toEqual([]);
    expect(container.querySelector("#page")!.getAttribute("data-uid")).toBe(serverUid);

    // One provider instance: the layout's header and the page's button share its state.
    await click(container, "#header");
    expect(container.querySelector("#page")!.textContent).toBe("page:open");
    await click(container, "#page");
    expect(container.querySelector("#header")!.textContent).toBe("closed");

    // Server JSX passed as children reaches the client component and stays server output.
    await click(container, "#card");
    expect(container.querySelector("#card")!.textContent).toBe("1");
    expect(container.querySelector("section p")!.innerHTML).toBe(
      "server child <strong>42</strong>",
    );
    expect(container.querySelectorAll("li")).toHaveLength(2);
  });

  it("passes resolved promises to client components without suspending hydration", async () => {
    async function Page() {
      return <Stars stars={Promise.resolve(7)} />;
    }
    const { container, errors } = await hydratePage(await renderPage(<Page />));
    expect(errors).toEqual([]);
    expect(container.querySelector("#stars")!.textContent).toBe("7");
  });

  it("streams Suspense content after its fallback and hydrates it", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    async function Slow() {
      await gate;
      return <PageButton label="slow" />;
    }
    async function Page() {
      return (
        <React.Suspense fallback={<p id="fallback">loading</p>}>
          <Slow />
        </React.Suspense>
      );
    }

    const page = await renderFarmServerTreePage(React, <Page />, {
      isolate: (node) => isolateFarmServerPageGraph(React, node),
    });
    const stream = await renderToReadableStream(routeTree(page));
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    const first = decoder.decode((await reader.read()).value);
    expect(first).toContain('id="fallback"');
    expect(first).not.toContain("slow:");
    release();
    let rest = "";
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
      rest += decoder.decode(chunk.value);
    }
    expect(rest).toContain("slow<!-- -->:<!-- -->closed");
    expect(rest).toContain("data-farm-server-tree-chunk");

    // A completed render, as the browser has it once the stream ends.
    const { container, errors } = await hydratePage(await renderPage(<Page />));
    expect(errors).toEqual([]);
    await click(container, "#header");
    expect(container.querySelector("#page")!.textContent).toBe("slow:open");
  });

  it("keeps a server component that calls hooks as server HTML whose client components are islands", async () => {
    function UsesHooks() {
      const id = useId();
      return (
        <div data-id={id}>
          <Counter />
        </div>
      );
    }
    async function Page() {
      return (
        <>
          <UsesHooks />
          <PageButton label="tree" />
        </>
      );
    }
    const html = await renderPage(<Page />);
    expect(html).toContain("<farm-server-html");
    expect(html).toContain('data-farm-client-boundary="/src/counter.tsx"');

    const { container, errors, runtime } = await hydratePage(html);
    expect(errors).toEqual([]);
    await vi.waitFor(() => expect(runtime.rootCount()).toBe(1));
    await click(container, "#island");
    expect(container.querySelector("#island")!.textContent).toBe("1");
    await click(container, "#header");
    expect(container.querySelector("#page")!.textContent).toBe("tree:open");
  });

  it("keeps a client component whose props do not serialize as server HTML", async () => {
    async function Page() {
      return (
        <>
          <Callback onPick={() => {}} />
          <PageButton label="tree" />
        </>
      );
    }
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const html = await renderPage(<Page />);
    expect(html).toMatch(/<farm-server-html[^>]*><button id="callback"/);
    const { container, errors } = await hydratePage(html);
    expect(errors).toEqual([]);
    await click(container, "#header");
    expect(container.querySelector("#page")!.textContent).toBe("tree:open");
  });

  it("wraps the nearest element outside a table when a cell cannot be represented", async () => {
    function Cell() {
      useState(0);
      return <td>cell</td>;
    }
    async function Page() {
      return (
        <section>
          <table>
            <tbody>
              <tr>
                <Cell />
              </tr>
            </tbody>
          </table>
          <PageButton label="tree" />
        </section>
      );
    }
    const html = await renderPage(<Page />);
    expect(html).toContain("<section><farm-server-html");
    expect(html).toMatch(/<farm-server-html[^>]*><table>/);
    const { container, errors } = await hydratePage(html);
    expect(errors).toEqual([]);
    expect(container.querySelector("td")!.textContent).toBe("cell");
  });

  it("propagates errors thrown by the page", async () => {
    const control = Object.assign(new Error("NEXT_NOT_FOUND"), { digest: "NOT_FOUND" });
    async function Missing(): Promise<ReactNode> {
      throw control;
    }
    async function Page() {
      return (
        <Frame>
          <Missing />
        </Frame>
      );
    }
    await expect(
      renderFarmServerTreePage(React, <Page />, {
        isolate: (node) => isolateFarmServerPageGraph(React, node),
      }),
    ).rejects.toBe(control);
  });

  it("rebuilds a page from navigation HTML and re-renders it on a module update", async () => {
    const html = await renderPage(<HomePage />);
    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.append(container);
    const { runtime, ServerHtml } = createClientRuntime();
    const page = await createFarmServerTreeElement(
      React,
      container.querySelector("#__farm_page__")!.innerHTML,
      { load, ServerHtml, key: "/" },
    );
    let root!: ReturnType<typeof hydrateRoot>;
    await act(async () => {
      root = hydrateRoot(container, routeTree(page));
    });
    mountedRoots.push(root);
    expect(container.querySelector("#page")!.textContent).toBe("page:closed");

    function NextPageButton({ label }: { label: string }) {
      return <button id="page">{label}:updated</button>;
    }
    await act(async () => {
      expect(
        runtime.updateModule("/src/page-button.tsx", {
          __farm_client_boundary_originals__: { PageButton: NextPageButton },
        }),
      ).toBe(1);
    });
    expect(container.querySelector("#page")!.textContent).toBe("page:updated");
  });

  it("returns null for a page without a server tree", async () => {
    const { ServerHtml } = createClientRuntime();
    expect(await createFarmServerTreeElement(React, "<p>static</p>", { load, ServerHtml })).toBe(
      null,
    );
  });
});
