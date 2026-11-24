/**
 * Islands mode's interceptor for server action calls, without the code that handles their results
 * (RFC 0013). A page of islands that calls nothing never runs the action client, the server query
 * runtime or the query cache, so they load when the page can call: on a first call, when a client
 * module creates a reference, or with the page when its markup holds one (the server lists them
 * with its other modulepreloads).
 */
import type { ActionInterceptor } from "@farm.js/islx/client";
import { beginFarmServerQueryAction } from "./server-query-call";

type FarmIslandsActionClient = typeof import("./islands-action-client");

let actionClient: Promise<FarmIslandsActionClient> | undefined;

/** The action client, imported once. After a failed import, the next call imports it again. */
export function loadFarmIslandsActionClient(): Promise<FarmIslandsActionClient> {
  return (actionClient ??= import("./islands-action-client").catch((error: unknown) => {
    actionClient = undefined;
    throw error;
  }));
}

/** Starts importing the action client for a reference the page holds, ahead of its first call. */
export function preloadFarmIslandsActionClient(): void {
  loadFarmIslandsActionClient().catch(() => {
    // The first call imports it again and rejects with the error.
  });
}

export const farmIslandsLazyActionInterceptor: ActionInterceptor = (call, next) => {
  // Taken when the call is made: a server query reads the call it is making at that moment.
  const invocation = beginFarmServerQueryAction(call.id, call.args);
  // Sent now, in islx's order; only its result waits for the action client.
  const response = next();
  // Its failure is handled once the action client has loaded, not reported as unhandled before.
  response.catch(() => {});
  return loadFarmIslandsActionClient().then((client) =>
    client.completeFarmIslandsAction(invocation, response),
  );
};
