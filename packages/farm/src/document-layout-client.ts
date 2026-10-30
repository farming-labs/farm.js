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
