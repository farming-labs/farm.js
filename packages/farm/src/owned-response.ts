/**
 * Responses Farm created for the current request (page documents, error and
 * not-found documents, PPR shells, and copies Farm makes while adding headers).
 *
 * Header steps after a render edit an owned response in place instead of
 * copying its headers and wrapping its body in a new Response. Responses from
 * user code (API routes, middleware, plugins) are never owned, so a Response
 * object an app reuses across requests is never modified.
 *
 * The registry lives on a global symbol so the generated server and core
 * modules bundled separately share it. Kept free of Node built-ins: edge
 * runtimes use it too.
 */
const OWNED_RESPONSES = Symbol.for("farm.ownedResponses");

function registry(): WeakSet<Response> {
  const state = globalThis as unknown as Record<PropertyKey, WeakSet<Response> | undefined>;
  return (state[OWNED_RESPONSES] ??= new WeakSet());
}

/** @internal Marks a Response Farm created for the current request. */
export function _markFarmOwnedResponse<T extends Response>(response: T): T {
  registry().add(response);
  return response;
}

/** @internal Whether Farm created this Response for the current request. */
export function _isFarmOwnedResponse(response: Response): boolean {
  return registry().has(response);
}

/**
 * @internal Applies `edit` to a response's headers: in place when Farm owns the
 * response, otherwise on a copy, which Farm then owns. The body is never read.
 */
export function _withFarmResponseHeaders(
  response: Response,
  edit: (headers: Headers) => void,
): Response {
  if (registry().has(response)) {
    try {
      edit(response.headers);
      return response;
    } catch (error) {
      // Immutable headers reject the first write, before anything changes.
      if (!(error instanceof TypeError)) throw error;
    }
  }
  const headers = new Headers(response.headers);
  edit(headers);
  return _markFarmOwnedResponse(
    new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    }),
  );
}
