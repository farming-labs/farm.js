// Experimental: mount fully compiled trees without React DOM; see createCompiledRoot() in the
// compiler runtime. The build points the runtime import at @farm.js/react/compiler-runtime, so an
// app shares one copy of the compiler runtime with the components it compiled.
import {
  createCompiledRoot as createCompiledRootWithLoader,
  type CompiledRoot,
  type CompiledRootOptions,
} from "./compiler-runtime";

export type { CompiledRoot, CompiledRootOptions };

// React DOM is loaded only when a root needs it.
const loadReactDOM = () => import("react-dom/client");

/** Mounts a fully compiled tree without React DOM, falling back to React DOM when it must. */
export function createCompiledRoot(
  container: Element,
  options: CompiledRootOptions = {},
): CompiledRoot {
  return createCompiledRootWithLoader(container, options, loadReactDOM);
}

/**
 * Drop-in for `createRoot` from `react-dom/client`. With the compiler on, the build points an
 * app's own `createRoot` import here. React DOM's root options apply if the root falls back to it.
 */
export function createRoot(container: Element, options?: unknown): CompiledRoot {
  return createCompiledRoot(container, { reactRootOptions: options });
}
