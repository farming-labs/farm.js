// leaf: elements, components, and hooks. The DOM renderer lives in `leaf/dom` and the HTML
// renderer in `leaf/server`; both drive components through the hook dispatcher below.

export const Fragment = Symbol.for("leaf.fragment");

const ELEMENT = Symbol.for("leaf.element");

export function createElement(type, props, ...children) {
  const { key, ref, ...rest } = props ?? {};
  if (children.length === 1) rest.children = children[0];
  else if (children.length > 1) rest.children = children;
  return { $$typeof: ELEMENT, type, key: key ?? null, ref: ref ?? null, props: rest };
}

export function isValidElement(value) {
  return typeof value === "object" && value !== null && value.$$typeof === ELEMENT;
}

/** Nothing in leaf suspends, so a boundary renders its children. */
export function Suspense(props) {
  return props.children ?? null;
}

/**
 * Flattens children into a list of elements and strings. `null`, `undefined`, and booleans are
 * dropped, so `cond && <X />` renders nothing; numbers become text, `0` included.
 */
export function toChildArray(children, out = []) {
  if (children == null || typeof children === "boolean") return out;
  if (Array.isArray(children)) {
    for (const child of children) toChildArray(child, out);
  } else if (isValidElement(children) && children.type === Fragment) {
    toChildArray(children.props.children, out);
  } else if (isValidElement(children)) {
    out.push(children);
  } else if (typeof children === "string" || typeof children === "number") {
    out.push(String(children));
  } else if (typeof children === "bigint") {
    out.push(String(children));
  } else {
    throw new TypeError(
      `leaf can't render ${Object.prototype.toString.call(children)} as a child; render an element, a string, or a number.`,
    );
  }
  return out;
}

// The renderer that is running a component installs a dispatcher for the duration of the call.
let dispatcher = null;

export const internals = {
  render(component, props, nextDispatcher) {
    const previous = dispatcher;
    dispatcher = nextDispatcher;
    try {
      return component(props);
    } finally {
      dispatcher = previous;
    }
  },
};

function current(hook) {
  if (!dispatcher) {
    throw new Error(`leaf: ${hook}() can only be called while a component renders.`);
  }
  return dispatcher;
}

export function useState(initial) {
  return current("useState").useState(initial);
}

export function useReducer(reducer, initial) {
  const [state, setState] = current("useReducer").useState(initial);
  return [state, (action) => setState((previous) => reducer(previous, action))];
}

export function useEffect(effect, deps) {
  current("useEffect").useEffect(effect, deps);
}

export function useRef(initial) {
  return current("useRef").useRef(initial);
}

export function useMemo(compute, deps) {
  return current("useMemo").useMemo(compute, deps);
}

export function useCallback(callback, deps) {
  return current("useCallback").useMemo(() => callback, deps);
}

export function depsChanged(previous, next) {
  if (!previous || !next) return true;
  if (previous.length !== next.length) return true;
  return next.some((value, index) => !Object.is(value, previous[index]));
}
