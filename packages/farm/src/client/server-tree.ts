import type React from "react";
import {
  getFarmClientReference as getClientReference,
  subscribeFarmServerTreeUpdates,
  type FarmServerTreeUpdateListener as TreeUpdateListener,
} from "./client-reference";

/**
 * A server page as a serialized React tree, the role React Server Components' Flight payload has.
 *
 * An async page below a hydrating layout cannot hydrate in the browser, so its client components
 * used to hydrate as isolated roots and could not read the layout's context. In server-tree mode
 * the server resolves the page into host elements and client-component references, renders that
 * resolved tree, and embeds it as JSON. The browser rebuilds the same tree inside the layout's
 * React root, so the client components hydrate as the layout's descendants.
 *
 * Anything the resolver cannot represent (a server component that calls hooks, a class component,
 * a client component with props that do not serialize, an unknown element type) renders as server
 * HTML in a `<farm-server-html>` wrapper whose own client components keep hydrating as islands.
 */

const MEMO_TYPE = Symbol.for("react.memo");
const FORWARD_REF_TYPE = Symbol.for("react.forward_ref");
const SERVER_HTML_TAG = "farm-server-html";
export const FARM_SERVER_TREE_ATTRIBUTE = "data-farm-server-tree";
const SERVER_TREE_CHUNK_ATTRIBUTE = "data-farm-server-tree-chunk";
const SERVER_HTML_ATTRIBUTE = "data-farm-server-html";

// The HTML parser moves or drops a custom element placed inside these, so a subtree that needs a
// `<farm-server-html>` wrapper there is wrapped at the nearest ancestor outside them instead.
const PARSER_SENSITIVE_TAGS = /* @__PURE__ */ new Set([
  "caption",
  "colgroup",
  "datalist",
  "head",
  "html",
  "iframe",
  "math",
  "noscript",
  "optgroup",
  "option",
  "script",
  "select",
  "style",
  "svg",
  "table",
  "tbody",
  "td",
  "template",
  "textarea",
  "tfoot",
  "th",
  "thead",
  "title",
  "tr",
]);

type TreeValue = null | boolean | number | string | TreeValue[] | { [key: string]: TreeValue };

/** Thrown where the resolver cannot represent a node; the node then renders as server HTML. */
class UnsupportedNode extends Error {}
/** An unsupported node inside a parser-sensitive element; its outermost such ancestor wraps. */
class UnsupportedInParserSensitiveElement extends Error {}

interface ResolvedChunk {
  status: "pending" | "fulfilled" | "rejected";
  value?: React.ReactNode;
  reason?: unknown;
  promise: Promise<React.ReactNode>;
}

interface TreeResolver {
  component(reference: string, exportName: string): React.ComponentType<any>;
  chunk(id: number): ResolvedChunk;
  serverHtml(id: number, key: React.Key | null, html?: string): React.ReactElement;
}

type ReactInternals = { H?: unknown; ReactCurrentDispatcher?: { current: unknown } };

function getHooksDispatcherSlot(ReactRuntime: typeof React) {
  const runtime = ReactRuntime as unknown as Record<string, ReactInternals | undefined>;
  const react19 = runtime.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
  if (react19 && "H" in react19) {
    return {
      get: () => react19.H,
      set: (value: unknown) => {
        react19.H = value;
      },
    };
  }
  const react18 =
    runtime.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED?.ReactCurrentDispatcher;
  if (react18) {
    return {
      get: () => react18.current,
      set: (value: unknown) => {
        react18.current = value;
      },
    };
  }
  return null;
}

// Server components run outside React here. Any hook call reports the component as unsupported
// instead of failing with React's "invalid hook call", and the component renders as server HTML,
// where React runs it with its real dispatcher.
const unsupportedHooksDispatcher = /* @__PURE__ */ new Proxy(
  {},
  {
    get(_target, name) {
      return () => {
        throw new UnsupportedNode(`calls ${String(name)}()`);
      };
    },
  },
);

