import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { FarmPresetRuntime } from "./deployment";
import type { FarmIslandStrategy } from "./island";
import type { FarmIslandReference } from "./renderer-islands";

/**
 * A rendering-library integration used by Farm's compiler, server renderer,
 * and browser hydration runtime.
 *
 * Code that runs in the app (the Vite plugin, the server and client modules) is named by module
 * id, so every module resolves from the application that selected the renderer and Farm can import
 * it from the entries it generates. Build-time hooks (`routes()` and `hydration.resolve()`) are
 * methods: they run in Node while Farm scans the app, and never reach a bundle.
 */
export interface FarmRenderer {
  /** Stable public identifier used in diagnostics and generated manifests. */
  name: string;
  /** Module exporting the renderer's Vite plugin factory. */
  vite: string;
  /** Module exporting Farm's server-renderer compatibility contract. */
  server: string;
  /** Module exporting Farm's browser-renderer compatibility contract. */
  client: string;
  /**
   * The package the renderer's JSX imports its runtime from, such as `"preact"`. Development
   * passes it to Vite's dependency scan, so `<source>/jsx-dev-runtime` is pre-bundled before the
   * first page load.
   */
  jsxImportSource?: string;
  /** Additional file extensions used for renderer-owned route components. */
  componentExtensions?: readonly string[];
  /** Packages that must share one module instance in a Farm application. */
  dedupe?: readonly string[];
  /**
   * Renderer packages seeded into Vite's dependency optimizer. Farm adds `client` itself when it
   * names a package.
   */
  optimizeDeps?: readonly string[];
  /**
   * Scheduling policy for the production client and SSR graphs.
   *
   * Most renderer plugins are safe to run in parallel. Renderers whose
   * compiler plugins keep process-global mutable state can opt into serial
   * builds so one graph cannot invalidate the other's transforms.
   */
  buildConcurrency?: "parallel" | "serial";
  /** Runtime features this renderer intentionally supports. */
  capabilities?: FarmRendererCapabilitiesInput;
  /**
   * Serializable options consumed by the renderer's Vite integration.
   *
   * Keeping renderer-owned configuration on the descriptor lets one rendering
   * library expose multiple compiler modes without teaching Farm's core about
   * each option.
   */
  options?: Readonly<Record<string, unknown>>;
  /**
   * Module that configures each app instance the renderer creates, relative to the project
   * root. Farm imports it in the server and client entries and passes its default export to
   * the renderer's `configureApp()`, which both renderer runtime modules must export.
   */
  appSetup?: string;
  /**
   * Which files are routes, and the URL each one serves. Farm calls it once per route scan, in
   * `farm dev`, `farm build` and `farm generate`, and builds its one route table from the rules
   * `resolve()` returns. Leave it out to keep Farm's folders: `src/app/blog/[slug]/page.tsx`.
   */
  routes?(context: FarmRendererRoutesContext): FarmRendererRoutes | Promise<FarmRendererRoutes>;
  /** Which pages and layouts hydrate, and when, by default and in this renderer's own syntax. */
  hydration?: FarmRendererHydrationOptions;
}

/** What Farm passes to a renderer's `routes()`. */
export interface FarmRendererRoutesContext {
  /** The project root, or a layer's root when Farm scans that layer's routes. */
  readonly root: string;
  /** Farm's folder rules (`about/page.tsx` → `/about`), to hand the files you don't map yourself. */
  readonly defaults: FarmRendererRoutes;
}

/** A renderer's route rules. */
export interface FarmRendererRoutes {
  /** The directory Farm scans, relative to the root. Defaults to `src/app` (`<srcDir>/app`). */
  dir?: string;
  /**
   * The route a file is, or `null` when it isn't one. Called once per file under `dir`, with the
   * same answer expected for the same file. Farm doesn't pass its own files: `route.ts`,
   * `middleware.ts`, metadata routes, and named slots stay in `src/app`.
   */
  resolve(file: FarmRendererRouteFile): FarmRendererRoute | null | undefined;
}

