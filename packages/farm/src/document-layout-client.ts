/**
 * Client source shared by the development and production client entries, so both wrap
 * layouts the same way. It expects `React` in scope.
 *
 * A root layout may return its own `<html>` document, as the create-app templates do. The
 * server composes that document into the response and moves the body's content into
 * `#root`, so the client renders such a layout as its body's children, with no layout
 * boundary around them, to match the server markup. Every other layout keeps its
 * `display: contents` boundary.
 *
 * The layout function is called by the wrapper to see what it returns. The wrapper is
 * keyed by the layout component, so a hot-reloaded layout remounts instead of reusing
 * another component's hooks.
 *
 * Renderers that export \`markFunctionComponent\` (Svelte, Vue) compile components that are
 * plain functions too, so the wrapper could not tell a layout it may call from one it must
 * mount, and would itself be mounted as one of their components. Under those renderers the
 * layout is rendered inside the boundary element, the same tree the server renders, so
 * hydration keeps the server markup.
 */
export const FARM_LAYOUT_ELEMENT_CLIENT_SOURCE = String.raw`
const farmLayoutComponentKeys = new WeakMap();
let farmLayoutComponentKeyCount = 0;

function farmLayoutComponentKey(Component) {
  if ((typeof Component !== "function" && typeof Component !== "object") || Component === null) {
    return "layout";
  }
  let key = farmLayoutComponentKeys.get(Component);
  if (!key) {
    farmLayoutComponentKeyCount += 1;
    key = "layout-" + farmLayoutComponentKeyCount;
    farmLayoutComponentKeys.set(Component, key);
  }
  return key;
}

// React.Children is React's own; other renderers (Preact) hand children over as plain arrays.
function farmChildrenToArray(children) {
  if (React.Children) return React.Children.toArray(children);
  return [children].flat(Infinity).filter(function (child) {
    return child !== null && child !== undefined && typeof child !== "boolean";
  });
}

function unwrapFarmDocumentElement(node) {
  if (!React.isValidElement(node) || node.type !== "html") return undefined;
  const children = farmChildrenToArray(node.props.children);
  const body = children.find(function (child) {
    return React.isValidElement(child) && child.type === "body";
  });
  if (body) return body.props.children === undefined ? null : body.props.children;
  return children.filter(function (child) {
    return !(React.isValidElement(child) && child.type === "head");
  });
}

function farmLayoutBoundaryElement(pattern, content) {
  return React.createElement(
    "div",
    {
      "data-farm-layout-boundary": "true",
      "data-farm-layout-pattern": pattern,
      style: { display: "contents" },
    },
    content,
  );
}

function FarmLayoutBoundary(props) {
  const Component = props.component;
  const layoutProps = { children: props.children, params: props.params };
  const boundary = function (content) {
    return farmLayoutBoundaryElement(props.pattern, content);
  };
  const isPlainFunction =
    typeof Component === "function" &&
    !(Component.prototype && Component.prototype.isReactComponent);
  if (isPlainFunction) {
    const rendered = Component(layoutProps);
    if (!rendered || typeof rendered.then !== "function") {
      const documentContent = unwrapFarmDocumentElement(rendered);
      return documentContent === undefined ? boundary(rendered) : documentContent;
    }
  }
  return boundary(React.createElement(Component, layoutProps));
}

function createFarmLayoutElement(Component, pattern, children, params) {
  if (typeof React.markFunctionComponent === "function") {
    return farmLayoutBoundaryElement(
      pattern,
      React.createElement(Component, { children: children, params: params }),
    );
  }
  return React.createElement(
    FarmLayoutBoundary,
    { key: farmLayoutComponentKey(Component), component: Component, pattern: pattern, params: params },
    children,
  );
}
`;

/**
 * Islands mode: layouts rendered as server trees, shared by the development and production client
 * entries. Such a layout's module stays on the server; the browser rebuilds it from the tree its
 * HTML carries, and the page renders at its outlet. Each layout keeps one component, so its client
 * state (a provider's) survives navigations that rebuild its tree.
 *
 * It expects `React`, `createFarmServerTreeLayout` and `FarmServerPage` in scope.
 */
export const FARM_SERVER_TREE_LAYOUT_CLIENT_SOURCE = String.raw`
// Declared with var: a layout registry may call getFarmTreeLayoutComponent while it initializes.
var farmTreeLayoutComponents;
var farmTreeLayouts;

function getFarmTreeLayoutComponent(pattern) {
  farmTreeLayoutComponents = farmTreeLayoutComponents || new Map();
  let Component = farmTreeLayoutComponents.get(pattern);
  if (!Component) {
    Component = function FarmTreeLayout(props) {
      const entry = farmTreeLayouts && farmTreeLayouts.get(pattern);
      return entry ? entry.layout.render({ children: props.children }) : null;
    };
    farmTreeLayoutComponents.set(pattern, Component);
  }
  return Component;
}

// A dynamic layout renders again for other params; a static one is the same tree everywhere.
function farmTreeLayoutKey(pattern, params) {
  return pattern.indexOf("[") === -1 ? pattern : pattern + "\u0000" + JSON.stringify(params || {});
}

// Every one of these layouts is already built for these params.
function farmTreeLayoutsBuilt(layouts, params) {
  return layouts.every(function(layout) {
    const entry = farmTreeLayouts && farmTreeLayouts.get(layout.pattern);
    return Boolean(entry && entry.key === farmTreeLayoutKey(layout.pattern, params));
  });
}

// Builds these layouts from source (the document, or a navigation's HTML). A layout the source has
// no tree for keeps its built one when the params match; otherwise this returns false, and the
// route cannot render here.
async function buildFarmTreeLayouts(layouts, params, source, options) {
  const built = [];
  for (const layout of layouts) {
    const key = farmTreeLayoutKey(layout.pattern, params);
    let tree = null;
    try {
      tree = await createFarmServerTreeLayout(React, source, layout.pattern, {
        load: options.load,
        ServerHtml: FarmServerPage,
        onUpdate: options.onUpdate,
      });
    } catch (error) {
      console.warn("[Farm.js] Could not rebuild the server tree of layout " + layout.pattern + ".", error);
    }
    const current = farmTreeLayouts && farmTreeLayouts.get(layout.pattern);
    if (!tree && !(current && current.key === key)) {
      for (const entry of built) entry.layout.dispose();
      return false;
    }
    if (tree) built.push({ pattern: layout.pattern, key: key, layout: tree });
  }
  farmTreeLayouts = farmTreeLayouts || new Map();
  for (const entry of built) {
    const previous = farmTreeLayouts.get(entry.pattern);
    if (previous) previous.layout.dispose();
    farmTreeLayouts.set(entry.pattern, entry);
  }
  return true;
}
`;
