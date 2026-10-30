/**
 * @internal Islands mode's runtime (`experimental.serverComponents: { mode: "islands" }`), run by
 * islx. Generated code imports these in islands mode under the names the isolated-hydration
 * runtime uses, so the rest of Farm's runtime stays the same; apps on isolated hydration without
 * islands mode never load islx.
 */
import type React from "react";
import { enhanceForms, setActionNavigator } from "@farm.js/islx/client";
import { isolateIslands, renderServerTree, withinClientRoot } from "@farm.js/islx/react";
import {
  createHydrationRuntime,
  createServerHtml,
  createServerTreeElement,
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
  };
}

/** A page a hydrating layout keeps as server HTML; its islands start inside it. */
export function createFarmServerPageBoundary(
  _React: typeof React,
  runtime: Parameters<typeof createServerHtml>[0],
) {
  return createServerHtml(runtime);
}

/** A layout that hydrates as one React root: its client components join that root. */
export function wrapFarmIsolatedClientGraph(_React: typeof React, element: React.ReactNode) {
  return withinClientRoot(element);
}

/** The page such a layout keeps as server HTML: its client components are islands again. */
export function isolateFarmServerPageGraph(_React: typeof React, element: React.ReactNode) {
  return isolateIslands(element);
}

/** An async page under a hydrating layout, as a server tree the browser rebuilds in its root. */
export function renderFarmServerTreePage(
  _React: typeof React,
  element: React.ReactNode,
  options: { isolate?(element: React.ReactNode): React.ReactNode; payloadOnly?: boolean },
) {
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
) {
  return createServerTreeElement(source, {
    load: options.load,
    ServerHtml: options.ServerHtml,
    key: options.key,
  });
}