function callServerComponent(
  ReactRuntime: typeof React,
  render: (props: unknown, ref?: unknown) => unknown,
  props: unknown,
  forwardRef: boolean,
): unknown {
  const slot = getHooksDispatcherSlot(ReactRuntime);
  const previous = slot?.get();
  slot?.set(unsupportedHooksDispatcher);
  try {
    return forwardRef ? render(props, null) : render(props);
  } finally {
    slot?.set(previous);
  }
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    value !== null &&
    (typeof value === "object" || typeof value === "function") &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

interface ResolveContext {
  parserSensitive: boolean;
  /** Inside a client component's props other than children, which it may never render. */
  clientProp?: boolean;
}

interface ResolveState {
  ReactRuntime: typeof React;
  renderHtml?: (node: React.ReactNode) => string;
  nextId: number;
  components: Map<string, React.ComponentType<any>>;
  serverHtml: Map<number, React.ReactNode>;
  chunks: Map<number, { encoded: Promise<TreeValue>; chunk?: ResolvedChunk }>;
}

function serverHtmlNode(
  state: ResolveState,
  node: React.ReactNode,
  key: React.Key | null,
  context: ResolveContext,
): TreeValue {
  if (context.parserSensitive) throw new UnsupportedInParserSensitiveElement();
  const id = state.nextId++;
  state.serverHtml.set(id, node);
  const value: { [key: string]: TreeValue } = { $: "x", i: id };
  if (key !== null) value.k = String(key);
  // A client component may hold such a node without rendering it (an icon in a data prop), so its
  // HTML is not in the document; the payload carries it for the browser.
  if (context.clientProp && state.renderHtml) {
    try {
      value.h = state.renderHtml(node);
    } catch {
      // Async or suspending content renders only in the stream; the document has to carry it.
    }
  }
  return value;
}

async function resolveProps(
  state: ResolveState,
  props: Record<string, unknown>,
  context: ResolveContext,
  host: boolean,
): Promise<{ [key: string]: TreeValue }> {
  const entries = await Promise.all(
    Object.entries(props).map(async ([name, value]): Promise<[string, TreeValue] | null> => {
      if (value === undefined) return null;
      if (name === "ref") {
        if (value === null) return null;
        throw new UnsupportedNode("receives a ref");
      }
      if (host && typeof value === "function") {
        throw new UnsupportedNode(`passes a function to <${String(name)}>`);
      }
      return [name, await resolveValue(state, value, context, new Set())];
    }),
  );
  return Object.fromEntries(entries.filter((entry) => entry !== null));
}

async function resolveValue(
  state: ResolveState,
  value: unknown,
  context: ResolveContext,
  seen: Set<object>,
): Promise<TreeValue> {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : { $: "n", v: String(value) };
  }
  if (typeof value !== "object") throw new UnsupportedNode(`passes a ${typeof value} value`);
  if (state.ReactRuntime.isValidElement(value)) {
    return resolveElement(state, value as React.ReactElement<Record<string, unknown>>, context);
  }
  if (isThenable(value)) {
    try {
      return { $: "P", v: await resolveValue(state, await value, context, seen) };
    } catch (error) {
      if (error instanceof UnsupportedInParserSensitiveElement) throw error;
      throw new UnsupportedNode("passes a promise that does not resolve to a serializable value");
    }
  }
  if (seen.has(value)) throw new UnsupportedNode("passes a circular value");
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return await Promise.all(value.map((entry) => resolveValue(state, entry, context, seen)));
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new UnsupportedNode("passes a class instance");
    }
    const entries = await Promise.all(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .map(
          async ([name, entry]): Promise<[string, TreeValue]> => [
            name,
            await resolveValue(state, entry, context, seen),
          ],
        ),
    );
    const object = Object.fromEntries(entries);
    return Object.prototype.hasOwnProperty.call(object, "$") ? { $: "o", v: object } : object;
  } finally {
    seen.delete(value);
  }
}