/** A file under a renderer's route `dir`. */
export interface FarmRendererRouteFile {
  /** Relative to `dir`, with `/` separators: `"blog/[slug].client.leaf"`. */
  readonly path: string;
  /** The directories between `dir` and the file: `["blog"]`, or `[]` for a file directly in it. */
  readonly segments: readonly string[];
  /** The file name without its extension: `"[slug].client"`. */
  readonly name: string;
  /** The extension, lowercase: `".leaf"`. */
  readonly extension: string;
}

export type FarmRendererRouteKind = "page" | "layout" | "loading" | "error" | "not-found";

/** A route a file is, with optional hydration settings for it. */
export interface FarmRendererRoute extends FarmRendererHydration {
  kind: FarmRendererRouteKind;
  /**
   * The URL, written as `src/app` folders write it: `"/"`, `"/blog/[slug]"`,
   * `"/docs/[...path]"`, `"/(marketing)/pricing"`. A layout, loading or error file applies to
   * its pattern and everything below it. `"not-found"` takes `"/"`: Farm renders one not-found page.
   */
  pattern: string;
}

/** Hydration settings for a page or layout. A field left out falls back to the next level. */
export interface FarmRendererHydration {
  /** Whether the page or layout hydrates, as `export const hydrate = true` says. */
  hydrate?: boolean;
  /** When it hydrates, as `export const island = "visible"` says. Takes effect when it hydrates. */
  strategy?: FarmIslandStrategy;
}

/**
 * A renderer's hydration settings. The most specific level wins: a file's own settings, then its
 * route rule from `routes()`, then these defaults, then Farm's (no hydration, `"load"`).
 */
export interface FarmRendererHydrationOptions {
  /** Whether pages hydrate by default. */
  pages?: boolean;
  /** Whether layouts hydrate by default. */
  layouts?: boolean;
  /** When a hydrating page or layout that sets no strategy hydrates. */
  strategy?: FarmIslandStrategy;
  /**
   * Reads a page or layout's settings from its source, in this renderer's own syntax. Farm calls
   * it for files with the descriptor's `componentExtensions`, before any compiler runs. Return
   * nothing to leave the file to Farm's `export const hydrate` and `export const island`; a file
   * that says both, and disagrees, fails the build.
   */
  resolve?(source: string, file: string): FarmRendererHydration | null | undefined;
}

export type FarmRendererRuntime = Exclude<FarmPresetRuntime, "unknown">;

export interface FarmRendererStreamingPrimitives {
  /** Supports Node.js writable streams through renderToPipeableStream(). */
  node: boolean;
  /** Supports WHATWG ReadableStream output through renderToReadableStream(). */
  web: boolean;
}

export interface FarmRendererStreamingCapabilities extends FarmRendererStreamingPrimitives {
  /**
   * Overrides the default stream primitives for a deployment runtime.
   *
   * The top-level values remain the fallback for development and unknown
   * presets. Runtime overrides let a renderer describe packages whose exports
   * change with bundler conditions, such as React DOM's Node and edge builds.
   */
  runtimes?: Partial<Record<FarmRendererRuntime, FarmRendererStreamingPrimitives>>;
}

export interface FarmRendererCapabilities {
  streaming: FarmRendererStreamingCapabilities;
  /**
   * Whether re-rendering an existing root diffs the new tree against the live
   * DOM instead of rebuilding it.
   *
   * Virtual-DOM renderers (React, Preact, Vue) compare the incoming tree with
   * what is mounted, so a client navigation that re-renders a shared layout
   * keeps the matching DOM nodes, their focus, and their component state.
   *
   * Compile-time fine-grained renderers (Solid, Svelte) have no virtual DOM to
   * diff against. Their updates flow through bindings created when elements
   * were constructed, so handing them a freshly materialized tree replaces the
   * nodes. That is a property of those runtimes, not a gap in their adapters,
   * and callers that need state to survive a re-render must keep it in a root
   * they do not re-render rather than expect reconciliation here.
   */
  reconcilesRerenders: boolean;
  /**
   * Whether this renderer can render a plain function component: one that
   * takes props and returns an element tree, rather than a component built by
   * the renderer's own compiler.
   *
   * React-shaped renderers do this natively. A compile-time renderer needs its
   * adapter to recognize such a component and call it, because its own
   * components are functions too and the two are otherwise indistinguishable.
   * Farm uses this to decide whether integration provider components can be
   * rendered at all, so it defaults to false and each adapter opts in once it
   * handles them.
   */
  functionComponents: boolean;
  /**
   * Whether a production page whose `hydrateRoot()` throws is rendered again with `createRoot()`.
   *
   * Development always does this. In production, a renderer that leaves this off keeps the
   * server's markup without event listeners, as before the option existed. Turn it on only when
   * the client module's `createRoot()` replaces what's already in its container, because the failed
   * hydration leaves the server's markup there.
   */
  hydrationFallback: boolean;
  /**
   * Whether the server module exports `withIsland`, so a client component rendered from server
   * output hydrates as its own island when the app sets
   * `experimental.isolatedClientHydration: "enabled"`. Experimental.
   *
   * Farm wraps each export of a client module in the server graph with `withIsland`, and the
   * browser starts each island with the client module's `createElement` and `hydrateRoot`.
   * Without it, those apps take the path they take today.
   */
  islands: boolean;
}

