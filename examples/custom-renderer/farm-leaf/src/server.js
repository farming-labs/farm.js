// What Farm imports to render a route on the server.

import { resolveFarmIsland } from "@farm.js/core/renderer";
import { Fragment, createContext, createElement, useContext } from "leaf";

export { Fragment, Suspense, createElement, isValidElement } from "leaf";
export { renderToReadableStream, renderToString } from "leaf/server";

export const name = "leaf";
export const capabilities = { streaming: { node: false, web: true } };

// Whether a component renders inside a tree that hydrates as one root. There, a client component
// is part of that root rather than an island of its own.
const ClientGraph = createContext(false);

/** Farm marks a route's tree that hydrates as one root. */
export function wrapClientGraph(element) {
  return createElement(ClientGraph.Provider, { value: true }, element);
}

/** And a page such a root keeps as server HTML, where client components are islands again. */
export function isolateServerPageGraph(element) {
  return createElement(ClientGraph.Provider, { value: false }, element);
}

function withoutClientAttributes(props) {
  return Object.fromEntries(Object.entries(props).filter(([key]) => !key.startsWith("client:")));
}

function script({ attributes, text }) {
  // Farm escaped the text for a script element already.
  return createElement("script", { ...attributes, dangerouslySetInnerHTML: { __html: text } });
}

/**
 * Farm wraps each export of a "use client" module in the server graph with this. Rendered from
 * server output, the component starts an island: Farm's island element around it, and the
 * scripts that carry its props. The browser hydrates it with farm-leaf/client's hydrateRoot.
 */
export function withIsland(component, reference) {
  if (typeof component !== "function") return component;
  function Island(props) {
    const island = useContext(ClientGraph) ? undefined : resolveFarmIsland(props, reference);
    if (!island) return createElement(component, withoutClientAttributes(props));
    return createElement(
      Fragment,
      null,
      ...island.values.map(script),
      createElement(
        island.element.tag,
        island.element.attributes,
        createElement(component, island.props),
      ),
      script(island.script),
    );
  }
  return Island;
}