async function resolveElement(
  state: ResolveState,
  element: React.ReactElement<Record<string, unknown>>,
  context: ResolveContext,
): Promise<TreeValue> {
  const { ReactRuntime } = state;
  const key = element.key === null || element.key === undefined ? null : String(element.key);
  const withKey = <T extends { [key: string]: TreeValue }>(node: T): T =>
    key === null ? node : { ...node, k: key };
  let type: unknown = element.type;
  const props = element.props ?? {};

  try {
    if (typeof type === "string") {
      const parserSensitive = context.parserSensitive || PARSER_SENSITIVE_TAGS.has(type);
      try {
        const { children, ...rest } = props;
        const resolved = await resolveProps(state, rest, context, true);
        if (children !== undefined) {
          resolved.children = await resolveValue(
            state,
            children,
            { parserSensitive, clientProp: context.clientProp },
            new Set(),
          );
        }
        return withKey({ $: "h", t: type, p: resolved });
      } catch (error) {
        if (error instanceof UnsupportedInParserSensitiveElement && !context.parserSensitive) {
          return serverHtmlNode(state, element, key, context);
        }
        throw error;
      }
    }

    if (type === ReactRuntime.Fragment || type === ReactRuntime.StrictMode) {
      return withKey({
        $: "f",
        c: await resolveValue(state, props.children, context, new Set()),
      });
    }

    if (type === ReactRuntime.Suspense) {
      const id = state.nextId++;
      const fallback = await resolveValue(state, props.fallback, context, new Set());
      const encoded = resolveValue(state, props.children, context, new Set()).catch((error) => {
        if (error instanceof UnsupportedNode) {
          return serverHtmlNode(
            state,
            ReactRuntime.createElement(
              ReactRuntime.Fragment,
              null,
              props.children as React.ReactNode,
            ),
            null,
            { parserSensitive: false },
          );
        }
        throw error;
      });
      // Rendering reads the result; a rejection must not be reported before React sees it.
      encoded.catch(() => {});
      state.chunks.set(id, { encoded });
      return withKey({ $: "s", f: fallback, i: id });
    }

    const clientReference = getClientReference(type);
    if (clientReference) {
      const { children, ...rest } = props;
      const resolved = await resolveProps(state, rest, { ...context, clientProp: true }, false);
      if (children !== undefined) {
        resolved.children = await resolveValue(state, children, context, new Set());
      }
      state.components.set(
        `${clientReference.reference}#${clientReference.exportName}`,
        clientReference.Component,
      );
      return withKey({
        $: "c",
        r: clientReference.reference,
        e: clientReference.exportName,
        p: resolved,
      });
    }

    let forwardRef = false;
    while (type && typeof type === "object") {
      const typeOf = (type as { $$typeof?: symbol }).$$typeof;
      if (typeOf === MEMO_TYPE) {
        type = (type as { type: unknown }).type;
        if (getClientReference(type)) {
          return resolveElement(
            state,
            ReactRuntime.createElement(type as React.ComponentType<any>, {
              ...props,
              key: element.key,
            }) as React.ReactElement<Record<string, unknown>>,
            context,
          );
        }
        continue;
      }
      if (typeOf === FORWARD_REF_TYPE) {
        type = (type as { render: unknown }).render;
        forwardRef = true;
        break;
      }
      throw new UnsupportedNode("is not a function component");
    }

    if (typeof type !== "function") throw new UnsupportedNode("is not a function component");
    if ((type as { prototype?: { isReactComponent?: unknown } }).prototype?.isReactComponent) {
      throw new UnsupportedNode("is a class component");
    }
    let rendered = callServerComponent(
      ReactRuntime,
      type as (props: unknown, ref?: unknown) => unknown,
      props,
      forwardRef,
    );
    if (isThenable(rendered)) rendered = await rendered;
    const resolved = await resolveValue(state, rendered, context, new Set());
    return key === null ? resolved : { $: "f", k: key, c: resolved };
  } catch (error) {
    if (error instanceof UnsupportedNode) return serverHtmlNode(state, element, key, context);
    throw error;
  }
}

function serializeTreePayload(value: unknown): string {
  return JSON.stringify(value)
    .replace(/&/g, "\\u0026")
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

const chunkComponents = /* @__PURE__ */ new WeakMap<
  object,
  React.ComponentType<{ chunk: ResolvedChunk }>
>();

function getChunkComponent(ReactRuntime: typeof React) {
  const existing = chunkComponents.get(ReactRuntime.createElement);
  if (existing) return existing;
  function FarmServerTreeChunk({ chunk }: { chunk: ResolvedChunk }): React.ReactNode {
    if (chunk.status === "fulfilled") return chunk.value;
    if (chunk.status === "rejected") throw chunk.reason;
    const use = (ReactRuntime as { use?: (promise: Promise<React.ReactNode>) => React.ReactNode })
      .use;
    if (typeof use === "function") return use(chunk.promise);
    // React 18 suspends on a thrown thenable.
    throw chunk.promise;
  }
  chunkComponents.set(ReactRuntime.createElement, FarmServerTreeChunk);
  return FarmServerTreeChunk;
}

function fulfilledThenable(value: unknown): Promise<unknown> {
  const promise = Promise.resolve(value) as Promise<unknown> & { status?: string; value?: unknown };
  // `use()` returns a settled thenable's value synchronously, so hydration does not suspend.
  promise.status = "fulfilled";
  promise.value = value;
  return promise;
}

function createTreeChildren(
  ReactRuntime: typeof React,
  children: TreeValue | undefined,
  resolver: TreeResolver,
): React.ReactNode[] {
  if (children === undefined) return [];
  const node = createTreeValue(ReactRuntime, children, resolver);
  // Spread a static child list the way JSX does, so React does not ask for keys.
  return Array.isArray(children) ? (node as React.ReactNode[]) : [node as React.ReactNode];
}

function createTreeProps(
  ReactRuntime: typeof React,
  props: { [key: string]: TreeValue },
  resolver: TreeResolver,
  key: TreeValue | undefined,
): { props: Record<string, unknown>; children: React.ReactNode[] } {
  const { children, ...rest } = props;
  const created: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(rest)) {
    created[name] = createTreeValue(ReactRuntime, value, resolver);
  }
  if (typeof key === "string") created.key = key;
  return { props: created, children: createTreeChildren(ReactRuntime, children, resolver) };
}

