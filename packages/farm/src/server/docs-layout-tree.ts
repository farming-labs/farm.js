// The tree a built-in docs runtime page (`docs.entry`, no adapter) renders in under layouts that
// hydrate. The development server (FarmServerRenderer.renderDocsLayoutDocument) and the production
// entry (wrapFarmDocsResponseWithLayouts in nitro/universal-build.ts) both build it here, so the
// browser hydrates the same markup in either: the tree an app page has, with the docs runtime's
// HTML as the page. The browser draws it with createFarmLayoutElement and createLayoutPageBoundary.

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

/** The strategy every hydrating layout names, else `load`: the strategy the docs page waits on. */
export function resolveFarmDocsLayoutIslandStrategy(layouts: readonly FarmDocsLayout[]): string {
  const strategies = layouts.flatMap((layout) =>
    layout.shouldHydrate && layout.islandStrategy ? [layout.islandStrategy] : [],
  );
  return strategies.every((strategy) => strategy === strategies[0])
    ? (strategies[0] ?? "load")
    : "load";
}

/**
 * The docs page in the place of an app page: its HTML inside the page boundary, and each layout
 * around it in its boundary, root first in `layouts`.
 */
export function createFarmDocsLayoutTree(
  runtime: FarmElementFactory,
  options: {
    pageHtml: string;
    layouts: readonly FarmDocsLayout[];
    params: Record<string, string>;
    islandStrategy: string;
  },
): unknown {
  let element = runtime.createElement("div", {
    id: "__farm_page__",
    "data-farm-segment": "page",
    "data-farm-client": "false",
    "data-farm-layout-client": "true",
    "data-farm-island": "page",
    "data-farm-island-strategy": options.islandStrategy,
    dangerouslySetInnerHTML: { __html: options.pageHtml },
  });
  for (let index = options.layouts.length - 1; index >= 0; index--) {
    const layout = options.layouts[index]!;
    if (!layout.Component) continue;
    element = createFarmLayoutBoundary(
      runtime,
      layout.pattern,
      undefined,
      runtime.createElement(layout.Component, { children: element, params: options.params }),
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
