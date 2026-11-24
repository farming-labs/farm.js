/**
 * The server query making a server function call, read when the call is made. It imports nothing,
 * so islands mode's action interceptor can take it before the query runtime and cache load
 * (RFC 0013): a page that runs a server query has loaded that runtime, which keeps the state below;
 * on any other page there is none, and no query made the call.
 */

export type FarmServerQueryActionInvocation = {
  actionId: string;
  args: readonly unknown[];
  provisionalKey?: string;
  owner?: object;
};

/** The global the server query runtime keeps its client state under, shared by every copy. */
export const FARM_SERVER_QUERY_CLIENT_STATE = Symbol.for("farm.serverQueryClientState");

type ActiveServerQueryInvocations = {
  active?: { provisionalKey: string; owner: object }[];
};

export function beginFarmServerQueryAction(
  actionId: string,
  args: readonly unknown[],
): FarmServerQueryActionInvocation {
  const state = (globalThis as Record<symbol, ActiveServerQueryInvocations | undefined>)[
    FARM_SERVER_QUERY_CLIENT_STATE
  ];
  const active = state?.active?.at(-1);
  return {
    actionId,
    args,
    provisionalKey: active?.provisionalKey,
    owner: active?.owner,
  };
}
