// Responses Farm constructs itself while handling a request (rendered documents
// and Farm's own header-only rebuilds). Nothing outside Farm holds them yet, so
// their headers can be edited in place. Any other response (from fetch, a
// plugin, or an app handler) is copied before editing: Farm never mutates a
// response it did not build.
const farmOwnedResponses = new WeakSet<Response>();

/** @internal Records a Response that Farm itself constructed. */
export function ownFarmResponse(response: Response): Response {
  farmOwnedResponses.add(response);
  return response;
}

/**
 * @internal Applies a header-only edit. Owned responses are edited in place;
 * others are rebuilt around the same body with a copy of their headers, and the
 * rebuilt response becomes owned.
 */
export function editFarmResponseHeaders(
  response: Response,
  edit: (headers: Headers) => void,
): Response {
  if (farmOwnedResponses.has(response)) {
    edit(response.headers);
    return response;
  }
  const headers = new Headers(response.headers);
  edit(headers);
  return ownFarmResponse(
    new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    }),
  );
}

/** @internal Whether Farm constructed this Response, so its headers are Farm's to edit. */
export function isFarmOwnedResponse(response: Response): boolean {
  return farmOwnedResponses.has(response);
}