function createTreeValue(
  ReactRuntime: typeof React,
  value: TreeValue,
  resolver: TreeResolver,
): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value))
    return value.map((entry) => createTreeValue(ReactRuntime, entry, resolver));
  switch (value.$) {
    case "h": {
      const { props, children } = createTreeProps(
        ReactRuntime,
        value.p as { [key: string]: TreeValue },
        resolver,
        value.k,
      );
      return ReactRuntime.createElement(value.t as string, props, ...children);
    }
    case "c": {
      const { props, children } = createTreeProps(
        ReactRuntime,
        value.p as { [key: string]: TreeValue },
        resolver,
        value.k,
      );
      return ReactRuntime.createElement(
        resolver.component(value.r as string, value.e as string),
        props,
        ...children,
      );
    }
    case "f":
      return ReactRuntime.createElement(
        ReactRuntime.Fragment,
        typeof value.k === "string" ? { key: value.k } : null,
        ...createTreeChildren(ReactRuntime, value.c, resolver),
      );
    case "s":
      return ReactRuntime.createElement(
        ReactRuntime.Suspense,
        {
          ...(typeof value.k === "string" ? { key: value.k } : {}),
          fallback: createTreeValue(
            ReactRuntime,
            value.f as TreeValue,
            resolver,
          ) as React.ReactNode,
        },
        ReactRuntime.createElement(getChunkComponent(ReactRuntime), {
          chunk: resolver.chunk(value.i as number),
        }),
      );
    case "x":
      return resolver.serverHtml(
        value.i as number,
        typeof value.k === "string" ? value.k : null,
        typeof value.h === "string" ? value.h : undefined,
      );
    case "n":
      return Number(value.v);
    case "P":
      return fulfilledThenable(createTreeValue(ReactRuntime, value.v as TreeValue, resolver));
    case "o": {
      const object = value.v as { [key: string]: TreeValue };
      return Object.fromEntries(
        Object.entries(object).map(([name, entry]) => [
          name,
          createTreeValue(ReactRuntime, entry, resolver),
        ]),
      );
    }
    default:
      return Object.fromEntries(
        Object.entries(value).map(([name, entry]) => [
          name,
          createTreeValue(ReactRuntime, entry, resolver),
        ]),
      );
  }
}

function createTreeScript(
  ReactRuntime: typeof React,
  attribute: string,
  value: string,
  json: string,
): React.ReactElement {
  return ReactRuntime.createElement("script", {
    type: "application/json",
    [attribute]: value,
    dangerouslySetInnerHTML: { __html: json },
  });
}

function createTreePage(
  ReactRuntime: typeof React,
  tree: TreeValue,
  json: string,
  resolver: TreeResolver,
  key?: string,
): React.ReactElement {
  return ReactRuntime.createElement(
    ReactRuntime.Fragment,
    key === undefined ? null : { key },
    createTreeValue(ReactRuntime, tree, resolver) as React.ReactNode,
    createTreeScript(ReactRuntime, FARM_SERVER_TREE_ATTRIBUTE, "", json),
  );
}

export interface FarmServerTreeRenderOptions {
  /** Renders a subtree the resolver could not represent with its client components as islands. */
  isolate(element: React.ReactNode): React.ReactNode;
  /** Renders a node to static HTML, for nodes a client component holds in its props. */
  renderHtml?(node: React.ReactNode): string;
}

/**
 * @internal Resolves a server page and returns the page boundary's children: the resolved tree
 * and its payload. Errors from the page's own code, including redirect and notFound controls,
 * propagate unchanged. Suspense children resolve concurrently and stream as React renders them.
 */
