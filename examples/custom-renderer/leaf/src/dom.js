// leaf/dom: mounts, patches, and hydrates an element tree in the browser.
//
// Children match by position: a child of the same type at the same index keeps its DOM node and
// its state, anything else is replaced. There are no keys and no scheduler. A state change
// re-renders its component in a microtask, and effects run after each commit.

import { depsChanged, internals, toChildArray } from "./index.js";
import { RESERVED, attributeName, cssName, eventName, isEventProp, styleValue } from "./props.js";

// ---------------------------------------------------------------------------------------------
// Instances: text, host (a DOM element), component, and root.

function domNodes(instance, out = []) {
  if (instance.kind === "text" || instance.kind === "host") out.push(instance.node);
  else for (const child of instance.children) domNodes(child, out);
  return out;
}

function hostParent(instance) {
  let parent = instance.parent;
  while (parent.kind === "component") parent = parent.parent;
  return parent;
}

/** Puts a host's child nodes in order, leaving nodes leaf doesn't own after them. */
function placeChildren(host) {
  const parent = host.node;
  let cursor = parent.firstChild;
  for (const child of host.children) {
    for (const node of domNodes(child)) {
      if (node === cursor) cursor = cursor.nextSibling;
      else parent.insertBefore(node, cursor);
    }
  }
}

function sameType(instance, vnode) {
  if (typeof vnode === "string") return instance.kind === "text";
  return instance.kind !== "text" && instance.type === vnode.type;
}

function elementType(vnode) {
  const { type } = vnode;
  if (typeof type === "function") return "component";
  if (typeof type === "string") return "host";
  throw new TypeError(`leaf can't render an element whose type is ${String(type)}.`);
}

// ---------------------------------------------------------------------------------------------
// Props.

function setRef(ref, value) {
  if (typeof ref === "function") ref(value);
  else if (ref && typeof ref === "object") ref.current = value;
}

function setStyle(node, next, previous) {
  if (typeof next === "string" || next == null) {
    node.style.cssText = next ?? "";
    return;
  }
  if (previous && typeof previous === "object") {
    for (const name of Object.keys(previous)) {
      if (!(name in next)) node.style.removeProperty(cssName(name));
    }
  } else if (typeof previous === "string") {
    node.style.cssText = "";
  }
  for (const [name, value] of Object.entries(next)) {
    const css = value == null || value === false ? "" : String(styleValue(name, value));
    if (name.startsWith("--")) node.style.setProperty(name, css);
    else node.style[name] = css;
  }
}

function setListener(node, name, handler) {
  const event = eventName(name, node.localName);
  const listeners = (node.__leafListeners ??= {});
  if (handler && !(event in listeners)) {
    node.addEventListener(event, (domEvent) => listeners[event]?.(domEvent));
  }
  listeners[event] = handler;
}

function setProp(node, name, next, previous, hydrating) {
  if (RESERVED.has(name)) return;
  if (isEventProp(name, next) || isEventProp(name, previous)) {
    setListener(node, name, typeof next === "function" ? next : undefined);
    return;
  }
  if (name === "style") {
    if (!hydrating) setStyle(node, next, previous);
    return;
  }
  if (name === "value" || name === "checked" || name === "selected") {
    // Live properties; what the user typed before hydration stays.
    if (!hydrating && node[name] !== next) node[name] = next ?? (name === "value" ? "" : false);
    return;
  }
  if (name === "defaultValue" || name === "defaultChecked") {
    if (previous === undefined && !hydrating) node[name] = next;
    return;
  }
  if (typeof next === "function") return;
  const attribute = attributeName(name);
  if (next == null || next === false) node.removeAttribute(attribute);
  else {
    const value = next === true ? "" : String(next);
    if (node.getAttribute(attribute) !== value) node.setAttribute(attribute, value);
  }
}

function patchProps(node, next, previous, hydrating = false) {
  for (const name of Object.keys(previous)) {
    if (!(name in next)) setProp(node, name, undefined, previous[name], hydrating);
  }
  for (const [name, value] of Object.entries(next)) {
    if (value !== previous[name]) setProp(node, name, value, previous[name], hydrating);
  }
  const html = next.dangerouslySetInnerHTML?.__html;
  if (html !== undefined && html !== previous.dangerouslySetInnerHTML?.__html && !hydrating) {
    node.innerHTML = html;
  }
}

