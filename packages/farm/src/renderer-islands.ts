/**
 * Islands for renderers that declare `capabilities.islands` (RFC 0012). A renderer's `withIsland`
 * calls `resolveFarmIsland` as it renders a client component from server output, and writes the
 * parts it returns around the component. The wire format and the props codec are islx's
 * (`@farm.js/islx/islands`), which the browser runtime reads, so a renderer never writes either.
 */
import { resolveIslandMarkup } from "@farm.js/islx/islands/server";
import { isFarmIslandStrategy, type FarmIslandStrategy } from "./island";
import {
  getFarmRendererCapabilities,
  isFarmRendererDisabled,
  isReactRenderer,
  resolveFarmRenderer,
  type FarmRenderer,
} from "./renderer";
import { resolveFarmServerComponentsMode } from "./server-components-mode";
import { _peekCurrentRequest } from "./server/request-bridge";

/** What `withIsland` gets for each export of a client module. */
export interface FarmIslandReference {
  /** The module id the browser imports, as `<f-island src>` carries it. */
  readonly src: string;
  /** The component's export in that module. */
  readonly export: string;
  /** The module's `island` export, or `"load"`. A `client:*` attribute overrides it. */
  readonly strategy: FarmIslandStrategy;
}

/** A script element to write: its attributes, unescaped, and its text, already escaped. */
export interface FarmIslandScript {
  readonly attributes: Readonly<Record<string, string>>;
  /** Escaped for a script element. Write it raw, not as text the renderer escapes again. */
  readonly text: string;
}

/** An island to render: the parts to write around the component, and its props. */
export interface FarmResolvedIsland {
  /** The component's props, without `client:*`. */
  readonly props: Record<string, unknown>;
  /** Value scripts to write before the island: the values this response hasn't sent yet. */
  readonly values: readonly FarmIslandScript[];
  /**
   * The island element to write around the component: its tag (`f-island`) and its attributes
   * (src, export, props id, strategy, style), unescaped.
   */
  readonly element: { readonly tag: string; readonly attributes: Readonly<Record<string, string>> };
  /** The props script to write right after the element. */
  readonly script: FarmIslandScript;
}

/**
 * The attributes that set one island's strategy where a client component is used. Add them to
 * the renderer's `JSX.IntrinsicAttributes`, so `<Counter client:visible />` type-checks.
 */
export interface FarmIslandAttributes {
  "client:load"?: boolean | "";
  "client:idle"?: boolean | "";
  "client:visible"?: boolean | "";
  "client:interaction"?: boolean | "";
}

const CLIENT_ATTRIBUTE = "client:";

interface IslandResponse {
  next: number;
  /** The value keys this response already wrote, so a value several islands get goes once. */
  sent: Set<string>;
}

const responses = new WeakMap<Request, IslandResponse>();
// A render outside a request (a build-time render) still gets ids that never repeat.
let detached = 0;

function currentResponse(): IslandResponse | undefined {
  const request = _peekCurrentRequest();
  if (!request) return undefined;
  let response = responses.get(request);
  if (!response) responses.set(request, (response = { next: 0, sent: new Set() }));
  return response;
}

function islandName(reference: FarmIslandReference): string {
  return `${reference.export} (${reference.src})`;
}

/** The strategy a `client:*` attribute sets, with the attribute removed from the props. */
function readClientAttributes(
  props: Record<string, unknown>,
  reference: FarmIslandReference,
): { props: Record<string, unknown>; strategy: FarmIslandStrategy | undefined } {
  const rest: Record<string, unknown> = {};
  let strategy: FarmIslandStrategy | undefined;
  for (const [key, value] of Object.entries(props)) {
    if (!key.startsWith(CLIENT_ATTRIBUTE)) {
      rest[key] = value;
      continue;
    }
    if (value === undefined) continue;
    const name = key.slice(CLIENT_ATTRIBUTE.length);
    if (!isFarmIslandStrategy(name)) {
      throw new TypeError(
        `\`${key}\` on ${islandName(reference)} is not an island strategy. Use \`client:load\`, \`client:idle\`, \`client:visible\` or \`client:interaction\`.`,
      );
    }
    // Vue compiles a bare attribute to "", JSX to true. Values are reserved for options.
    if (value !== true && value !== "") {
      throw new TypeError(
        `\`${key}\` on ${islandName(reference)} takes no value. Write \`${key}\` alone.`,
      );
    }
    if (strategy) {
      throw new TypeError(
        `${islandName(reference)} has two strategies, \`client:${strategy}\` and \`${key}\`. Keep one.`,
      );
    }
    strategy = name;
  }
  return { props: rest, strategy };
}

