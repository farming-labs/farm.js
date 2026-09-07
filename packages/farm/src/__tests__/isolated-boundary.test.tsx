import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import React, { act, useEffect, useRef, useState } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createFarmIsolatedClientBoundary,
  createFarmIsolatedHydrationRuntime,
} from "../client/isolated-boundary";
import { scheduleFarmIslandHydration } from "../client/island-runtime";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const requireReact18 = createRequire(
  path.join(packageRoot, "../../examples/simple-demo/package.json"),
);

function createRuntime(modules: Record<string, Record<string, unknown>>) {
  return createFarmIsolatedHydrationRuntime({
    ReactRuntime: React,
    hydrateRoot,
    load: async (reference) => {
      const module = modules[reference];
      if (!module) throw new Error(`missing test module: ${reference}`);
      return module;
    },
    schedule: async ({ hydrate }) => hydrate(),
  });
}

describe("isolated client boundary", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("preserves SSR output and embeds serializable hydration props", () => {
    function Counter({ initial }: { initial: number }) {
      return <button>{initial}</button>;
    }
    const Boundary = createFarmIsolatedClientBoundary(
      React,
      Counter,
      "/src/counter.tsx",
      "default",
      "load",
    );

    const html = renderToString(<Boundary initial={2} />);
    expect(html).toContain('data-farm-client-boundary="/src/counter.tsx"');
    expect(html).toContain('type="application/json"');
    expect(html).toMatch(/data-farm-client-id="([^"]+)"/);
    expect(html).toMatch(/data-farm-client-props="([^"]+)"/);
    expect(html.match(/data-farm-client-id="([^"]+)"/)?.[1]).toBe(
      html.match(/data-farm-client-props="([^"]+)"/)?.[1],
    );
    expect(html).toContain('{"initial":2}');
    expect(html).toContain("<button>2</button>");
  });

  it("keeps serialized props non-executable and round-trips supported values", async () => {
    function Values({ value }: { value: Record<string, unknown> }) {
      return <output data-values>{JSON.stringify(value)}</output>;
    }
    const Boundary = createFarmIsolatedClientBoundary(
      React,
      Values,
      "/src/values.tsx",
      "default",
      "load",
    );
    const value = {
      text: "</script><script>unsafe()</script>&>\u2028\u2029",
      nested: Object.assign(Object.create(null), { enabled: true }),
      items: [null, false, 4.5],
    };

    const html = renderToString(<Boundary value={value} />);
    document.body.innerHTML = html;
    const payload =
      document.querySelector<HTMLScriptElement>(
        'script[type="application/json"][data-farm-client-props]',
      )?.textContent ?? "";
    expect(payload).not.toContain("<");
    expect(payload).not.toContain(">");
    expect(payload).not.toContain("&");
    expect(payload).toContain("\\u003c/script\\u003e");

    const runtime = createRuntime({
      "/src/values.tsx": { __farm_client_boundary_originals__: { default: Values } },
    });
    const recoverableErrors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await act(async () => runtime.hydrate(document));

    expect(document.querySelector("[data-values]")?.textContent).toBe(JSON.stringify(value));
    expect(runtime.rootCount()).toBe(1);
    expect(recoverableErrors).not.toHaveBeenCalled();
  });

  it("round-trips supported props with React 18", async () => {
    const React18 = requireReact18("react") as typeof React;
    const { hydrateRoot: hydrateRoot18 } = requireReact18("react-dom/client") as {
      hydrateRoot: typeof hydrateRoot;
    };
    const { renderToString: renderToString18 } = requireReact18("react-dom/server") as {
      renderToString: typeof renderToString;
    };

    function Values({ value }: { value: Record<string, unknown> }) {
      return React18.createElement("output", { "data-react-18-values": "" }, JSON.stringify(value));
    }
    const Boundary = createFarmIsolatedClientBoundary(
      React18,
      Values,
      "/src/react-18-values.tsx",
      "default",
      "load",
    );
    const value = { nested: { enabled: true }, items: [null, false, 4.5] };
    document.body.innerHTML = renderToString18(React18.createElement(Boundary, { value }));
    const runtime = createFarmIsolatedHydrationRuntime({
      ReactRuntime: React18,
      hydrateRoot: hydrateRoot18,
      load: async () => ({ __farm_client_boundary_originals__: { default: Values } }),
      schedule: async ({ hydrate }) => hydrate(),
    });
    const recoverableErrors = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await React18.act(async () => runtime.hydrate(document));

    expect(document.querySelector("[data-react-18-values]")?.textContent).toBe(
      JSON.stringify(value),
    );
    expect(runtime.rootCount()).toBe(1);
    expect(recoverableErrors).not.toHaveBeenCalled();
  });

  it("hydrates sibling boundaries as independent roots", async () => {
    function Counter({ name }: { name: string }) {
      const [count, setCount] = useState(0);
      return (
        <button data-counter={name} onClick={() => setCount((value) => value + 1)}>
          {name}:{count}
        </button>
      );
    }
    const Boundary = createFarmIsolatedClientBoundary(
      React,
      Counter,
      "/src/counter.tsx",
      "default",
      "load",
    );
    document.body.innerHTML = renderToString(
      <main>
        <Boundary name="first" />
        <Boundary name="second" />
      </main>,
    );
    const runtime = createRuntime({
      "/src/counter.tsx": { __farm_client_boundary_originals__: { default: Counter } },
    });

    await act(async () => runtime.hydrate(document));
    const first = document.querySelector<HTMLButtonElement>('[data-counter="first"]')!;
    const second = document.querySelector<HTMLButtonElement>('[data-counter="second"]')!;
    const secondIdentity = second;
    await act(async () => first.click());

    expect(first.textContent).toBe("first:1");
    expect(second.textContent).toBe("second:0");
    expect(document.querySelector('[data-counter="second"]')).toBe(secondIdentity);
    expect(runtime.rootCount()).toBe(2);
    expect(document.querySelectorAll('[data-farm-hydrated="true"]')).toHaveLength(2);
  });

  it("unmounts a root exactly once before its container is removed", async () => {
    const cleanupConnected: boolean[] = [];
    function Lifecycle() {
      const ref = useRef<HTMLButtonElement>(null);
      useEffect(() => {
        const container = ref.current?.closest("farm-client-boundary");
        return () => {
          cleanupConnected.push(container?.isConnected === true);
        };
      }, []);
      return <button ref={ref}>Mounted</button>;
    }
    const Boundary = createFarmIsolatedClientBoundary(
      React,
      Lifecycle,
      "/src/lifecycle.tsx",
      "default",
      "load",
    );
    document.body.innerHTML = renderToString(<Boundary />);
    const container = document.querySelector("farm-client-boundary")!;
    const runtime = createRuntime({
      "/src/lifecycle.tsx": { __farm_client_boundary_originals__: { default: Lifecycle } },
    });

    await act(async () => runtime.hydrate(document));
    act(() => runtime.dispose(container));
    container.remove();
    act(() => runtime.dispose(container));

    expect(cleanupConnected).toEqual([true]);
    expect(runtime.rootCount()).toBe(0);
  });

  it("schedules a pending boundary once and cancels it when its subtree is disposed", async () => {
    function Deferred() {
      return <button>Deferred</button>;
    }
    const Boundary = createFarmIsolatedClientBoundary(
      React,
      Deferred,
      "/src/deferred.tsx",
      "default",
      "interaction",
    );
    document.body.innerHTML = renderToString(<Boundary />);
    const container = document.querySelector("farm-client-boundary")!;
    const schedule = vi.fn(scheduleFarmIslandHydration);
    const runtime = createFarmIsolatedHydrationRuntime({
      ReactRuntime: React,
      hydrateRoot,
      load: async () => ({ __farm_client_boundary_originals__: { default: Deferred } }),
      schedule,
    });

    await runtime.hydrate(document);
    await runtime.hydrate(document);
    expect(schedule).toHaveBeenCalledOnce();
    expect(schedule.mock.calls[0]?.[0].signal?.aborted).toBe(false);

    runtime.dispose(container);
    expect(schedule.mock.calls[0]?.[0].signal?.aborted).toBe(true);
    container.querySelector<HTMLButtonElement>("button")!.click();
    await Promise.resolve();

    expect(schedule).toHaveBeenCalledTimes(1);
    expect(container.hasAttribute("data-farm-island-hydrated")).toBe(false);
    expect(runtime.rootCount()).toBe(0);
  });

  it("updates every live instance of a changed module without replacing sibling roots", async () => {
    function Before({ name }: { name: string }) {
      return <output data-version={name}>before:{name}</output>;
    }
    function After({ name }: { name: string }) {
      return <output data-version={name}>after:{name}</output>;
    }
    function StableCounter() {
      const [count, setCount] = useState(0);
      return <button onClick={() => setCount((value) => value + 1)}>stable:{count}</button>;
    }
    const ChangedBoundary = createFarmIsolatedClientBoundary(
      React,
      Before,
      "/src/changed.tsx",
      "default",
      "load",
    );
    const StableBoundary = createFarmIsolatedClientBoundary(
      React,
      StableCounter,
      "/src/stable.tsx",
      "default",
      "load",
    );
    document.body.innerHTML = renderToString(
      <section data-layout>
        <ChangedBoundary name="first" />
        <ChangedBoundary name="second" />
        <StableBoundary />
      </section>,
    );
    const layout = document.querySelector("[data-layout]");
    const runtime = createRuntime({
      "/src/changed.tsx": { __farm_client_boundary_originals__: { default: Before } },
      "/src/stable.tsx": {
        __farm_client_boundary_originals__: { default: StableCounter },
      },
    });

    await act(async () => runtime.hydrate(document));
    await act(async () => document.querySelector<HTMLButtonElement>("button")!.click());
    await act(async () => {
      expect(
        runtime.updateModule("/src/changed.tsx", {
          __farm_client_boundary_originals__: { default: After },
        }),
      ).toBe(2);
    });

    expect(
      Array.from(document.querySelectorAll("[data-version]")).map((element) => element.textContent),
    ).toEqual(["after:first", "after:second"]);
    expect(document.querySelector("button")?.textContent).toBe("stable:1");
    expect(document.querySelector("[data-layout]")).toBe(layout);
    expect(runtime.rootCount()).toBe(3);
  });

  it("updates isolated roots without replacing sibling state with React 18", async () => {
    const React18 = requireReact18("react") as typeof React;
    const { hydrateRoot: hydrateRoot18 } = requireReact18("react-dom/client") as {
      hydrateRoot: typeof hydrateRoot;
    };
    const { renderToString: renderToString18 } = requireReact18("react-dom/server") as {
      renderToString: typeof renderToString;
    };
    function Before({ name }: { name: string }) {
      return React18.createElement("output", { "data-react-18-version": name }, `before:${name}`);
    }
    function After({ name }: { name: string }) {
      return React18.createElement("output", { "data-react-18-version": name }, `after:${name}`);
    }
    function StableCounter() {
      const [count, setCount] = React18.useState(0);
      return React18.createElement(
        "button",
        { onClick: () => setCount((value) => value + 1) },
        `stable:${count}`,
      );
    }
    const ChangedBoundary = createFarmIsolatedClientBoundary(
      React18,
      Before,
      "/src/react-18-changed.tsx",
      "default",
      "load",
    );
    const StableBoundary = createFarmIsolatedClientBoundary(
      React18,
      StableCounter,
      "/src/react-18-stable.tsx",
      "default",
      "load",
    );
    document.body.innerHTML = renderToString18(
      React18.createElement(
        "section",
        { "data-react-18-layout": "" },
        React18.createElement(ChangedBoundary, { name: "first" }),
        React18.createElement(ChangedBoundary, { name: "second" }),
        React18.createElement(StableBoundary),
      ),
    );
    const layout = document.querySelector("[data-react-18-layout]");
    const runtime = createFarmIsolatedHydrationRuntime({
      ReactRuntime: React18,
      hydrateRoot: hydrateRoot18,
      load: async (reference) => ({
        __farm_client_boundary_originals__: {
          default: reference.includes("stable") ? StableCounter : Before,
        },
      }),
      schedule: async ({ hydrate }) => hydrate(),
    });

    await React18.act(async () => runtime.hydrate(document));
    await React18.act(async () => document.querySelector<HTMLButtonElement>("button")!.click());
    await React18.act(async () => {
      expect(
        runtime.updateModule("/src/react-18-changed.tsx", {
          __farm_client_boundary_originals__: { default: After },
        }),
      ).toBe(2);
    });

    expect(
      Array.from(document.querySelectorAll("[data-react-18-version]")).map(
        (element) => element.textContent,
      ),
    ).toEqual(["after:first", "after:second"]);
    expect(document.querySelector("button")?.textContent).toBe("stable:1");
    expect(document.querySelector("[data-react-18-layout]")).toBe(layout);
    expect(runtime.rootCount()).toBe(3);
  });

  it("keeps a nested client import inside its parent's React root", async () => {
    function Child() {
      const [count, setCount] = useState(0);
      return (
        <button data-nested-counter onClick={() => setCount((value) => value + 1)}>
          nested:{count}
        </button>
      );
    }
    const ChildBoundary = createFarmIsolatedClientBoundary(
      React,
      Child,
      "/src/child.tsx",
      "default",
      "load",
    );
    function Parent() {
      return (
        <section data-parent>
          <ChildBoundary />
        </section>
      );
    }
    const ParentBoundary = createFarmIsolatedClientBoundary(
      React,
      Parent,
      "/src/parent.tsx",
      "default",
      "load",
    );
    const html = renderToString(<ParentBoundary />);
    expect(html.match(/<farm-client-boundary/g)).toHaveLength(1);
    expect(html.match(/type="application\/json"/g)).toHaveLength(1);
    document.body.innerHTML = html;
    const runtime = createRuntime({
      "/src/parent.tsx": { __farm_client_boundary_originals__: { default: Parent } },
    });

    await act(async () => runtime.hydrate(document));
    const counter = document.querySelector<HTMLButtonElement>("[data-nested-counter]")!;
    await act(async () => counter.click());

    expect(counter.textContent).toBe("nested:1");
    expect(runtime.rootCount()).toBe(1);
    expect(document.querySelectorAll("farm-client-boundary")).toHaveLength(1);
  });

  it("preserves client-local Suspense behavior", async () => {
    let resolveLazy: ((module: { default: React.ComponentType }) => void) | undefined;
    const Lazy = React.lazy(
      () =>
        new Promise<{ default: React.ComponentType }>((resolve) => {
          resolveLazy = resolve;
        }),
    );
    function Feature() {
      const [showLazy, setShowLazy] = useState(false);
      return (
        <React.Suspense fallback={<output data-local-loading>Loading</output>}>
          {showLazy ? (
            <Lazy />
          ) : (
            <button data-show-lazy onClick={() => setShowLazy(true)}>
              Show
            </button>
          )}
        </React.Suspense>
      );
    }
    const Boundary = createFarmIsolatedClientBoundary(
      React,
      Feature,
      "/src/suspense.tsx",
      "default",
      "load",
    );
    document.body.innerHTML = renderToString(<Boundary />);
    const runtime = createRuntime({
      "/src/suspense.tsx": { __farm_client_boundary_originals__: { default: Feature } },
    });

    await act(async () => runtime.hydrate(document));
    await act(async () => document.querySelector<HTMLButtonElement>("[data-show-lazy]")!.click());
    expect(document.querySelector("[data-local-loading]")?.textContent).toBe("Loading");
    await act(async () => {
      resolveLazy?.({ default: () => <output data-local-ready>Ready</output> });
      await Promise.resolve();
    });

    expect(document.querySelector("[data-local-ready]")?.textContent).toBe("Ready");
    expect(runtime.rootCount()).toBe(1);
  });

  it("lets a client-local error boundary handle render failures", async () => {
    class LocalErrorBoundary extends React.Component<
      { children: React.ReactNode },
      { failed: boolean }
    > {
      state = { failed: false };

      static getDerivedStateFromError() {
        return { failed: true };
      }

      render() {
        return this.state.failed ? <output data-local-error>Caught</output> : this.props.children;
      }
    }
    function Broken() {
      throw new Error("handled by local boundary");
    }
    function Feature() {
      const [broken, setBroken] = useState(false);
      return (
        <LocalErrorBoundary>
          {broken ? (
            <Broken />
          ) : (
            <button data-break-local onClick={() => setBroken(true)}>
              Break
            </button>
          )}
        </LocalErrorBoundary>
      );
    }
    const Boundary = createFarmIsolatedClientBoundary(
      React,
      Feature,
      "/src/local-error.tsx",
      "default",
      "load",
    );
    document.body.innerHTML = renderToString(<Boundary />);
    const report = vi.fn();
    const runtime = createFarmIsolatedHydrationRuntime({
      ReactRuntime: React,
      hydrateRoot,
      load: async () => ({ __farm_client_boundary_originals__: { default: Feature } }),
      schedule: async ({ hydrate }) => hydrate(),
      report,
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await act(async () => runtime.hydrate(document));
    await act(async () => document.querySelector<HTMLButtonElement>("[data-break-local]")!.click());

    expect(document.querySelector("[data-local-error]")?.textContent).toBe("Caught");
    expect(report).not.toHaveBeenCalled();
    expect(runtime.rootCount()).toBe(1);
  });

  it("keeps unsupported props server-rendered without emitting an unsafe marker", () => {
    function Action({ onAction }: { onAction: () => void }) {
      return <button onClick={onAction}>Run</button>;
    }
    const Boundary = createFarmIsolatedClientBoundary(
      React,
      Action,
      "/src/action.tsx",
      "default",
      "load",
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubGlobal("window", undefined);

    const html = renderToString(<Boundary onAction={() => undefined} />);
    expect(html).toBe("<button>Run</button>");
    expect(html).not.toContain("farm-client-boundary");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("function values"));
  });

  it("rejects undefined values instead of changing their client semantics to null", () => {
    function Value({ value }: { value?: string }) {
      return <span>{String(value)}</span>;
    }
    const Boundary = createFarmIsolatedClientBoundary(
      React,
      Value,
      "/src/value.tsx",
      "default",
      "load",
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubGlobal("window", undefined);

    const html = renderToString(<Boundary value={undefined} />);
    expect(html).toBe("<span>undefined</span>");
    expect(html).not.toContain("farm-client-boundary");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("undefined values"));
  });

  const circularValue: Record<string, unknown> = {};
  circularValue.self = circularValue;

  it.each([
    ["React elements", { children: <strong>child</strong> }],
    ["class instances", { value: new Date(0) }],
    ["circular values", { value: circularValue }],
    ["symbol values", { value: Symbol("unsafe") }],
    ["bigint values", { value: 1n }],
    ["non-finite numbers", { value: Number.POSITIVE_INFINITY }],
  ])("preserves SSR without a marker for unsupported %s", (_label, props) => {
    function Value(input: Record<string, unknown>) {
      return <span>{String(input.value ?? "content")}</span>;
    }
    const Boundary = createFarmIsolatedClientBoundary(
      React,
      Value,
      "/src/value.tsx",
      "default",
      "load",
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubGlobal("window", undefined);

    const html = renderToString(<Boundary {...props} />);
    expect(html).not.toContain("farm-client-boundary");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Could not isolate"));
  });

  it("preserves SSR and reports the original module-load error", async () => {
    function Ready() {
      return <button data-ready>Server content</button>;
    }
    const Boundary = createFarmIsolatedClientBoundary(
      React,
      Ready,
      "/src/missing.tsx",
      "default",
      "load",
    );
    document.body.innerHTML = renderToString(<Boundary />);
    const serverHTML = document.querySelector("farm-client-boundary")?.innerHTML;
    const failure = new Error("chunk unavailable");
    const report = vi.fn();
    const runtime = createFarmIsolatedHydrationRuntime({
      ReactRuntime: React,
      hydrateRoot,
      load: async () => {
        throw failure;
      },
      schedule: scheduleFarmIslandHydration,
      report,
    });

    await act(async () => runtime.hydrate(document));
    await Promise.resolve();

    expect(document.querySelector("farm-client-boundary")?.innerHTML).toBe(serverHTML);
    expect(
      document.querySelector("farm-client-boundary")?.hasAttribute("data-farm-island-hydrated"),
    ).toBe(false);
    expect(runtime.rootCount()).toBe(0);
    expect(report).toHaveBeenCalledWith(
      expect.stringContaining("/src/missing.tsx#default"),
      failure,
    );
  });

  it("restores SSR when the isolated root throws during hydration", async () => {
    function ServerComponent() {
      return <button data-server-content>Server content</button>;
    }
    function BrokenClientComponent(): React.ReactNode {
      throw new Error("client render failed");
    }
    const Boundary = createFarmIsolatedClientBoundary(
      React,
      ServerComponent,
      "/src/broken.tsx",
      "default",
      "load",
    );
    document.body.innerHTML = renderToString(<Boundary />);
    const container = document.querySelector("farm-client-boundary")!;
    const serverHTML = container.innerHTML;
    const report = vi.fn();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const runtime = createFarmIsolatedHydrationRuntime({
      ReactRuntime: React,
      hydrateRoot,
      load: async () => ({
        __farm_client_boundary_originals__: { default: BrokenClientComponent },
      }),
      schedule: async ({ hydrate }) => hydrate(),
      report,
    });

    await act(async () => runtime.hydrate(document));
    await act(async () => Promise.resolve());

    expect(container.innerHTML).toBe(serverHTML);
    expect(container.hasAttribute("data-farm-hydrated")).toBe(false);
    expect(container.hasAttribute("data-farm-island-hydrated")).toBe(false);
    expect(runtime.rootCount()).toBe(0);
    expect(report).toHaveBeenCalledWith(
      expect.stringContaining("/src/broken.tsx#default"),
      expect.objectContaining({ message: "client render failed" }),
    );
  });
});
