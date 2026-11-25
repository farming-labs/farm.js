/**
 * @internal The server side of server functions in apps whose renderer is not React (see
 * `resolveFarmIslxActionsMode`): what compiled `"use server"` modules and the production entry
 * import, without islx's React runtime.
 */
export { registerServerReference, setBuildDefaults } from "@farm.js/islx/server";
