import {
  getFarmRedirectError,
  isFarmRedirectStatus,
  type FarmRedirectStatus,
} from "../navigation-errors";

/** `X-Farm-Navigation` value of a page-data response that redirects the navigation. */
export const FARM_PAGE_DATA_REDIRECT_NAVIGATION = "redirect";

export interface FarmPageDataRedirect {
  location: string;
  status: FarmRedirectStatus;
}

/**
 * The redirect a page-data request ended with: a `redirect()` thrown by a page,
 * layout, loader, or metadata function, or a thrown 3xx `Response` with a
 * `Location`. Anything else is not a redirect.
 */
export function getFarmPageDataRedirect(error: unknown): FarmPageDataRedirect | null {
  const signal = getFarmRedirectError(error);
  if (signal) return { location: signal.url, status: signal.status };
  if (error instanceof Response) {
    return getFarmPageDataRedirectFromResponse(error.status, error.headers.get("location"));
  }
  return null;
}

/** A 3xx status with a `Location`, as a page-data redirect. */
export function getFarmPageDataRedirectFromResponse(
  status: number,
  location: string | null | undefined,
): FarmPageDataRedirect | null {
  return isFarmRedirectStatus(status) && typeof location === "string" && location
    ? { location, status }
    : null;
}

/**
 * Client navigation reads page data with `fetch`, which would follow a real
 * 3xx and hand the router the target's HTML. A page-data redirect is a 200
 * instruction instead, so the router can continue the navigation itself.
 */
export function createFarmPageDataRedirectResponse(redirect: FarmPageDataRedirect): Response {
  return new Response(
    JSON.stringify({ redirect: { location: redirect.location, status: redirect.status } }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Farm-Navigation": FARM_PAGE_DATA_REDIRECT_NAVIGATION,
      },
    },
  );
}

/**
 * The redirect a page-data response carries, or null for ordinary page data.
 * Reads the body only when the response is a redirect instruction.
 */
export async function readFarmPageDataRedirect(
  response: Response,
): Promise<FarmPageDataRedirect | null> {
  if (response.headers.get("X-Farm-Navigation") !== FARM_PAGE_DATA_REDIRECT_NAVIGATION) {
    return null;
  }
  const payload = (await response.json()) as { redirect?: Partial<FarmPageDataRedirect> } | null;
  const redirect = getFarmPageDataRedirectFromResponse(
    Number(payload?.redirect?.status),
    payload?.redirect?.location,
  );
  if (!redirect) throw new Error("Farm page data returned an invalid redirect");
  return redirect;
}