export interface FarmRendererCapabilitiesInput {
  streaming?: Partial<FarmRendererStreamingPrimitives> & {
    runtimes?: Partial<Record<FarmRendererRuntime, Partial<FarmRendererStreamingPrimitives>>>;
  };
  reconcilesRerenders?: boolean;
  functionComponents?: boolean;
  hydrationFallback?: boolean;
  /** The server module exports `withIsland`. Experimental; see `FarmRendererCapabilities`. */
  islands?: boolean;
}

/** A client layout participating in a renderer-owned route update. */
export interface FarmRendererRouteLayout {
  /** Stable route pattern used to decide whether the mounted layout chain changed. */
  pattern: string;
  /** Renderer-native layout component. */
  Component: unknown;
}

/**
 * Renderer-neutral route state supplied during hydration and client navigation.
 *
 * Virtual-DOM renderers can ignore this and keep rendering `element`. A
 * fine-grained renderer can implement `renderRoute()` and keep the matching
 * layout chain mounted while it updates the page slot and route params through
 * its native reactive primitives.
 */
export interface FarmRendererRouteState {
  /** Fully composed fallback tree for renderers that only implement render(). */
  element: unknown;
  /** Applicable layouts in outermost-to-innermost order. */
  layouts: readonly FarmRendererRouteLayout[];
  /** Page boundary or page element placed in the innermost layout slot. */
  page: unknown;
  /** Current dynamic route params. */
  params: Readonly<Record<string, string>>;
  /** Framework wrappers, such as integration providers, applied outside layouts. */
  wrap?: (element: unknown) => unknown;
}

/** Browser root contract implemented by renderer client adapters. */
export interface FarmRendererClientRoot {
  render(element: unknown): void;
  /** Optional renderer-native route update that preserves matching layouts. */
  renderRoute?(state: FarmRendererRouteState): void;
  unmount(): void;
}

/**
 * Named exports of a renderer client module. Farm's development and production client entries
 * import them by name, so the module needs no default export.
 */
export interface FarmRendererClientRuntime {
  /** Builds the route tree in the browser, as the server module's createElement() does. */
  createElement(type: unknown, props?: unknown, ...children: unknown[]): unknown;
  /** Wraps a page that has a loading file while the browser navigates to it. */
  readonly Suspense: unknown;
  createRoot(container: Element): FarmRendererClientRoot;
  /**
   * Non-React renderers receive route state as the optional third argument so
   * a renderer-owned root can establish its native reactive route bindings
   * during initial hydration.
   */
  hydrateRoot(
    container: Element,
    element: unknown,
    routeState?: FarmRendererRouteState,
  ): FarmRendererClientRoot;
  /** Receives the descriptor's `appSetup` module. Required when the descriptor sets `appSetup`. */
  configureApp?(setup: unknown): void;
}

const DEFAULT_RENDERER_CAPABILITIES: Readonly<FarmRendererCapabilities> = Object.freeze({
  streaming: Object.freeze({ node: false, web: false }),
  // Conservative default: assume a re-render rebuilds until a renderer states
  // otherwise, so callers do not silently rely on reconciliation.
  reconcilesRerenders: false,
  functionComponents: false,
  hydrationFallback: false,
  islands: false,
});

