/**
 * `agent.noindexPreviews`: keep preview deployments out of search indexes by
 * sending `X-Robots-Tag: noindex, nofollow` with every response Farm's server
 * produces there. Off by default. The development server and the generated
 * production server both use this module; preview detection lives in
 * `deployment-environment.ts`.
 */

/** The header value `agent.noindexPreviews` sends on a preview deployment. */
export const FARM_PREVIEW_ROBOTS_TAG = "noindex, nofollow";

export function resolveFarmNoindexPreviews(input: unknown): boolean {
  if (input === undefined) return false;
  if (typeof input !== "boolean") {
    throw new TypeError("agent.noindexPreviews must be a boolean.");
  }
  return input;
}

/**
 * Mark a response as not indexable. Responses with immutable headers, such as
 * a proxied `fetch()` result, are copied first.
 */
export function applyFarmPreviewRobotsTag(response: Response): Response {
  try {
    response.headers.set("X-Robots-Tag", FARM_PREVIEW_ROBOTS_TAG);
    return response;
  } catch {
    const headers = new Headers(response.headers);
    headers.set("X-Robots-Tag", FARM_PREVIEW_ROBOTS_TAG);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }
}
