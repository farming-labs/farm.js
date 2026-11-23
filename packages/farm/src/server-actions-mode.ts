import { isFarmRendererDisabled, isReactRenderer, type FarmRenderer } from "./renderer";
import { resolveFarmServerComponentsMode } from "./server-components-mode";

/**
 * Which islx actions runtime runs the app's `"use server"` modules, which browser code imports as
 * references that post to the page, where the page's server runs the action.
 *
 * - `"islands"`: React in islands mode.
 * - `"renderer"`: any other renderer, with `experimental.serverActions`. The engine React apps use
 *   outside islands mode (`@farm.js/plugin/rsc`) is React-only, so these apps use islx's actions
 *   without islands.
 * - `null`: none. A React app outside islands mode runs actions through `@farm.js/plugin/rsc` when
 *   it is installed.
 *
 * Server functions (`createServerFn`, `createServerQuery`) imported by browser code also need
 * `experimental.serverActions` in islands mode; see `farmBrowserServerFnsEnabled`.
 */
export type FarmIslxActionsMode = "islands" | "renderer";

type ActionsConfig = {
  renderer?: Pick<FarmRenderer, "name"> | false;
  experimental?: { serverActions?: unknown; serverComponents?: unknown };
};

export function resolveFarmIslxActionsMode(config: ActionsConfig): FarmIslxActionsMode | null {
  if (resolveFarmServerComponentsMode(config.experimental?.serverComponents) === "islands") {
    return "islands";
  }
  if (config.experimental?.serverActions !== true) return null;
  const renderer = config.renderer;
  if (renderer === undefined || renderer === false) return null;
  if (isFarmRendererDisabled(renderer) || isReactRenderer(renderer)) return null;
  return "renderer";
}

/** Whether browser code may import server functions, which then run on islx's actions. */
export function farmBrowserServerFnsEnabled(config: ActionsConfig): boolean {
  return config.experimental?.serverActions === true && resolveFarmIslxActionsMode(config) !== null;
}