export function getFarmRendererCapabilities(
  renderer?: Pick<FarmRenderer, "capabilities">,
): FarmRendererCapabilities {
  const defaultStreaming = {
    node: renderer?.capabilities?.streaming?.node ?? DEFAULT_RENDERER_CAPABILITIES.streaming.node,
    web: renderer?.capabilities?.streaming?.web ?? DEFAULT_RENDERER_CAPABILITIES.streaming.web,
  };
  const runtimes = Object.fromEntries(
    (["node", "edge"] as const).flatMap((runtime) => {
      const override = renderer?.capabilities?.streaming?.runtimes?.[runtime];
      if (!override) return [];
      return [
        [
          runtime,
          {
            node: override.node ?? defaultStreaming.node,
            web: override.web ?? defaultStreaming.web,
          },
        ],
      ];
    }),
  ) as Partial<Record<FarmRendererRuntime, FarmRendererStreamingPrimitives>>;

  return {
    streaming: {
      ...defaultStreaming,
      ...(Object.keys(runtimes).length > 0 ? { runtimes } : {}),
    },
    reconcilesRerenders:
      renderer?.capabilities?.reconcilesRerenders ??
      DEFAULT_RENDERER_CAPABILITIES.reconcilesRerenders,
    functionComponents:
      renderer?.capabilities?.functionComponents ??
      DEFAULT_RENDERER_CAPABILITIES.functionComponents,
    hydrationFallback:
      renderer?.capabilities?.hydrationFallback ?? DEFAULT_RENDERER_CAPABILITIES.hydrationFallback,
    islands: renderer?.capabilities?.islands ?? DEFAULT_RENDERER_CAPABILITIES.islands,
  };
}

export function getFarmRendererStreamingCapabilitiesForRuntime(
  renderer: Pick<FarmRenderer, "capabilities"> | undefined,
  runtime: FarmRendererRuntime | "unknown",
): FarmRendererStreamingPrimitives {
  const streaming = getFarmRendererCapabilities(renderer).streaming;
  if (runtime === "unknown") return { node: streaming.node, web: streaming.web };
  return streaming.runtimes?.[runtime] ?? { node: streaming.node, web: streaming.web };
}

/** The named exports Farm reads from every renderer server module (`FarmServerRendererRuntime`). */
const FARM_RENDERER_SERVER_EXPORTS = [
  "name",
  "createElement",
  "isValidElement",
  "Fragment",
  "Suspense",
  "renderToString",
] as const;

function isMissingServerExport(key: string, value: unknown): boolean {
  if (key === "name") return typeof value !== "string" || value === "";
  if (key === "Fragment" || key === "Suspense") return value === undefined || value === null;
  return typeof value !== "function";
}

/**
 * Throws one error that names every required export a renderer's server module lacks. The
 * development server and `farm build` load the module through `ServerRenderer.initialize()`, so a
 * missing export fails there instead of as `undefined` on the first request.
 */
export function assertFarmRendererServerModule(
  runtime: unknown,
  renderer: {
    readonly name: string;
    readonly server: string;
    readonly capabilities?: Pick<FarmRendererCapabilitiesInput, "islands">;
  },
): void {
  const exports = (runtime ?? {}) as Record<string, unknown>;
  const missing: string[] = FARM_RENDERER_SERVER_EXPORTS.filter((key) =>
    isMissingServerExport(key, exports[key]),
  );
  // A declared capability that's incomplete fails here, rather than as islands that never start.
  if (renderer.capabilities?.islands === true && typeof exports.withIsland !== "function") {
    missing.push("withIsland");
  }
  if (missing.length === 0) return;
  const names = missing.map((key) => `\`${key}\``);
  const list =
    names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(", ")}${names.length > 2 ? "," : ""} and ${names[names.length - 1]}`;
  throw new Error(
    `Renderer \`${renderer.name}\` server module \`${renderer.server}\` does not export ${list}. ` +
      (missing.includes("withIsland")
        ? "Its descriptor declares `capabilities.islands`, which needs `withIsland`. "
        : "") +
      `Export ${missing.length === 1 ? "it" : "them"} by name from that module: ` +
      "https://farmjs.dev/docs/renderers#renderer-modules",
  );
}

