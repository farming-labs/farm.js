/**
 * The server side of islands mode on islx: islx's island rendering (props, values, action
 * references), pointed at Farm's request. Islands mode only: it loads React, so the renderer and
 * the production server load it only when islands mode is on.
 *
 * A call, not a side-effect import: the server bundle treats Farm's packages as free of import
 * side effects, so a bare `import` of this module would be dropped.
 */
import { setRenderStateResolver } from "@farm.js/islx/react/server";
import { resolveFarmIslandRenderState } from "./island-values";

export function installFarmIslandsServer(): void {
  setRenderStateResolver(resolveFarmIslandRenderState);
}