export async function renderFarmServerTreePage(
  ReactRuntime: typeof React,
  element: React.ReactNode,
  options: FarmServerTreeRenderOptions,
): Promise<React.ReactElement> {
  const state: ResolveState = {
    ReactRuntime,
    renderHtml: options.renderHtml,
    nextId: 0,
    components: new Map(),
    serverHtml: new Map(),
    chunks: new Map(),
  };
  const tree = await resolveValue(state, element, { parserSensitive: false }, new Set());
  const resolver: TreeResolver = {
    component(reference, exportName) {
      const Component = state.components.get(`${reference}#${exportName}`);
      if (!Component)
        throw new Error(`client reference ${reference}#${exportName} was not resolved`);
      return Component;
    },
    chunk(id) {
      const entry = state.chunks.get(id)!;
      if (entry.chunk) return entry.chunk;
      const chunk: ResolvedChunk = {
        status: "pending",
        promise: entry.encoded.then(
          (encoded) => {
            chunk.value = ReactRuntime.createElement(
              ReactRuntime.Fragment,
              null,
              createTreeValue(ReactRuntime, encoded, resolver) as React.ReactNode,
              createTreeScript(
                ReactRuntime,
                SERVER_TREE_CHUNK_ATTRIBUTE,
                String(id),
                serializeTreePayload({ t: encoded }),
              ),
            );
            chunk.status = "fulfilled";
            return chunk.value;
          },
          (error) => {
            chunk.status = "rejected";
            chunk.reason = error;
            throw error;
          },
        ),
      };
      chunk.promise.catch(() => {});
      entry.chunk = chunk;
      return chunk;
    },
    serverHtml(id, key) {
      return ReactRuntime.createElement(
        SERVER_HTML_TAG,
        {
          ...(key === null ? {} : { key }),
          [SERVER_HTML_ATTRIBUTE]: String(id),
          style: { display: "contents" },
        },
        options.isolate(state.serverHtml.get(id) as React.ReactNode),
      );
    },
  };
  const page = createTreePage(
    ReactRuntime,
    tree,
    serializeTreePayload({ v: 1, t: tree }),
    resolver,
  );
  // The browser renders the page through FarmServerTreePage; the server renders the same layer.
  return ReactRuntime.createElement(function FarmServerTreePage() {
    return page;
  });
}

function collectReferences(value: TreeValue, references: Set<string>): void {
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const entry of value) collectReferences(entry, references);
    return;
  }
  if (value.$ === "c") references.add(`${value.r as string}#${value.e as string}`);
  for (const entry of Object.values(value)) collectReferences(entry, references);
}

interface ServerTreeView {
  build(): React.ReactElement;
  components: Map<string, React.ComponentType<any>>;
}

const treeHosts = /* @__PURE__ */ new WeakMap<
  object,
  React.ComponentType<{ view: ServerTreeView }>
>();

// One component type per React runtime, so a rebuilt tree with the same key (a server layout
// across navigations) updates in place and its client components keep their state.
function getTreeHost(ReactRuntime: typeof React): React.ComponentType<{ view: ServerTreeView }> {
  const existing = treeHosts.get(ReactRuntime.createElement);
  if (existing) return existing;
  function FarmServerTreePage({ view }: { view: ServerTreeView }): React.ReactNode {
    const [, setVersion] = ReactRuntime.useState(0);
    const viewRef = ReactRuntime.useRef(view);
    viewRef.current = view;
    ReactRuntime.useEffect(() => {
      const listener: TreeUpdateListener = (reference, module) => {
        const { components } = viewRef.current;
        let changed = false;
        for (const key of components.keys()) {
          const separator = key.lastIndexOf("#");
          if (key.slice(0, separator) !== reference) continue;
          components.set(key, originalExport(module, key.slice(separator + 1)));
          changed = true;
        }
        if (changed) setVersion((version) => version + 1);
        return changed;
      };
      return subscribeFarmServerTreeUpdates(listener);
    }, []);
    return view.build();
  }
  treeHosts.set(ReactRuntime.createElement, FarmServerTreePage);
  return FarmServerTreePage;
}

export interface FarmServerTreeElementOptions {
  load(reference: string): Promise<Record<string, unknown>>;
  /** Renders a `<farm-server-html>` subtree from its server HTML and hydrates its islands. */
  ServerHtml: React.ComponentType<any>;
  /**
   * The tree's identity. A page passes its path, so a navigation remounts its client components;
   * a server layout passes its pattern, so they keep their state across the pages below it.
   */
  key?: string;
}

