import type React from "react";
import { getFarmActionId } from "./action-reference";
import {
  FARM_REFERENCE_TAG,
  FARM_TAG,
  FARM_VALUE_SCRIPT_TYPE,
  getFarmIslandValuesServer,
  type FarmIslandValueStore,
} from "./island-value-protocol";
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
/** The element around server HTML a tree cannot represent; its `name` is the HTML's id. */
const SERVER_HTML_TAG = "f-html";
/** The script type of a page's tree. */
export const FARM_SERVER_TREE_SCRIPT_TYPE = "f/tree";
// `NOT_A_FARM_MARKER` in island-codec.ts, without importing the codec into every bundle.
const FARM_NOT_A_MARKER = Symbol.for("farm.codec.not-a-marker");
/** The script type of a chunk a Suspense boundary streamed later; its `name` is the chunk id. */
const SERVER_TREE_CHUNK_SCRIPT_TYPE = "f/chunk";
/**
 * Marks a navigation response that carries only the page's payload. The browser rebuilds such a
 * page in its layout's React root and never shows its HTML, so the server leaves the HTML out.
 */
export const FARM_SERVER_TREE_PAYLOAD_ONLY_ATTRIBUTE = "partial";
const SERVER_HTML_ATTRIBUTE = "name";

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
  serverHtml(id: number, key: React.Key | null): React.ReactElement;
  /** The function a server action reference stands for (islands mode). */
  action(id: string): unknown;
  /** Islands mode: decodes a value JSON cannot hold, or returns `NOT_A_FARM_MARKER`. */
  decode?(object: Record<string, unknown>, decodeChild: (value: TreeValue) => unknown): unknown;
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
}

interface ResolveState {
  ReactRuntime: typeof React;
  nextId: number;
  components: Map<string, React.ComponentType<any>>;
  serverHtml: Map<number, React.ReactNode>;
  chunks: Map<number, { encoded: Promise<TreeValue>; chunk?: ResolvedChunk }>;
  actions: Map<string, unknown>;
  /** Islands mode: the server's codec for values JSON cannot hold. */
  codec?: { encodeLeaf(value: unknown): Record<string, unknown> | undefined };
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
  return key === null ? { $: "x", i: id } : { $: "x", i: id, k: String(key) };
}