const reported = new Set<string>();

/**
 * The island a renderer writes for a client component rendered from server output, with
 * `props` as written where it's used:
 *
 * - `client:*` is removed from the props and picks the strategy, before the module's `island`
 *   export (`reference.strategy`).
 * - The island gets an id unique within the response.
 * - The props go through islx's codec: JSON, `Date`, `Map`, `Set` and its other tagged types,
 *   and server actions. A value several islands of one response get is sent once.
 *
 * Returns `undefined` when the props can't reach the browser, such as a function that isn't a
 * server action. Farm logs why, once, and the renderer renders the component without an island,
 * so its server HTML stays without client code. A `client:*` attribute that isn't a strategy, has
 * a value, or is one of two on the same element throws.
 */
export function resolveFarmIsland(
  props: Record<string, unknown>,
  reference: FarmIslandReference,
): FarmResolvedIsland | undefined {
  const { props: islandProps, strategy } = readClientAttributes(props, reference);
  const response = currentResponse();
  const id = response ? `fi${response.next++}` : `fi-${detached++}`;
  try {
    const parts = resolveIslandMarkup({
      src: reference.src,
      export: reference.export,
      strategy: strategy ?? reference.strategy ?? "load",
      id,
      props: islandProps,
      sent: response?.sent,
    });
    return {
      props: islandProps,
      values: parts.values,
      element: parts.element,
      script: parts.script,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const key = `${reference.src}#${reference.export}:${message}`;
    if (!reported.has(key)) {
      reported.add(key);
      // islx's message names the island and the prop.
      console.warn(
        `[Farm.js] ${message}. The server-rendered component was preserved without client hydration.`,
      );
    }
    return undefined;
  }
}

/**
 * Whether `experimental.serverComponents` asks for a renderer's own islands. Farm's server
 * components engine renders React, so on another renderer `{ mode: "islands" }` (and `true`) means
 * that renderer's islands: pages render on the server only, and each client component hydrates on
 * its own through `withIsland`. Config resolution then carries them as
 * `isolatedClientHydration: "enabled"` without server components, the shape
 * `usesFarmRendererIslands` reads.
 *
 * Throws for a renderer that doesn't declare `capabilities.islands`, which would otherwise hydrate
 * every route whole without a word. `{ mode: "rsc" }` is left to the RSC pipeline, which refuses a
 * renderer other than React itself.
 */
export function resolveFarmRendererServerComponentsIslands(config: {
  readonly renderer?: FarmRenderer | false | undefined;
  readonly experimental?: { readonly serverComponents?: unknown };
}): boolean {
  if (resolveFarmServerComponentsMode(config.experimental?.serverComponents) !== "islands") {
    return false;
  }
  // No renderer means React; `renderer: false` has no pages to hydrate.
  if (config.renderer === undefined || isFarmRendererDisabled(config.renderer)) return false;
  const renderer = resolveFarmRenderer(config.renderer);
  if (isReactRenderer(renderer)) return false;
  if (!getFarmRendererCapabilities(renderer).islands) {
    throw new Error(
      `[Farm.js] \`experimental.serverComponents: { mode: "islands" }\` needs a renderer that ` +
        `supports islands, and \`${renderer.name}\` doesn't declare \`capabilities.islands\`. ` +
        "Remove `experimental.serverComponents` to hydrate each route whole, or add islands to " +
        "the renderer: https://farmjs.dev/docs/renderers/custom#islands",
    );
  }
  return true;
}

/**
 * Whether the app's islands start through its renderer's `withIsland`: a renderer other than
 * React that declares `capabilities.islands`, in an app that sets
 * `experimental.serverComponents: { mode: "islands" }` (which config resolution carries as
 * `isolatedClientHydration: "enabled"`, see `resolveFarmRendererServerComponentsIslands`) or the
 * older `isolatedClientHydration: "enabled"`. Every other app takes the path it took before.
 */
export function usesFarmRendererIslands(config: {
  readonly renderer?: FarmRenderer | false | undefined;
  readonly experimental?: {
    readonly isolatedClientHydration?: string | undefined;
    readonly serverComponents?: unknown;
  };
}): boolean {
  const renderer = resolveFarmRenderer(config.renderer);
  return (
    !isReactRenderer(renderer) &&
    getFarmRendererCapabilities(renderer).islands &&
    config.experimental?.isolatedClientHydration === "enabled" &&
    resolveFarmServerComponentsMode(config.experimental?.serverComponents) === undefined
  );
}
