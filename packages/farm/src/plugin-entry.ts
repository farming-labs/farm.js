/**
 * `@farm.js/core/plugin`. The Vite plugin is re-exported here, not from `./plugin`.
 * There it put `PluginManager` and `definePlugin` in the same dist chunk as the Vite
 * pipeline, and the chunk's `keepNames` `__name()` calls are side effects, so an app
 * server that used either one bundled the dev pipeline, the docs runtime, and MDX.
 */
export * from "./plugin";
export { farmPlugin } from "./vite";