async function resolveProps(
  state: ResolveState,
  props: Record<string, unknown>,
  context: ResolveContext,
  host: boolean,
): Promise<{ [key: string]: TreeValue }> {
  const entries = await Promise.all(
    Object.entries(props).map(async ([name, value]): Promise<[string, TreeValue] | null> => {
      // A client component's undefined prop keeps its key in islands mode, as in RSC.
      if (value === undefined && (host || !state.codec)) return null;
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
  // Islands mode: the server's codec marks values JSON cannot hold (Date, Map, BigInt, …).
  const codec = state.codec;
  const leaf = codec?.encodeLeaf(value);
  if (leaf) return leaf as TreeValue;
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : { $: "n", v: String(value) };
  }
  if (typeof value === "function") {
    // A server action passes as a reference the browser can call (islands mode).
    const actionId = getFarmActionId(value);
    if (actionId) {
      state.actions.set(actionId, value);
      return { $: "a", v: actionId };
    }
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
    if (codec && value instanceof Map) {
      return { $: "M", v: await resolveValue(state, Array.from(value), context, seen) };
    }
    if (codec && value instanceof Set) {
      return { $: "S", v: await resolveValue(state, Array.from(value), context, seen) };
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new UnsupportedNode("passes a class instance");
    }
    const entries = await Promise.all(
      Object.entries(value)
        // Islands mode keeps a key whose value is undefined, as `{"$":"u"}`.
        .filter(([, entry]) => entry !== undefined || codec)
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
          resolved.children = await resolveValue(state, children, { parserSensitive }, new Set());
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
      return withKey({ $: "p", f: fallback, i: id });
    }

    const clientReference = getClientReference(type);
    if (clientReference) {
      const { children, ...rest } = props;
      const resolved = await resolveProps(state, rest, context, false);
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
  return escapeTreeJson(JSON.stringify(value));
}

function escapeTreeJson(json: string): string {
  return json
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
    case "p":
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
      return resolver.serverHtml(value.i as number, typeof value.k === "string" ? value.k : null);
    case "n":
      return Number(value.v);
    case "a":
      return resolver.action(value.v as string);
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
    default: {
      if (value.$ !== undefined) {
        // A value JSON cannot hold (islands mode): Date, Map, BigInt, …
        if (!resolver.decode) throw new Error("typed props need islands mode");
        const decoded = resolver.decode(value as Record<string, unknown>, (child) =>
          createTreeValue(ReactRuntime, child, resolver),
        );
        if (decoded !== FARM_NOT_A_MARKER) return decoded;
      }
      return Object.fromEntries(
        Object.entries(value).map(([name, entry]) => [
          name,
          createTreeValue(ReactRuntime, entry, resolver),
        ]),
      );
    }
  }
}

/** A payload's JSON and the island values it sends with it (islands mode), as [key, json]. */
type TreeValueScripts = ReadonlyArray<readonly [key: string, json: string]>;

function createTreeScript(
  ReactRuntime: typeof React,
  type: string,
  name: string,
  json: string,
  values: TreeValueScripts = [],
  attributes: Record<string, string> = {},
): React.ReactElement {
  const script = ReactRuntime.createElement("script", {
    type,
    ...(name ? { name } : {}),
    ...attributes,
    dangerouslySetInnerHTML: { __html: json },
  });
  if (values.length === 0) return script;
  // The values right before the payload: the browser re-renders exactly these, so hydration sees
  // the markup the server sent.
  return ReactRuntime.createElement(
    ReactRuntime.Fragment,
    null,
    ...values.map(([valueKey, valueJson]) =>
      ReactRuntime.createElement("script", {
        key: valueKey,
        type: FARM_VALUE_SCRIPT_TYPE,
        name: valueKey,
        dangerouslySetInnerHTML: { __html: valueJson },
      }),
    ),
    script,
  );
}

function createTreePage(
  ReactRuntime: typeof React,
  tree: TreeValue,
  json: string,
  resolver: TreeResolver,
  key?: string,
  values: TreeValueScripts = [],
): React.ReactElement {
  return ReactRuntime.createElement(
    ReactRuntime.Fragment,
    key === undefined ? null : { key },
    createTreeValue(ReactRuntime, tree, resolver) as React.ReactNode,
    createTreeScript(ReactRuntime, FARM_SERVER_TREE_SCRIPT_TYPE, "", json, values),
  );
}

/** The value scripts the server sent right before a payload script. */
function readTreeValueScripts(script: Element): TreeValueScripts {
  const values: Array<readonly [string, string]> = [];
  for (
    let node = script.previousElementSibling;
    node?.tagName === "SCRIPT" && node.getAttribute("type") === FARM_VALUE_SCRIPT_TYPE;
    node = node.previousElementSibling
  ) {
    values.unshift([node.getAttribute("name") ?? "", node.textContent ?? ""]);
  }
  return values;
}

/**
 * The page as a navigation the browser renders itself receives it: its payload, every chunk's
 * payload, and the server HTML parts, with none of the HTML the payload rebuilds. Waits for every
 * chunk, since a navigation reads the whole response anyway. Returns null when a chunk failed,
 * so the page renders as usual and its error boundaries apply.
 */
async function createPayloadOnlyPage(
  state: ResolveState,
  payload: { json: string; values: TreeValueScripts },
  encode: (payload: Record<string, unknown>) => { json: string; values: TreeValueScripts },
  resolver: TreeResolver,
): Promise<React.ReactElement | null> {
  const { ReactRuntime } = state;
  const chunks = new Map<number, TreeValue>();
  // A chunk can contain further chunks; settle until none are pending.
  for (let pending = [...state.chunks.keys()]; pending.length > 0; ) {
    const settled = await Promise.allSettled(
      pending.map(async (id) => [id, await state.chunks.get(id)!.encoded] as const),
    );
    for (const result of settled) {
      if (result.status === "rejected") return null;
      chunks.set(result.value[0], result.value[1]);
    }
    pending = [...state.chunks.keys()].filter((id) => !chunks.has(id));
  }
  return ReactRuntime.createElement(
    ReactRuntime.Fragment,
    null,
    ...Array.from(state.serverHtml.keys(), (id) => resolver.serverHtml(id, `h${id}`)),
    ReactRuntime.createElement(
      ReactRuntime.Fragment,
      { key: "payload" },
      createTreeScript(
        ReactRuntime,
        FARM_SERVER_TREE_SCRIPT_TYPE,
        "",
        payload.json,
        payload.values,
        {
          [FARM_SERVER_TREE_PAYLOAD_ONLY_ATTRIBUTE]: "",
        },
      ),
    ),
    ...Array.from(chunks, ([id, encoded]) => {
      const chunk = encode({ t: encoded });
      return ReactRuntime.createElement(
        ReactRuntime.Fragment,
        { key: `c${id}` },
        createTreeScript(
          ReactRuntime,
          SERVER_TREE_CHUNK_SCRIPT_TYPE,
          String(id),
          chunk.json,
          chunk.values,
        ),
      );
    }),
  );
}

export interface FarmServerTreeRenderOptions {
  /** Renders a subtree the resolver could not represent with its client components as islands. */
  isolate(element: React.ReactNode): React.ReactNode;
  /**
   * Islands mode: large values in the payload travel once, keyed by content, and a navigation
   * leaves out the ones the browser holds.
   */
  values?: boolean;
  /**
   * A navigation the browser renders in its layout's React root: send the payload, the chunks it
   * streams and the server HTML parts it cannot represent, without the page's rendered HTML.
   */
  payloadOnly?: boolean;
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
    nextId: 0,
    components: new Map(),
    serverHtml: new Map(),
    chunks: new Map(),
    actions: new Map(),
    codec: options.values ? getFarmIslandValuesServer() : undefined,
  };
  const tree = await resolveValue(state, element, { parserSensitive: false }, new Set());
  const values = options.values ? getFarmIslandValuesServer() : undefined;
  const held = values ? values.held() : null;
  const encode = (payload: Record<string, unknown>): { json: string; values: TreeValueScripts } => {
    if (!values) return { json: serializeTreePayload(payload), values: [] };
    const addressed = values.address(payload);
    return {
      json: escapeTreeJson(addressed.json),
      values: values
        .select(addressed, held)
        .map((value) => [value.key, escapeTreeJson(value.json)] as const),
    };
  };
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
              (() => {
                const payload = encode({ t: encoded });
                return createTreeScript(
                  ReactRuntime,
                  SERVER_TREE_CHUNK_SCRIPT_TYPE,
                  String(id),
                  payload.json,
                  payload.values,
                );
              })(),
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
    action(id) {
      return state.actions.get(id);
    },
    decode: state.codec
      ? (object, decodeChild) =>
          getFarmIslandValuesServer()!.decode(object, decodeChild as (value: unknown) => unknown)
      : undefined,
  };
  const payload = encode({ v: 1, t: tree });
  const page =
    (options.payloadOnly && (await createPayloadOnlyPage(state, payload, encode, resolver))) ||
    createTreePage(ReactRuntime, tree, payload.json, resolver, undefined, payload.values);
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

export interface FarmServerTreeElementOptions {
  load(reference: string): Promise<Record<string, unknown>>;
  /** Renders a `<farm-server-html>` subtree from its server HTML and hydrates its islands. */
  ServerHtml: React.ComponentType<any>;
  /** Remounts the page's client components when it changes, as a navigation does. */
  key?: string;
  /** Islands mode's value store, for payloads that reference island values. */
  values?: Pick<FarmIslandValueStore, "ingest" | "resolve">;
  /** Islands mode: the function a server action reference stands for. */
  actions?(id: string): (...args: unknown[]) => unknown;
  /** Islands mode: decodes props JSON cannot hold (`decodeFarmTagged` in island-codec.ts). */
  decode?(object: Record<string, unknown>, decodeChild: (value: unknown) => unknown): unknown;
}

function parseHtml(html: string): DocumentFragment {
  const template = document.createElement("template");
  template.innerHTML = html;
  return template.content;
}

function originalExport(module: Record<string, unknown>, exportName: string) {
  const Component = (
    module.__farm_client_boundary_originals__ as Record<string, unknown> | undefined
  )?.[exportName];
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
  const script = root.querySelector<HTMLScriptElement>(
    `script[type="${FARM_SERVER_TREE_SCRIPT_TYPE}"]`,
  );
  if (!script) return null;
  const json = script.textContent ?? "";
  // A payload that names island values reads them from the page (or this navigation's HTML) and
  // from the values the browser already holds.
  let ingested = false;
  const parsePayload = (text: string): unknown => {
    const parsed = JSON.parse(text);
    if (!text.includes(`"${FARM_TAG}":"${FARM_REFERENCE_TAG}"`)) return parsed;
    if (!options.values) throw new Error("island values need islands mode");
    if (!ingested) {
      options.values.ingest(root);
      ingested = true;
    }
    return options.values.resolve(parsed);
  };
  const payload = parsePayload(json) as { v?: number; t: TreeValue };
  if (payload.v !== 1) throw new Error("unsupported server tree payload version");
  const values = readTreeValueScripts(script);

  const chunks = new Map<number, { tree: TreeValue; json: string; values: TreeValueScripts }>();
  for (const chunkScript of root.querySelectorAll<HTMLScriptElement>(
    `script[type="${SERVER_TREE_CHUNK_SCRIPT_TYPE}"]`,
  )) {
    const chunkJson = chunkScript.textContent ?? "";
    chunks.set(Number(chunkScript.getAttribute("name")), {
      tree: (parsePayload(chunkJson) as { t: TreeValue }).t,
      json: chunkJson,
      values: readTreeValueScripts(chunkScript),
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
        createTreeScript(
          ReactRuntime,
          SERVER_TREE_CHUNK_SCRIPT_TYPE,
          String(id),
          chunk.json,
          chunk.values,
        ),
      );
      return { status: "fulfilled", value, promise: Promise.resolve(value) };
    },
    serverHtml(id, key) {
      const html = serverHtml.get(id);
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
    action(id) {
      if (!options.actions) throw new Error("server action props need islands mode");
      return options.actions(id);
    },
    decode: options.decode
      ? (object, decodeChild) => options.decode!(object, decodeChild as (value: unknown) => unknown)
      : undefined,
  };

  // Validate the whole tree now, so a missing chunk or module falls back before hydration starts.
  const build = () => createTreePage(ReactRuntime, payload.t, json, resolver, undefined, values);
  build();

  function FarmServerTreePage(): React.ReactNode {
    const [, setVersion] = ReactRuntime.useState(0);
    ReactRuntime.useEffect(() => {
      const listener: TreeUpdateListener = (reference, module) => {
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
    return build();
  }

  return ReactRuntime.createElement(
    FarmServerTreePage,
    options.key === undefined ? null : { key: options.key },
  );
}