function parseHtml(html: string): DocumentFragment {
  const template = document.createElement("template");
  template.innerHTML = html;
  return template.content;
}

function originalExport(module: Record<string, unknown>, exportName: string) {
  // A compiled boundary exposes its unwrapped exports; a built-in client component (Link) is the
  // module's own export.
  const originals = module.__farm_client_boundary_originals__ as
    | Record<string, unknown>
    | undefined;
  const Component = originals ? originals[exportName] : module[exportName];
  if (typeof Component !== "function" && typeof Component !== "object") {
    throw new Error(`compiled original export ${exportName} was not found`);
  }
  return Component as React.ComponentType<any>;
}

/**
 * @internal Rebuilds a server-tree page in the browser from its server HTML, an element or the
 * HTML of a navigation, after loading its client modules. Returns null for a page without a tree.
 */
export async function createFarmServerTreeElement(
  ReactRuntime: typeof React,
  source: ParentNode | string,
  options: FarmServerTreeElementOptions,
): Promise<React.ReactElement | null> {
  const root = typeof source === "string" ? parseHtml(source) : source;
  const script = root.querySelector<HTMLScriptElement>(`script[${FARM_SERVER_TREE_ATTRIBUTE}]`);
  if (!script) return null;
  const json = script.textContent ?? "";
  const payload = JSON.parse(json) as { v?: number; t: TreeValue };
  if (payload.v !== 1) throw new Error("unsupported server tree payload version");

  const chunks = new Map<number, { tree: TreeValue; json: string }>();
  for (const chunkScript of root.querySelectorAll<HTMLScriptElement>(
    `script[${SERVER_TREE_CHUNK_ATTRIBUTE}]`,
  )) {
    const chunkJson = chunkScript.textContent ?? "";
    chunks.set(Number(chunkScript.getAttribute(SERVER_TREE_CHUNK_ATTRIBUTE)), {
      tree: (JSON.parse(chunkJson) as { t: TreeValue }).t,
      json: chunkJson,
    });
  }

  const references = new Set<string>();
  collectReferences(payload.t, references);
  for (const chunk of chunks.values()) collectReferences(chunk.tree, references);
  const components = new Map<string, React.ComponentType<any>>();
  await Promise.all(
    Array.from(references, async (key) => {
      const separator = key.lastIndexOf("#");
      const reference = key.slice(0, separator);
      components.set(key, originalExport(await options.load(reference), key.slice(separator + 1)));
    }),
  );

  const serverHtml = new Map<number, string>();
  for (const container of root.querySelectorAll(`${SERVER_HTML_TAG}[${SERVER_HTML_ATTRIBUTE}]`)) {
    serverHtml.set(Number(container.getAttribute(SERVER_HTML_ATTRIBUTE)), container.innerHTML);
  }

  const resolver: TreeResolver = {
    component(reference, exportName) {
      const Component = components.get(`${reference}#${exportName}`);
      if (!Component) throw new Error(`client reference ${reference}#${exportName} was not loaded`);
      return Component;
    },
    chunk(id) {
      const chunk = chunks.get(id);
      if (!chunk) throw new Error(`server tree chunk ${id} was not found`);
      const value = ReactRuntime.createElement(
        ReactRuntime.Fragment,
        null,
        createTreeValue(ReactRuntime, chunk.tree, resolver) as React.ReactNode,
        createTreeScript(ReactRuntime, SERVER_TREE_CHUNK_ATTRIBUTE, String(id), chunk.json),
      );
      return { status: "fulfilled", value, promise: Promise.resolve(value) };
    },
    serverHtml(id, key, embedded) {
      const html = serverHtml.get(id) ?? embedded;
      if (html === undefined) throw new Error(`server HTML ${id} was not found`);
      return ReactRuntime.createElement(options.ServerHtml, {
        ...(key === null ? {} : { key }),
        as: SERVER_HTML_TAG,
        [SERVER_HTML_ATTRIBUTE]: String(id),
        style: { display: "contents" },
        suppressHydrationWarning: true,
        dangerouslySetInnerHTML: { __html: html },
      });
    },
  };

  // Validate the whole tree now, so a missing chunk or module falls back before hydration starts.
  const build = () => createTreePage(ReactRuntime, payload.t, json, resolver);
  build();

  return ReactRuntime.createElement(getTreeHost(ReactRuntime), {
    ...(options.key === undefined ? {} : { key: options.key }),
    view: { build, components },
  });
}
