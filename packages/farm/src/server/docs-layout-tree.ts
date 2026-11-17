// The tree a built-in docs runtime page (`docs.entry`, no adapter) renders in under layouts with
// client components. The development server (ServerRenderer.wrapDocsResponseWithLayouts) and the
// production entry (wrapFarmDocsResponseWithLayouts in nitro/universal-build.ts) both build it
// here, so the browser gets the same markup from either: the tree an app page has, with the docs
// runtime's HTML as the page.

import { extractFarmFullDocument } from "./full-document";

/** The renderer's server runtime, or React itself: anything that creates elements. */
interface FarmElementFactory {
  createElement(type: any, props?: any, ...children: any[]): unknown;
}

interface FarmDocsLayout {
  pattern: string;
  /** The layout module's default export; a layout without one is skipped. */
  Component: unknown;
  shouldHydrate?: boolean;
  islandStrategy?: string | null;
  /** Islands mode: a layout around a client provider, rendered as a server tree. */
  serverTree?: boolean;
  /**
   * A layout whose client components are islands of their own (its plan's
   * `hasIsolatedClientBoundaries`): in islands mode, with `isolatedClientHydration`, or async.
   */
  islands?: boolean;
}

/**
 * The element a layout renders in. A layout chain that hydrates is drawn the same way by the
 * browser (createFarmLayoutElement, document-layout-client.ts), without a key.
 */
export function createFarmLayoutBoundary(
  runtime: FarmElementFactory,
  pattern: string,
  key: string | undefined,
  element: unknown,
): unknown {
  return runtime.createElement(
    "div",
    {
      "data-farm-layout-boundary": "true",
      "data-farm-layout-pattern": pattern,
      "data-farm-layout-key": key,
      style: { display: "contents" },
    },
    element,
  );
}

/**
 * Whether these layouts wrap the docs page: one hydrates, or one's client components are islands
 * of their own, as on an app page. Otherwise the docs runtime's document is sent as is.
 */
export function farmDocsLayoutsWrapPage(layouts: readonly Omit<FarmDocsLayout, "Component">[]) {
  return layouts.some((layout) => layout.shouldHydrate === true || layout.islands === true);
}

/** The strategy every hydrating layout names, else `load`: the strategy the docs page waits on. */
export function resolveFarmDocsLayoutIslandStrategy(
  layouts: readonly Omit<FarmDocsLayout, "Component">[],
): string {
  const strategies = layouts.flatMap((layout) =>
    layout.shouldHydrate && layout.islandStrategy ? [layout.islandStrategy] : [],
  );
  return strategies.every((strategy) => strategy === strategies[0])
    ? (strategies[0] ?? "load")
    : "load";
}

/**
 * The docs page in the place of an app page: its HTML inside the page boundary, and each layout
 * around it in its boundary, root first in `layouts`. When a layout hydrates, the chain is one
 * client root the browser draws, unkeyed, and a server-tree layout renders as its tree
 * (`renderServerTreeLayout`) with the docs page at its outlet. Otherwise the layouts' client
 * components are islands and each boundary takes its segment key (`layoutKey`, islands mode). The
 * caller wraps a hydrating chain in its client graph, as for an app page.
 */
export async function createFarmDocsLayoutTree(
  runtime: FarmElementFactory,
  options: {
    pageHtml: string;
    layouts: readonly FarmDocsLayout[];
    params: Record<string, string>;
    renderServerTreeLayout?: (
      Layout: unknown,
      props: { params: Record<string, string> },
      outlets: { children: unknown },
      pattern: string,
    ) => unknown;
    layoutKey?: (pattern: string) => string | undefined;
  },
): Promise<unknown> {
  const layoutHydrates = options.layouts.some((layout) => layout.shouldHydrate === true);
  let element = runtime.createElement("div", {
    id: "__farm_page__",
    "data-farm-segment": "page",
    "data-farm-client": "false",
    ...(layoutHydrates ? { "data-farm-layout-client": "true" } : {}),
    "data-farm-island": "page",
    "data-farm-island-strategy": resolveFarmDocsLayoutIslandStrategy(options.layouts),
    dangerouslySetInnerHTML: { __html: options.pageHtml },
  });
  for (let index = options.layouts.length - 1; index >= 0; index--) {
    const layout = options.layouts[index]!;
    if (!layout.Component) continue;
    element = createFarmLayoutBoundary(
      runtime,
      layout.pattern,
      layoutHydrates ? undefined : options.layoutKey?.(layout.pattern),
      layout.serverTree && layoutHydrates && options.renderServerTreeLayout
        ? await options.renderServerTreeLayout(
            layout.Component,
            { params: options.params },
            { children: element },
            layout.pattern,
          )
        : runtime.createElement(layout.Component, { children: element, params: options.params }),
    );
  }
  return element;
}

/**
 * The rendered `<div id="root">` for the docs document's body. A root layout that renders the
 * document gives #root its body, as on an app page (ensureFarmDocumentRoot), and the browser draws
 * the layout's body content there without a boundary (createFarmLayoutElement). The docs runtime
 * keeps its own document.
 */
export function placeFarmDocsLayoutRoot(rootMarkup: string): string {
  const rootOpen = '<div id="root">';
  const rootStart = rootMarkup.indexOf(rootOpen);
  const layoutDocument =
    rootStart >= 0 ? extractFarmFullDocument(rootMarkup.slice(rootStart + rootOpen.length)) : null;
  if (layoutDocument === null) return rootMarkup;
  const layoutBody = /<body\b[^>]*>([\s\S]*)<\/body>/i.exec(layoutDocument);
  return `${rootMarkup.slice(0, rootStart)}${rootOpen}${layoutBody ? layoutBody[1] : ""}</div>`;
}