// ---------------------------------------------------------------------------------------------
// Components and hooks.

let pendingEffects = [];
const dirty = new Set();
let flushQueued = false;

function createDispatcher(instance) {
  let index = 0;
  const slot = (create) => {
    const position = index++;
    if (position >= instance.hooks.length) instance.hooks.push(create());
    return instance.hooks[position];
  };
  return {
    useState(initial) {
      const hook = slot(() => {
        const created = { state: typeof initial === "function" ? initial() : initial };
        created.set = (action) => {
          const next = typeof action === "function" ? action(created.state) : action;
          if (Object.is(next, created.state)) return;
          created.state = next;
          schedule(instance);
        };
        return created;
      });
      return [hook.state, hook.set];
    },
    useEffect(effect, deps) {
      const hook = slot(() => ({ deps: undefined, cleanup: undefined }));
      if (hook.deps === undefined || depsChanged(hook.deps, deps)) {
        hook.deps = deps ?? null;
        pendingEffects.push({ hook, effect, instance });
      }
    },
    useRef(initial) {
      return slot(() => ({ current: initial }));
    },
    useMemo(compute, deps) {
      const hook = slot(() => ({ deps: undefined, value: undefined }));
      if (hook.deps === undefined || depsChanged(hook.deps, deps)) {
        hook.deps = deps ?? null;
        hook.value = compute();
      }
      return hook.value;
    },
  };
}

function renderComponent(instance) {
  const output = internals.render(instance.type, instance.props, createDispatcher(instance));
  if (output && typeof output.then === "function") {
    throw new Error(
      `leaf can't render async components in the browser: ${instance.type.name || "a component"} returned a promise. Async components render on the server, so use them in a page or layout that doesn't hydrate.`,
    );
  }
  return toChildArray(output);
}

function flushEffects() {
  const effects = pendingEffects;
  pendingEffects = [];
  for (const { hook, effect, instance } of effects) {
    if (!instance.mounted) continue;
    hook.cleanup?.();
    const cleanup = effect();
    hook.cleanup = typeof cleanup === "function" ? cleanup : undefined;
  }
}

function schedule(instance) {
  dirty.add(instance);
  if (flushQueued) return;
  flushQueued = true;
  queueMicrotask(flushUpdates);
}

function flushUpdates() {
  flushQueued = false;
  const queue = [...dirty].sort((left, right) => left.depth - right.depth);
  dirty.clear();
  for (const instance of queue) {
    if (!instance.mounted) continue;
    instance.children = reconcileChildren(instance, instance.children, renderComponent(instance));
    placeChildren(hostParent(instance));
  }
  flushEffects();
}

// ---------------------------------------------------------------------------------------------
// Mounting, patching, and unmounting.

function createInstance(vnode, parent) {
  const depth = parent.depth + 1;
  if (typeof vnode === "string") return { kind: "text", text: vnode, node: null, parent, depth };
  const kind = elementType(vnode);
  const instance = { kind, type: vnode.type, props: vnode.props, parent, depth, children: [] };
  if (kind === "host") {
    instance.ref = vnode.ref;
    instance.node = null;
  } else {
    instance.hooks = [];
  }
  instance.mounted = true;
  return instance;
}

function mount(vnode, parent) {
  const instance = createInstance(vnode, parent);
  if (instance.kind === "text") {
    instance.node = document.createTextNode(vnode);
  } else if (instance.kind === "host") {
    const node = document.createElement(vnode.type);
    instance.node = node;
    patchProps(node, vnode.props, {});
    if (vnode.props.dangerouslySetInnerHTML == null) {
      instance.children = toChildArray(vnode.props.children).map((child) => mount(child, instance));
      for (const child of instance.children) for (const dom of domNodes(child)) node.append(dom);
    }
    setRef(instance.ref, node);
  } else {
    instance.children = renderComponent(instance).map((child) => mount(child, instance));
  }
  return instance;
}