export function assertFarmRendererStreamingRuntime(
  name: string,
  renderer: Pick<FarmRenderer, "capabilities"> | undefined,
  runtimeModule: Pick<
    Partial<FarmServerRendererRuntime>,
    "capabilities" | "renderToPipeableStream" | "renderToReadableStream"
  >,
  runtime: FarmRendererRuntime | "unknown",
): FarmRendererStreamingPrimitives {
  const declared = getFarmRendererStreamingCapabilitiesForRuntime(renderer, runtime);
  const runtimeDeclaration = runtimeModule.capabilities?.streaming;

  if (runtimeDeclaration) {
    const advertised = getFarmRendererStreamingCapabilitiesForRuntime(
      { capabilities: { streaming: runtimeDeclaration } },
      runtime,
    );
    if ((declared.node && !advertised.node) || (declared.web && !advertised.web)) {
      throw new Error(
        `Renderer \`${name}\` server module advertises ${JSON.stringify(advertised)} streaming for the ${runtime} runtime, which does not satisfy its descriptor ${JSON.stringify(declared)}.`,
      );
    }
  }

  if (declared.node && typeof runtimeModule.renderToPipeableStream !== "function") {
    throw new Error(
      `Renderer \`${name}\` advertises Node streaming for the ${runtime} runtime but its server module does not export renderToPipeableStream().`,
    );
  }
  if (declared.web && typeof runtimeModule.renderToReadableStream !== "function") {
    throw new Error(
      `Renderer \`${name}\` advertises Web streaming for the ${runtime} runtime but its server module does not export renderToReadableStream().`,
    );
  }

  return declared;
}

export const FARM_COMPONENT_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"] as const;

export function resolveFarmComponentExtensions(extensions: readonly string[] = []): string[] {
  return Array.from(
    new Set(
      [...FARM_COMPONENT_EXTENSIONS, ...extensions].map((extension) => {
        const normalized = extension.trim().toLowerCase();
        return normalized.startsWith(".") ? normalized : `.${normalized}`;
      }),
    ),
  ).filter((extension) => extension.length > 1);
}

export function getFarmRendererComponentExtensions(
  renderer?: Pick<FarmRenderer, "componentExtensions">,
): string[] {
  return resolveFarmComponentExtensions(renderer?.componentExtensions);
}

export interface FarmRendererViteModule {
  createFarmRendererPlugin(options?: {
    ssr?: boolean;
    /** Shared only within a production build; aborted after all graphs close. */
    buildLifetime?: AbortSignal;
    rendererOptions?: Readonly<Record<string, unknown>>;
  }): unknown | readonly unknown[] | Promise<unknown | readonly unknown[]>;
}

/**
 * Per-render options Farm passes to a server renderer. A renderer that emits
 * its own inline scripts (hydration data, streaming reveals) puts `nonce` on
 * them; under `security.csp.nonce` any script without it is blocked.
 */
export interface FarmRendererRenderOptions {
  /** CSP nonce of the response being rendered. */
  nonce?: string;
}

/**
 * Named exports of a renderer server module. Farm's development server and its production SSR
 * entry import them by name, so the module needs no default export.
 */
