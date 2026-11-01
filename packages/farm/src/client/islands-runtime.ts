/**
 * @internal Islands mode's runtime (`experimental.serverComponents: { mode: "islands" }`), run by
 * islx. Generated code imports these in islands mode under the names the isolated-hydration
 * runtime uses, so the rest of Farm's runtime stays the same; apps on isolated hydration without
 * islands mode never load islx.
 */
import { enhanceForms, setActionNavigator } from "@farm.js/islx/client";
import * as React from "react";
import {
  IslandsProvider,
  Outlet,
  isolateIslands,
  renderServerTree,
  withinClientRoot,
} from "@farm.js/islx/react";
import {
  createHydrationRuntime,
  createServerHtml,
  createServerTreeElement,
  createServerTreeLayout,
  endStreamedContent,
} from "@farm.js/islx/react/client";
import type { FarmIslandStrategy } from "../island";
import { getFarmIslandValuesServer } from "./island-value-protocol";

export interface FarmIslandsRuntimeOptions {
  load(reference: string): Promise<Record<string, unknown>>;
  schedule(options: {
    container: Element;
    strategy: FarmIslandStrategy;
    signal?: AbortSignal;
    hydrate(): Promise<void>;
  }): Promise<unknown>;
  wrap?(element: React.ReactElement): React.ReactNode;
  report?(message: string, error?: unknown): void;
}

// The return types below name islx's functions instead of the React types they infer to: those are
// islx's copy of the React types, which Farm's declarations cannot always name (TS2742 when the
// hoisted @types/react differs from Farm's own).

type Router = {
  refresh?(options?: { scroll?: boolean }): Promise<void>;
  navigate?(href: string): Promise<void>;
};

/**
 * Hydrates islands with Farm's scheduler and providers; actions (from islands, and from forms in
 * server components) refresh through Farm's router.
 */
export function createFarmIsolatedHydrationRuntime(options: FarmIslandsRuntimeOptions) {
  const runtime = createHydrationRuntime({
    load: options.load,
    schedule: options.schedule as Parameters<typeof createHydrationRuntime>[0]["schedule"],
    wrap: options.wrap,
    report: options.report,
  });
  const router = () => (window as Window & { __FARM_SPA_ROUTER__?: Router }).__FARM_SPA_ROUTER__;
  setActionNavigator({
    refresh: () => router()?.refresh?.({ scroll: false }),
    navigate: (href) => {
      const current = router();
      return current?.navigate ? current.navigate(href) : location.assign(href);
    },
  });
  // A form written in a server component posts its action without a page load once this runs,
  // and the page refreshes keeping island state; before, it posts natively.
  enhanceForms();
  return {
    hydrate: runtime.hydrate,
    carryOver: runtime.carryOver,
    updateModule: runtime.update,
    dispose: runtime.dispose,
    rootCount: runtime.rootCount,
    // A streamed navigation ended: boundaries it never completed render in the browser.
    endStream: endStreamedContent,
  };
}

/** A page a hydrating layout keeps as server HTML; its islands start inside it. */
export function createFarmServerPageBoundary(
  _React: typeof React,
  runtime: Parameters<typeof createServerHtml>[0],
): ReturnType<typeof createServerHtml> {
  return createServerHtml(runtime);
}

/** A layout that hydrates as one React root: its client components join that root. */
export function wrapFarmIsolatedClientGraph(
  _React: typeof React,
  element: React.ReactNode,
): ReturnType<typeof withinClientRoot> {
  return withinClientRoot(element);
}

/** The page such a layout keeps as server HTML: its client components are islands again. */
export function isolateFarmServerPageGraph(
  _React: typeof React,
  element: React.ReactNode,
): ReturnType<typeof isolateIslands> {
  return isolateIslands(element);
}

/** An async page under a hydrating layout, as a server tree the browser rebuilds in its root. */
export function renderFarmServerTreePage(
  _React: typeof React,
  element: React.ReactNode,
  options: { isolate?(element: React.ReactNode): React.ReactNode; payloadOnly?: boolean },
): ReturnType<typeof renderServerTree> {
  return renderServerTree(element, {
    isolate: options.isolate,
    payloadOnly: options.payloadOnly,
    // The values this request's browser holds (Farm's request store).
    held: getFarmIslandValuesServer()?.held() ?? null,
  });
}

/** Rebuilds a server-tree page in the browser, inside the layout's React root. */
export function createFarmServerTreeElement(
  _React: typeof React,
  source: ParentNode | string,
  options: {
    load(reference: string): Promise<Record<string, unknown>>;
    ServerHtml: React.ComponentType<any>;
    key?: string;
  },
): ReturnType<typeof createServerTreeElement> {
  return createServerTreeElement(source, {
    load: options.load,
    ServerHtml: options.ServerHtml,
    key: options.key,
  });
}

/**
 * A layout around a client provider, as a server tree (islands mode): its module stays on the
 * server, and the browser rebuilds it with the page at its outlet, so the page reads its context.
 * `outlets` are what the layout receives as elements: `children`, and its route slots.
 */
export function renderFarmServerTreeLayout(
  Layout: React.ComponentType<any>,
  props: Record<string, unknown>,
  outlets: Record<string, React.ReactNode>,
  scope: string,
): ReturnType<typeof renderServerTree> {
  const outletProps: Record<string, React.ReactNode> = {};
  for (const name of Object.keys(outlets)) {
    outletProps[name] = React.createElement(Outlet, name === "children" ? {} : { name });
  }
  return renderServerTree(React.createElement(Layout, { ...props, ...outletProps }), {
    isolate: isolateIslands,
    outlets,
    scope,
    held: getFarmIslandValuesServer()?.held() ?? null,
  });
}

/** Rebuilds a server-tree layout in the browser; null when `source` has no tree for it. */
export function createFarmServerTreeLayout(
  _React: typeof React,
  source: ParentNode | string,
  scope: string,
  options: {
    load(reference: string): Promise<Record<string, unknown>>;
    ServerHtml: React.ComponentType<any>;
    onUpdate?(): void;
  },
) {
  return createServerTreeLayout(source, scope, options);
}

/**
 * One server render of a page. Its islands write each large value once per render: a request that
 * renders twice (a page that calls notFound(), or a synchronous attempt that suspended and
 * streams instead) sends the values again in the render that reaches the browser.
 */
export function withFarmIslandsRender(element: React.ReactNode): React.ReactElement {
  return React.createElement(
    IslandsProvider,
    { held: getFarmIslandValuesServer()?.held() ?? null },
    element,
  );
}