function update(instance, vnode) {
  if (instance.kind === "text") {
    if (instance.text !== vnode) instance.node.data = instance.text = vnode;
    return;
  }
  const previous = instance.props;
  instance.props = vnode.props;
  if (instance.kind === "component") {
    instance.children = reconcileChildren(instance, instance.children, renderComponent(instance));
    return;
  }
  patchProps(instance.node, vnode.props, previous);
  if (vnode.props.dangerouslySetInnerHTML == null) {
    if (previous.dangerouslySetInnerHTML != null) instance.node.textContent = "";
    const children = toChildArray(vnode.props.children);
    instance.children = reconcileChildren(instance, instance.children, children);
    placeChildren(instance);
  } else {
    for (const child of instance.children) unmount(child, false);
    instance.children = [];
  }
  if (instance.ref !== vnode.ref) {
    setRef(instance.ref, null);
    instance.ref = vnode.ref;
    setRef(instance.ref, instance.node);
  }
}

function reconcileChildren(parent, previous, vnodes) {
  const next = vnodes.map((vnode, index) => {
    const existing = previous[index];
    if (existing && sameType(existing, vnode)) {
      update(existing, vnode);
      return existing;
    }
    if (existing) unmount(existing, true);
    return mount(vnode, parent);
  });
  for (const extra of previous.slice(vnodes.length)) unmount(extra, true);
  return next;
}

function unmount(instance, removeNodes) {
  if (removeNodes) for (const node of domNodes(instance)) node.remove();
  instance.mounted = false;
  dirty.delete(instance);
  if (instance.kind === "text") return;
  for (const child of instance.children) unmount(child, false);
  if (instance.kind === "host") setRef(instance.ref, null);
  else for (const hook of instance.hooks) hook.cleanup?.();
}

// ---------------------------------------------------------------------------------------------
// Hydration: adopt the server's nodes instead of creating new ones.

function skipComments(cursor) {
  while (cursor.node && cursor.node.nodeType === Node.COMMENT_NODE)
    cursor.node = cursor.node.nextSibling;
}

function hydrate(vnode, parent, cursor, container) {
  skipComments(cursor);
  const existing = cursor.node;
  if (typeof vnode === "string") {
    // The server writes adjacent strings as one text node; split off this string's part.
    if (
      existing?.nodeType === Node.TEXT_NODE &&
      vnode.length > 0 &&
      existing.data.startsWith(vnode)
    ) {
      if (existing.data.length > vnode.length) existing.splitText(vnode.length);
      cursor.node = existing.nextSibling;
      const instance = createInstance(vnode, parent);
      instance.node = existing;
      return instance;
    }
    const instance = mount(vnode, parent);
    container.insertBefore(instance.node, existing);
    return instance;
  }
  if (elementType(vnode) === "component") {
    const instance = createInstance(vnode, parent);
    instance.children = renderComponent(instance).map((child) =>
      hydrate(child, instance, cursor, container),
    );
    return instance;
  }
  if (existing?.nodeType !== Node.ELEMENT_NODE || existing.localName !== vnode.type) {
    const instance = mount(vnode, parent);
    container.insertBefore(instance.node, existing);
    return instance;
  }
  const instance = createInstance(vnode, parent);
  instance.node = existing;
  cursor.node = existing.nextSibling;
  patchProps(existing, vnode.props, {}, true);
  if (vnode.props.dangerouslySetInnerHTML == null) {
    const inner = { node: existing.firstChild };
    instance.children = toChildArray(vnode.props.children).map((child) =>
      hydrate(child, instance, inner, existing),
    );
    // Whatever the server rendered past the client's children doesn't belong to the tree.
    for (let node = inner.node; node; ) {
      const next = node.nextSibling;
      if (node.nodeType !== Node.COMMENT_NODE) node.remove();
      node = next;
    }
  }
  setRef(instance.ref, existing);
  return instance;
}

// ---------------------------------------------------------------------------------------------
// Roots.

function createRootHandle(root) {
  return {
    render(element) {
      root.children = reconcileChildren(root, root.children, toChildArray(element));
      placeChildren(root);
      flushEffects();
    },
    unmount() {
      for (const child of root.children) unmount(child, true);
      root.children = [];
    },
  };
}

export function createRoot(container) {
  return createRootHandle({ kind: "root", node: container, children: [], depth: 0 });
}

export function hydrateRoot(container, element) {
  const root = { kind: "root", node: container, children: [], depth: 0 };
  const cursor = { node: container.firstChild };
  root.children = toChildArray(element).map((child) => hydrate(child, root, cursor, container));
  flushEffects();
  return createRootHandle(root);
}