export interface FarmServerRendererRuntime {
  readonly name: string;
  readonly Fragment: unknown;
  readonly Suspense: unknown;
  createElement(type: unknown, props?: unknown, ...children: unknown[]): unknown;
  isValidElement(value: unknown): boolean;
  /** Wraps a route-owned client tree so compiled leaf boundaries stay inside that React root. */
  wrapClientGraph?(element: unknown): unknown;
  /** Lets a server-only page under a route-owned client tree render its own isolated islands. */
  isolateServerPageGraph?(element: unknown): unknown;
  /** Resolves an async page below a hydrating layout into a tree the browser rebuilds there. */
  renderServerTreePage?(element: unknown, options?: { values?: boolean }): Promise<unknown>;
  /**
   * Wraps a client component so that, rendered from server output, it starts an island: it calls
   * `resolveFarmIsland` and renders the result around the component. Inside a tree that
   * `wrapClientGraph` marks, it renders the component plain. Farm calls it on each export of a
   * client module in the server graph. Required when the descriptor declares
   * `capabilities.islands`.
   */
  withIsland?(component: unknown, reference: FarmIslandReference): unknown;
  /**
   * Optional: tag a plain function component so a renderer that compiles its
   * own components can tell the two apart. Renderers without the hook treat
   * every component the same way and do not need it.
   */
  markFunctionComponent?<T>(component: T): T;
  /**
   * Optional: locate where a streamed chunk stops being the static shell.
   *
   * Partial prerendering caches everything before the first dynamic boundary
   * and refreshes the rest on the client, so it has to know where that
   * boundary is. The markers are renderer-specific (React streams Fizz
   * boundary ids and `$RC`/`$RS` reveal calls, Solid streams `<template
   * id="pl-N">` with `$df(N)`), so the renderer that emits them owns finding
   * them. Returns the index to cut at, or -1 when the chunk is entirely
   * static.
   *
   * A renderer that does not implement this gets no static shell at all:
   * guessing would mean caching a per-request response as if it were shared.
   */
  findStaticShellBoundary?(chunk: string): number;
  renderToString(element: unknown, options?: FarmRendererRenderOptions): string | Promise<string>;
  /**
   * Optional variant for renderers whose components emit document-head markup
   * during render (e.g. <svelte:head>). `html` is the body markup exactly as
   * renderToString would produce it; `head` is injected into the assembled
   * document's <head>.
   */
  renderToStringWithHead?(
    element: unknown,
    options?: FarmRendererRenderOptions,
  ): { html: string; head: string } | Promise<{ html: string; head: string }>;
  /** Optional runtime copy of the descriptor capabilities for diagnostics. */
  readonly capabilities?: FarmRendererCapabilitiesInput;
  /** Optional bootstrap required before this renderer hydrates server markup. */
  generateHydrationScript?: () => string;
  /** Receives the descriptor's `appSetup` module. Required when the descriptor sets `appSetup`. */
  configureApp?(setup: unknown): void;
  /**
   * @deprecated Farm no longer reads this export. A page that throws under an `error.*` file
   * renders that file as the route's error page, with the error's status, in development and in
   * production: https://farmjs.dev/docs/renderers#renderer-modules
   */
  ErrorBoundary?: unknown;
  /** Optional streaming primitive. Renderers without one use buffered SSR. */
  renderToPipeableStream?: (
    element: unknown,
    callbacks: {
      onShellReady(): void;
      onShellError(error: unknown): void;
      onError(error: unknown): void;
      /**
       * React DOM option, passed only for React: called once every Suspense
       * boundary has finished. Buffered renders start piping here.
       */
      onAllReady?(): void;
      /**
       * React DOM option, passed only for React: completed boundaries larger than
       * this stream behind their fallback. Buffered renders raise it to stay inline.
       */
      progressiveChunkSize?: number;
      /** CSP nonce forwarded to renderer-owned inline streaming scripts. */
      nonce?: string;
      /**
       * React DOM option: the form state of a `useActionState` form posted without JavaScript,
       * which the page renders with.
       */
      formState?: unknown;
    },
  ) => {
    pipe(destination: NodeJS.WritableStream): void;
    /** Stop rendering; pending boundaries report `reason` to `onError`. */
    abort?(reason?: unknown): void;
  };
  /** WHATWG streaming primitive used by Web-stream-capable renderers. */
  renderToReadableStream?: (
    element: unknown,
    options?: FarmRendererRenderOptions & {
      /**
       * Reports a render error after output has started. The response can't change status by
       * then, so report the error here and close the stream: erroring a stream that has sent
       * output resets the connection. An error before any output should error the stream, so
       * Farm answers with the error's status.
       */
      onError?(error: unknown): void;
    },
  ) => ReadableStream<Uint8Array | string> | Promise<ReadableStream<Uint8Array | string>>;
}

export const REACT_RENDERER: Readonly<FarmRenderer> = Object.freeze({
  name: "react",
  vite: "@farm.js/core/renderer/react/vite",
  server: "@farm.js/core/renderer/react/server",
  client: "@farm.js/core/renderer/react/client",
  jsxImportSource: "react",
  dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime"],
  optimizeDeps: [
    "react",
    "react-dom",
    "react-dom/client",
    "react/jsx-runtime",
    "react/jsx-dev-runtime",
  ],
  capabilities: {
    streaming: {
      node: true,
      web: false,
      runtimes: { edge: { node: false, web: true } },
    },
    reconcilesRerenders: true,
    functionComponents: true,
  },
});

