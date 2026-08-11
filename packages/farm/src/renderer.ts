import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * A rendering-library integration used by Farm's compiler, server renderer,
 * and browser hydration runtime.
 *
 * Renderer descriptors intentionally contain module identifiers instead of
 * implementation functions. This keeps farm.config.ts serializable and lets
 * every module resolve from the application that selected the renderer.
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
  /** JSX import source written to generated TypeScript configuration. */
  jsxImportSource?: string;
  /** Additional file extensions used for renderer-owned route components. */
  componentExtensions?: readonly string[];
  /** Packages that must share one module instance in a Farm application. */
  dedupe?: readonly string[];
  /** Renderer packages seeded into Vite's dependency optimizer. */
  optimizeDeps?: readonly string[];
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
  }): unknown | readonly unknown[] | Promise<unknown | readonly unknown[]>;
}

export interface FarmServerRendererRuntime {
  readonly name: string;
  readonly Fragment: unknown;
  readonly Suspense: unknown;
  createElement(type: unknown, props?: unknown, ...children: unknown[]): unknown;
  isValidElement(value: unknown): boolean;
  renderToString(element: unknown): string | Promise<string>;
  /** Optional bootstrap required before this renderer hydrates server markup. */
  generateHydrationScript?: () => string;
  /** Optional component used to render route-level failures. */
  ErrorBoundary?: unknown;
  /** Optional streaming primitive. Renderers without one use buffered SSR. */
  renderToPipeableStream?: (
    element: unknown,
    callbacks: {
      onShellReady(): void;
      onShellError(error: unknown): void;
      onError(error: unknown): void;
    },
  ) => { pipe(destination: NodeJS.WritableStream): void };
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
});

export function defineRenderer<const TRenderer extends FarmRenderer>(
  renderer: TRenderer,
): TRenderer {
  return renderer;
}

export function resolveFarmRenderer(renderer?: FarmRenderer): FarmRenderer {
  const resolved = renderer || REACT_RENDERER;
  const fields = ["name", "vite", "server", "client"] as const;

  for (const field of fields) {
    if (typeof resolved[field] !== "string" || resolved[field].trim().length === 0) {
      throw new TypeError(`Farm renderer \`${field}\` must be a non-empty string.`);
    }
  }

  return {
    ...resolved,
    componentExtensions: [...(resolved.componentExtensions || [])],
    dedupe: [...(resolved.dedupe || [])],
    optimizeDeps: [...(resolved.optimizeDeps || [])],
  };
}

export function isReactRenderer(renderer: Pick<FarmRenderer, "name"> | undefined): boolean {
  return !renderer || renderer.name === "react";
}

/** Resolve an optional renderer module from the application's dependency graph. */
export function resolveFarmRendererModule(root: string, specifier: string): string {
  const requireFromApp = createRequire(path.join(path.resolve(root), "package.json"));
  return requireFromApp.resolve(specifier);
}

export async function loadFarmRendererVitePlugins(
  renderer: FarmRenderer,
  root: string,
  options: { ssr?: boolean } = {},
): Promise<unknown[]> {
  // React uses Vite's default automatic JSX transform today. Keep the legacy
  // path dependency-free and avoid resolving Farm's own built package while
  // running directly from source in the monorepo.
  if (isReactRenderer(renderer)) return [];

  const modulePath = resolveFarmRendererModule(root, renderer.vite);
  const rendererModule = (await import(pathToFileURL(modulePath).href)) as FarmRendererViteModule;

  if (typeof rendererModule.createFarmRendererPlugin !== "function") {
    throw new Error(
      `Renderer \`${renderer.name}\` module ${renderer.vite} must export createFarmRendererPlugin().`,
    );
  }

  const created = await rendererModule.createFarmRendererPlugin(options);
  if (!created) return [];
  return Array.isArray(created) ? [...created] : [created];
}
