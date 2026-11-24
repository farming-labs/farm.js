/**
 * `@farm.js/core/renderer`: the renderer contract, and the helpers a renderer's islands call.
 * renderer.ts imports no local module at runtime (the renderer capability matrix test loads it on
 * its own), so the islands helpers join it here.
 */
export * from "./renderer";
export {
  resolveFarmIsland,
  type FarmIslandAttributes,
  type FarmIslandReference,
  type FarmIslandScript,
  type FarmResolvedIsland,
} from "./renderer-islands";