/**
 * The renderer an app gets with `renderer: false`: it has no pages, so it builds no browser
 * client and no React (or other UI) runtime. Its server module only answers the renderer
 * contract and throws if anything tries to render a component.
 */
export const NO_RENDERER: Readonly<FarmRenderer> = Object.freeze({
  name: "none",
  vite: "@farm.js/core/renderer/none/server",
  server: "@farm.js/core/renderer/none/server",
  client: "@farm.js/core/renderer/none/server",
  capabilities: {
    streaming: { node: false, web: false },
    reconcilesRerenders: false,
    functionComponents: false,
  },
});

/** True when the app opted out of pages and their renderer with `renderer: false`. */
export function isFarmRendererDisabled(
  renderer: Pick<FarmRenderer, "name"> | false | undefined,
): boolean {
  return renderer === false || renderer?.name === NO_RENDERER.name;
}

export function defineRenderer<const TRenderer extends FarmRenderer>(
  renderer: TRenderer,
): TRenderer {
  return renderer;
}

// A record, so the type-check fails until a strategy added to `FarmIslandStrategy` is added here.
// No local module is imported at runtime: the renderer capability matrix test loads this file alone.
const FARM_RENDERER_STRATEGIES: Readonly<Record<FarmIslandStrategy, true>> = {
  load: true,
  idle: true,
  visible: true,
  interaction: true,
};

function isFarmRendererStrategy(value: unknown): value is FarmIslandStrategy {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(FARM_RENDERER_STRATEGIES, value)
  );
}

export function resolveFarmRenderer(renderer?: FarmRenderer | false): FarmRenderer {
  // `renderer: false`, or a config that already resolved it, which config resolution runs again.
  if (renderer === false || isFarmRendererDisabled(renderer)) renderer = NO_RENDERER;
  const resolved = renderer || REACT_RENDERER;
  const fields = ["name", "vite", "server", "client"] as const;

  for (const field of fields) {
    if (typeof resolved[field] !== "string" || resolved[field].trim().length === 0) {
      throw new TypeError(`Farm renderer \`${field}\` must be a non-empty string.`);
    }
  }

  if (
    resolved.appSetup !== undefined &&
    (typeof resolved.appSetup !== "string" || resolved.appSetup.trim().length === 0)
  ) {
    throw new TypeError("Farm renderer `appSetup` must be a non-empty module path.");
  }

  const issues: string[] = [];
  if (resolved.routes !== undefined && typeof resolved.routes !== "function") {
    issues.push("`routes` must be a method that returns `{ dir?, resolve(file) }`.");
  }
  const hydration = resolved.hydration as unknown;
  if (hydration !== undefined) {
    if (!hydration || typeof hydration !== "object" || Array.isArray(hydration)) {
      issues.push("`hydration` must be an object.");
    } else {
      const options = hydration as Record<string, unknown>;
      for (const key of ["pages", "layouts"] as const) {
        if (options[key] !== undefined && typeof options[key] !== "boolean") {
          issues.push(`\`hydration.${key}\` must be true or false.`);
        }
      }
      if (options.strategy !== undefined && !isFarmRendererStrategy(options.strategy)) {
        issues.push(
          `\`hydration.strategy\` must be "load", "idle", "visible", or "interaction"; got ${JSON.stringify(options.strategy)}.`,
        );
      }
      if (options.resolve !== undefined && typeof options.resolve !== "function") {
        issues.push("`hydration.resolve` must be a method that reads a file's source.");
      }
    }
  }
  if (issues.length > 0) {
    throw new TypeError(
      `Farm renderer \`${resolved.name}\` is invalid:\n${issues.map((issue) => `- ${issue}`).join("\n")}`,
    );
  }

  return {
    ...resolved,
    componentExtensions: [...(resolved.componentExtensions || [])],
    dedupe: [...(resolved.dedupe || [])],
    optimizeDeps: [...(resolved.optimizeDeps || [])],
    buildConcurrency: resolved.buildConcurrency || "parallel",
    capabilities: getFarmRendererCapabilities(resolved),
    options: resolved.options ? { ...resolved.options } : undefined,
  };
}

/** @internal An error a renderer hook caused, with the hook's own error as its `cause`. */
export function createFarmRendererHookError(message: string, cause: unknown): Error {
  const error = new Error(message);
  (error as Error & { cause?: unknown }).cause = cause;
  return error;
}

/**
 * @internal The `hydrate` and `strategy` a renderer hook returned, checked. `where` names the hook
 * and the file for the error a bad value throws.
 */
export function readFarmRendererHydration(
  value: Readonly<Record<string, unknown>>,
  where: string,
): FarmRendererHydration {
  const result: FarmRendererHydration = {};
  if (value.hydrate !== undefined) {
    if (typeof value.hydrate !== "boolean") {
      throw new TypeError(
        `${where} returned \`hydrate: ${JSON.stringify(value.hydrate)}\`. Return true or false, or leave it out.`,
      );
    }
    result.hydrate = value.hydrate;
  }
  if (value.strategy !== undefined) {
    if (!isFarmRendererStrategy(value.strategy)) {
      throw new TypeError(
        `${where} returned \`strategy: ${JSON.stringify(value.strategy)}\`. Return "load", "idle", "visible", or "interaction", or leave it out.`,
      );
    }
    result.strategy = value.strategy;
  }
  return result;
}

export async function readFarmRendererWebStream(
  stream: ReadableStream<Uint8Array | string>,
): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let html = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    html += typeof value === "string" ? value : decoder.decode(value, { stream: true });
  }

  return html + decoder.decode();
}

export function isReactRenderer(renderer: Pick<FarmRenderer, "name"> | undefined): boolean {
  return !renderer || renderer.name === "react";
}

/** Absolute path of the renderer's app setup module, or null when the app has none. */
export function resolveFarmRendererAppSetup(
  root: string,
  renderer: Pick<FarmRenderer, "name" | "appSetup">,
): string | null {
  if (!renderer.appSetup) return null;
  const filePath = path.resolve(root, renderer.appSetup);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Renderer \`${renderer.name}\` app setup module was not found: ${filePath}`);
  }
  return filePath;
}

/** Resolve an optional renderer module from the application's dependency graph. */
export function resolveFarmRendererModule(root: string, specifier: string): string {
  const requireFromApp = createRequire(path.join(path.resolve(root), "package.json"));
  return requireFromApp.resolve(specifier);
}

/**
 * Compile React JSX with the automatic runtime even when the app has no tsconfig.json.
 * esbuild only picks the runtime up from `compilerOptions.jsx`, so a hand-written app
 * without one fell back to `React.createElement` and failed with "React is not defined".
 * JSX settings in the app's own Vite config still win; a tsconfig's `jsxImportSource`
 * still applies. Rolldown-based Vite compiles with oxc, which already defaults to the
 * automatic runtime, so this leaves it alone.
 */
function createFarmReactJsxPlugin() {
  return {
    name: "farm:react-jsx",
    config(
      this: { meta?: { rolldownVersion?: string } } | void,
      config: { esbuild?: false | { jsx?: unknown } },
    ) {
      if (this && this.meta?.rolldownVersion) return;
      if (config.esbuild === false || config.esbuild?.jsx !== undefined) return;
      return { esbuild: { jsx: "automatic" as const } };
    },
  };
}

export async function loadFarmRendererVitePlugins(
  renderer: FarmRenderer,
  root: string,
  options: { ssr?: boolean; buildLifetime?: AbortSignal } = {},
): Promise<unknown[]> {
  // React needs no renderer package. Keep this path dependency-free and avoid
  // resolving Farm's own built package while running from source in the monorepo.
  if (renderer.vite === REACT_RENDERER.vite) return [createFarmReactJsxPlugin()];
  // An app without pages compiles no components.
  if (isFarmRendererDisabled(renderer)) return [];

  const modulePath = resolveFarmRendererModule(root, renderer.vite);
  const rendererModule = (await import(pathToFileURL(modulePath).href)) as FarmRendererViteModule;

  if (typeof rendererModule.createFarmRendererPlugin !== "function") {
    throw new Error(
      `Renderer \`${renderer.name}\` module ${renderer.vite} must export createFarmRendererPlugin().`,
    );
  }

  const created = await rendererModule.createFarmRendererPlugin({
    ...options,
    rendererOptions: renderer.options,
  });
  if (!created) return [];
  return Array.isArray(created) ? [...created] : [created];
}
